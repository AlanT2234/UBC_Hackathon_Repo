import { describe, expect, it } from 'vitest';
import { parseDollars as $ } from '../src/money.js';
import { setup } from './helpers.js';

function ctx() {
  const s = setup();
  const pay = (payeeName: string, dollars: number, context?: string) =>
    s.engine.requestPayment({ vault: s.demo.vault, payeeName, amount: $(dollars), context });
  return { ...s, pay };
}

describe('PolicyEngine', () => {
  it('pays a known payee instantly', async () => {
    const c = ctx();
    const d = await c.pay('Maria', 20);
    expect(d.outcome).toBe('paid');
    expect(d.message).toBe('Done. I sent Maria 20 dollars.');
  });

  it('matches payees by alias', async () => {
    const c = ctx();
    expect(await c.pay('the electric company', 60)).toMatchObject({ outcome: 'paid', payee: { name: 'City Electric' } });
    expect(await c.pay('my grandson', 25)).toMatchObject({ outcome: 'paid', payee: { name: 'Tyler' } });
  });

  it('holds a new payee and alerts guardians', async () => {
    const c = ctx();
    const d = await c.pay('my new plumber', 400);
    expect(d.outcome).toBe('held');
    if (d.outcome !== 'held') return;
    expect(d.payee.name).toBe("Mike's Plumbing");
    expect(d.hold.approvalsRequired).toBe(1);
    expect(d.message).toContain("I don't know Mike's Plumbing yet");
    expect(c.notifier.sent.some((m) => m.includes("Dorothy wants to pay Mike's Plumbing $400.00"))).toBe(true);
  });

  it('holds a known payee over the per-payment limit', async () => {
    const c = ctx();
    const d = await c.pay('Maria', 150);
    expect(d).toMatchObject({ outcome: 'held' });
    if (d.outcome === 'held') expect(d.reasons).toContain('over the per-payment limit');
  });

  it('holds an unknown name via a claim recipient', async () => {
    const c = ctx();
    const d = await c.pay('Bob Stranger', 30);
    expect(d).toMatchObject({ outcome: 'held', payee: { name: 'Bob Stranger', allowlisted: false } });
  });

  it('refuses and freezes on scam cues in the conversation', async () => {
    const c = ctx();
    const d = await c.pay('Kevin', 2000, "He said to buy gift cards right now and don't tell anyone, my grandson is in jail");
    expect(d).toMatchObject({ outcome: 'refused', code: 'scam_suspected' });
    expect((await c.client.getVault(c.demo.vault)).frozen).toBe(true);
    expect(c.notifier.sent.some((m) => m.startsWith('🛑'))).toBe(true);
  });

  it('refuses everything while frozen', async () => {
    const c = ctx();
    await c.client.freeze(c.demo.vault, { kind: 'sentinel' });
    expect(await c.pay('Maria', 5)).toMatchObject({ outcome: 'refused', code: 'frozen' });
  });

  it('a live scam call raises the risk of payments to new payees', async () => {
    const c = ctx();
    const call = c.calls.start(c.demo.vault, '+1 555 0100');
    await c.calls.ingest(call.id, 'This is the IRS. You owe back taxes.');
    // Below the freeze threshold. Known payees still work (a scammer can't be on the allowlist)...
    expect((await c.client.getVault(c.demo.vault)).frozen).toBe(false);
    const known = await c.pay('Maria', 20);
    expect(known).toMatchObject({ outcome: 'paid', risk: { signals: { scamCue: 0.4 } } });
    // ...but a stranger plus a big amount during the call is refused outright.
    expect(await c.pay('Officer Davis', 300)).toMatchObject({ outcome: 'refused', code: 'scam_suspected' });
  });

  it('refuses when the balance is too low', async () => {
    const c = ctx();
    expect(await c.pay('plumber', 5000)).toMatchObject({ outcome: 'refused', code: 'insufficient_funds' });
  });
});
