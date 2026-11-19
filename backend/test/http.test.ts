import { describe, expect, it } from 'vitest';
import { formatUsd, parseDollars, spokenUsd } from '../src/money.js';
import { setup } from './helpers.js';

describe('money', () => {
  it('parses and formats dollars', () => {
    expect(parseDollars(20)).toBe(20_000_000n);
    expect(parseDollars('$1,200.5')).toBe(1_200_500_000n);
    expect(parseDollars(0.1 + 0.2)).toBe(300_000n);
    expect(() => parseDollars(-5)).toThrow(RangeError);
    expect(() => parseDollars('twenty')).toThrow(RangeError);
    expect(formatUsd(1_200_500_000n)).toBe('$1,200.50');
    expect(spokenUsd(20_500_000n)).toBe('20 dollars and 50 cents');
    expect(spokenUsd(1_000_000n)).toBe('1 dollar');
  });
});

describe('ElevenLabs tools', () => {
  const headers = { 'x-safespend-tool-secret': 'shh' };

  it('rejects calls without the tool secret', async () => {
    const app = setup({ TOOL_SECRET: 'shh' }).app();
    const res = await app.inject({ method: 'POST', url: '/tools/get_balance', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('runs the held → approved flow end to end', async () => {
    const s = setup({ TOOL_SECRET: 'shh' });
    const app = s.app();

    const pay = await app.inject({
      method: 'POST',
      url: '/tools/request_payment',
      headers,
      payload: { payee_name: 'plumber', amount: 400 },
    });
    expect(pay.json()).toMatchObject({ outcome: 'held', payee: "Mike's Plumbing", amount: '$400.00' });

    const status = await app.inject({ method: 'POST', url: '/tools/get_pending_status', headers, payload: {} });
    expect(status.json().message).toContain("400 dollars to Mike's Plumbing");

    const balance = await app.inject({ method: 'POST', url: '/tools/get_balance', headers, payload: {} });
    expect(balance.json().message).toBe('You have 800 dollars available to spend. Another 400 dollars is waiting for approval.');

    const holdId = pay.json().hold_id;
    const approve = await app.inject({
      method: 'POST',
      url: `/api/vaults/${s.demo.vault}/holds/${holdId}/approve`,
      payload: { guardian: s.demo.guardians.sam },
    });
    expect(approve.json()).toMatchObject({ released: true });
    expect(s.notifier.sent.at(-1)).toContain('approved by Sam and sent');
  });

  it('gives the agent something speakable on bad input', async () => {
    const app = setup().app();
    const res = await app.inject({ method: 'POST', url: '/tools/request_payment', payload: { payee_name: 'Maria', amount: 'lots' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'error' });
  });
});

describe('dashboard API', () => {
  it('requires the dashboard token when set', async () => {
    const s = setup({ DASHBOARD_TOKEN: 'tok' });
    const app = s.app();
    expect((await app.inject({ url: `/api/vaults/${s.demo.vault}` })).statusCode).toBe(401);
    const ok = await app.inject({ url: `/api/vaults/${s.demo.vault}`, headers: { authorization: 'Bearer tok' } });
    expect(ok.json()).toMatchObject({ owner: 'Dorothy', balance: { display: '$1,200.00' }, frozen: false });
  });

  it('maps program errors to 409 with the error code', async () => {
    const s = setup();
    const res = await s.app().inject({
      method: 'POST',
      url: `/api/vaults/${s.demo.vault}/unfreeze`,
      payload: { guardian: s.demo.guardians.sam },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'NotFrozen' });
  });

  it('force-pay shows the program rejecting an over-limit payment', async () => {
    const s = setup();
    const res = await s.app().inject({ method: 'POST', url: '/api/demo/force-pay', payload: { payee_name: 'Maria', amount: 900 } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ rejectedBy: 'program', error: 'OverPerPaymentLimit' });
  });

  it('ingests call transcripts and freezes on a scam', async () => {
    const s = setup();
    const app = s.app();
    const call = (await app.inject({ method: 'POST', url: '/api/calls', payload: { caller: 'unknown' } })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/calls/${call.id}/transcript`,
      payload: { text: 'This is the IRS, pay the back taxes in gift cards immediately' },
    });
    expect(res.json()).toMatchObject({ frozeVault: true, score: { scamType: 'gift_card' } });
  });
});

describe('QuickNode webhook', () => {
  it('requires the token, publishes events and dedupes redeliveries', async () => {
    const s = setup({ WEBHOOK_TOKEN: 'qn' });
    const app = s.app();
    const event = {
      kind: 'HoldCreated',
      vault: s.demo.vault,
      signature: '5'.repeat(88),
      at: s.now(),
      data: {
        hold: s.demo.businesses.plumber,
        recipient: s.demo.businesses.plumber,
        amount: '400000000',
        nonce: '0',
        expiresAt: s.now() + 600,
        approvalsRequired: 1,
      },
    };
    expect((await app.inject({ method: 'POST', url: '/webhooks/quicknode', payload: { events: [event] } })).statusCode).toBe(401);

    const send = () =>
      app.inject({ method: 'POST', url: '/webhooks/quicknode?token=qn', payload: { events: [event] } }).then((r) => r.json());
    expect(await send()).toEqual({ received: 1, accepted: 1 });
    expect(await send()).toEqual({ received: 1, accepted: 0 });
    expect(s.scheduler.pending().holds).toBe(1);

    const history = await app.inject({ url: `/api/vaults/${s.demo.vault}/events` });
    expect(history.json().at(-1)).toMatchObject({ kind: 'HoldCreated', explorerUrl: expect.stringContaining('explorer.solana.com') });
  });
});

describe('DeadlineScheduler', () => {
  it('expires overdue holds and executes due unfreezes', async () => {
    const s = setup();
    await s.engine.requestPayment({ vault: s.demo.vault, payeeName: 'plumber', amount: parseDollars(400) });
    await s.client.freeze(s.demo.vault, { kind: 'sentinel' });
    await s.client.requestUnfreeze(s.demo.vault, s.demo.senior);

    s.clock.advance(600);
    await s.scheduler.tick();
    let v = await s.client.getVault(s.demo.vault);
    expect(v.balance).toBe(parseDollars(1200));
    expect(v.frozen).toBe(true);

    s.clock.advance(48 * 3600);
    await s.scheduler.tick();
    v = await s.client.getVault(s.demo.vault);
    expect(v.frozen).toBe(false);
    expect(s.scheduler.pending()).toEqual({ holds: 0, unfreezes: 0 });
  });
});
