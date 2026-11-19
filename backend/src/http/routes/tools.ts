import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { weeklyRemaining } from '../../domain/rules.js';
import { parseDollars, spokenUsd } from '../../money.js';
import type { Services } from '../../services.js';
import { isVaultError } from '../../vault/errors.js';
import { requireToken } from '../auth.js';
import { decisionView } from '../views.js';

const PaymentBody = z.object({
  payee_name: z.string().trim().min(1).max(120),
  amount: z.union([z.number(), z.string()]),
  memo: z.string().max(1000).optional(),
});

/**
 * ElevenLabs Agents server tools. Every response carries a `message` for the agent to read aloud.
 * The vault is fixed server-side (never taken from the request) so a jailbroken agent can't
 * point a tool call at someone else's vault.
 */
export async function toolRoutes(app: FastifyInstance, s: Services): Promise<void> {
  app.addHook('preHandler', requireToken(s.config.toolSecret, 'x-safespend-tool-secret'));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError || err instanceof RangeError) {
      return reply.code(200).send({ outcome: 'error', message: "Sorry, I didn't catch that. Who should I pay, and how much?" });
    }
    req.log.error({ err }, 'tool call failed');
    const message = isVaultError(err)
      ? `I couldn't do that: ${err.message.toLowerCase()}. Your money hasn't moved.`
      : "Sorry, something went wrong on my side. Your money hasn't moved.";
    return reply.code(200).send({ outcome: 'error', message });
  });

  const vault = s.defaultVault;

  app.post('/get_balance', async () => {
    const v = await s.client.getVault(vault);
    const holds = await s.client.listHolds(vault);
    const held = holds.reduce((sum, h) => sum + h.amount, 0n);
    const parts = [`You have ${spokenUsd(v.balance)} available to spend.`];
    if (held > 0n) parts.push(`Another ${spokenUsd(held)} is waiting for approval.`);
    if (v.frozen) parts.push('Payments are paused right now while your guardians check on something.');
    return {
      balance: spokenUsd(v.balance),
      on_hold: spokenUsd(held),
      weekly_remaining: spokenUsd(weeklyRemaining(v, s.now())),
      frozen: v.frozen,
      message: parts.join(' '),
    };
  });

  app.post('/list_payees', async () => {
    const now = s.now();
    const payees = (await s.client.listPayees(vault)).map((p) => ({
      name: s.directory.label(p.recipient) ?? 'Unnamed payee',
      ready: now >= p.activeAt,
    }));
    const ready = payees.filter((p) => p.ready).map((p) => p.name);
    return {
      payees,
      message: ready.length ? `You can pay ${ready.join(', ')} right away.` : "You don't have any saved payees yet.",
    };
  });

  app.post('/request_payment', async (req) => {
    const body = PaymentBody.parse(req.body);
    const decision = await s.engine.requestPayment({
      vault,
      payeeName: body.payee_name,
      amount: parseDollars(body.amount),
      context: body.memo,
    });
    return decisionView(decision, s.config.cluster);
  });

  app.post('/get_pending_status', async () => {
    const now = s.now();
    const holds = await s.client.listHolds(vault);
    const pending = holds.map((h) => ({
      payee: s.directory.label(h.recipient) ?? 'someone new',
      amount: spokenUsd(h.amount),
      approvals: h.approvals.length,
      approvals_required: h.approvalsRequired,
      expires_in_minutes: Math.max(0, Math.round((h.expiresAt - now) / 60)),
    }));
    const message =
      pending.length === 0
        ? 'Nothing is waiting for approval.'
        : `${pending.length === 1 ? 'One payment is' : `${pending.length} payments are`} waiting for approval: ` +
          pending.map((p) => `${p.amount} to ${p.payee}`).join('; ') +
          '. If nobody approves, the money comes back to your balance.';
    return { pending, message };
  });
}
