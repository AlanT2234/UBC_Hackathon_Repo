import { Keypair, PublicKey } from '@solana/web3.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseDollars } from '../../money.js';
import type { PaymentRecord } from '../../payments/log.js';
import type { Services } from '../../services.js';
import { isVaultError } from '../../vault/errors.js';
import { requireToken } from '../auth.js';
import { decisionView, eventView, holdView, payeeView, paymentView, vaultView } from '../views.js';

const pubkey = z.string().refine((s) => {
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}, 'not a Solana address');

const VaultParams = z.object({ vault: pubkey });
const HoldParams = VaultParams.extend({ hold: pubkey });
const PayeeParams = VaultParams.extend({ recipient: pubkey });
const GuardianBody = z.object({ guardian: pubkey });
const SignerBody = z.object({ signer: pubkey });
const PayeeBody = z.object({
  signer: pubkey,
  name: z.string().trim().min(1).max(80),
  // Optional: guardians add people by name. Without an address, a known name (a business, or
  // someone she already asked to pay) keeps its address; otherwise a claim address is created.
  recipient: pubkey.optional(),
  aliases: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
});
const CallBody = z.object({ caller: z.string().max(40).optional() });
const TranscriptBody = z.object({ text: z.string().min(1).max(5000) });
const ForcePayBody = z.object({ payee_name: z.string().min(1), amount: z.union([z.number(), z.string()]) });
const FundBody = z.object({ amount: z.union([z.number(), z.string()]) });
const PaymentBody = z.object({
  payee_name: z.string().trim().min(1).max(120),
  amount: z.union([z.number(), z.string()]),
  memo: z.string().max(1000).optional(),
});

/**
 * Dashboard API (senior + guardians). Demo shortcut: guardian and senior keys are server-held,
 * so a request names which guardian is acting; with passkey wallets these become client-signed txs.
 */
export async function apiRoutes(app: FastifyInstance, s: Services): Promise<void> {
  app.addHook('preHandler', requireToken(s.config.dashboardToken, 'authorization'));

  app.get('/vaults/:vault', async (req) => {
    const { vault } = VaultParams.parse(req.params);
    return vaultView(await s.client.getVault(vault), s.now(), s.directory);
  });

  app.get('/vaults/:vault/payees', async (req) => {
    const { vault } = VaultParams.parse(req.params);
    const now = s.now();
    return (await s.client.listPayees(vault)).map((p) => payeeView(p, now, s.directory));
  });

  app.post('/vaults/:vault/payees', async (req) => {
    const { vault } = VaultParams.parse(req.params);
    const body = PayeeBody.parse(req.body);
    const recipient = body.recipient ?? s.directory.findExact(vault, body.name)?.recipient ?? Keypair.generate().publicKey.toBase58();
    // Named before the program call, because its PayeeProposed alert goes out right away.
    const previous = s.directory.get(recipient);
    s.directory.register({ name: body.name, recipient, vault, aliases: body.aliases, kind: 'payee' });
    let result;
    try {
      result = await s.client.addPayee(vault, body.signer, recipient);
    } catch (err) {
      if (previous) s.directory.register(previous);
      else s.directory.unregister(recipient);
      throw err;
    }
    return { signature: result.signature, payee: payeeView(result.payee, s.now(), s.directory) };
  });

  /** Every payment request with its outcome, newest first (including refusals that never hit the chain). */
  app.get('/vaults/:vault/payments', async (req) => {
    const { vault } = VaultParams.parse(req.params);
    const now = s.now();
    return s.payments.list(vault).map((p) => paymentView(p, now, s.directory, s.config.cluster));
  });

  app.post('/vaults/:vault/payees/:recipient/remove', async (req) => {
    const { vault, recipient } = PayeeParams.parse(req.params);
    const { signer } = SignerBody.parse(req.body);
    const result = await s.client.removePayee(vault, signer, recipient);
    // The name keeps resolving to the same address, so a later request to them is held, not new.
    const entry = s.directory.get(recipient);
    if (entry) s.directory.register({ ...entry, kind: 'claim' });
    return result;
  });

  app.get('/vaults/:vault/holds', async (req) => {
    const { vault } = VaultParams.parse(req.params);
    const now = s.now();
    return (await s.client.listHolds(vault)).map((h) => holdView(h, now, s.directory));
  });

  app.post('/vaults/:vault/holds/:hold/approve', async (req) => {
    const { vault, hold } = HoldParams.parse(req.params);
    const { guardian } = GuardianBody.parse(req.body);
    return s.client.approve(vault, hold, guardian);
  });

  app.post('/vaults/:vault/holds/:hold/reject', async (req) => {
    const { vault, hold } = HoldParams.parse(req.params);
    const { signer } = SignerBody.parse(req.body);
    return s.client.reject(vault, hold, signer);
  });

  app.post('/vaults/:vault/freeze', async (req) => {
    const { vault } = VaultParams.parse(req.params);
    const { guardian } = GuardianBody.parse(req.body);
    return s.client.freeze(vault, { kind: 'guardian', key: guardian });
  });

  app.post('/vaults/:vault/unfreeze', async (req) => {
    const { vault } = VaultParams.parse(req.params);
    const { guardian } = GuardianBody.parse(req.body);
    return s.client.unfreeze(vault, guardian);
  });

  app.post('/vaults/:vault/request-unfreeze', async (req) => {
    const { vault } = VaultParams.parse(req.params);
    const { signer } = SignerBody.parse(req.body);
    return s.client.requestUnfreeze(vault, signer);
  });

  app.get('/vaults/:vault/events', async (req) => {
    const { vault } = VaultParams.parse(req.params);
    return s.bus.history(vault).map((e) => eventView(e, s.config.cluster));
  });

  /**
   * Server-sent events: `vault` for program events, `payment` for payment history changes
   * (refusals included), `call` for live call transcripts and scores.
   */
  app.get('/events/stream', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    // Proxies (Cloudflare tunnels, nginx) buffer or compress streams unless told not to; the
    // padding comment pushes the first bytes past any remaining buffer so `ready` arrives at once.
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
      ...corsHeaders(req.headers.origin, s.config.corsOrigins),
    });
    res.write(`: ${' '.repeat(2048)}\n\n`);
    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const offBus = s.bus.subscribe((e) => send('vault', eventView(e, s.config.cluster)));
    const onCall = (c: unknown) => send('call', c);
    s.calls.on('update', onCall);
    const onPayment = (p: PaymentRecord) => send('payment', paymentView(p, s.now(), s.directory, s.config.cluster));
    s.payments.on('update', onPayment);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      offBus();
      s.calls.off('update', onCall);
      s.payments.off('update', onPayment);
    });
    send('ready', { vault: s.defaultVault });
  });

  // Live call listening. The Twilio → Scribe bridge posts transcript chunks here; the same
  // endpoint serves the pre-recorded fallback during the demo.
  app.post('/calls', async (req) => {
    const { caller } = CallBody.parse(req.body ?? {});
    return s.calls.start(s.defaultVault, caller ?? null);
  });

  app.get('/calls/:id', async (req, reply) => {
    const call = s.calls.get((req.params as { id: string }).id);
    return call ?? reply.code(404).send({ error: 'not_found' });
  });

  app.post('/calls/:id/transcript', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!s.calls.get(id)) return reply.code(404).send({ error: 'not_found' });
    const { text } = TranscriptBody.parse(req.body);
    return s.calls.ingest(id, text);
  });

  app.post('/calls/:id/end', async (req, reply) => {
    const call = s.calls.end((req.params as { id: string }).id);
    return call ?? reply.code(404).send({ error: 'not_found' });
  });

  if (s.config.demoRoutes) {
    app.get('/demo', async () => s.demo);

    /** Jailbreak beat: skip the policy engine entirely and let the program say no. */
    app.post('/demo/force-pay', async (req, reply) => {
      const body = ForcePayBody.parse(req.body);
      const { best } = s.directory.match(s.defaultVault, body.payee_name);
      const recipient = best?.recipient ?? s.directory.createClaim(s.defaultVault, body.payee_name).recipient;
      try {
        return { ok: true, ...(await s.client.pay(s.defaultVault, recipient, parseDollars(body.amount))) };
      } catch (err) {
        if (isVaultError(err)) {
          return reply.code(409).send({ ok: false, rejectedBy: 'program', error: err.code, message: err.message });
        }
        throw err;
      }
    });

    /** The senior tablet's sample requests: the same policy engine path as the voice agent's tool call. */
    app.post('/demo/request-payment', async (req) => {
      const body = PaymentBody.parse(req.body);
      const decision = await s.engine.requestPayment({
        vault: s.defaultVault,
        payeeName: body.payee_name,
        amount: parseDollars(body.amount),
        context: body.memo,
      });
      return decisionView(decision, s.config.cluster);
    });

    app.post('/demo/fund', async (req) => {
      const { amount } = FundBody.parse(req.body);
      return s.client.fund(s.defaultVault, parseDollars(amount));
    });
  }
}

function corsHeaders(origin: string | undefined, allowed: string[]): Record<string, string> {
  return origin && (allowed.includes('*') || allowed.includes(origin)) ? { 'access-control-allow-origin': origin } : {};
}
