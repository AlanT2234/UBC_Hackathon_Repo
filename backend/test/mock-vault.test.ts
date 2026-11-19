import { describe, expect, it } from 'vitest';
import { WEEK_SECONDS } from '../src/domain/rules.js';
import { parseDollars as $ } from '../src/money.js';
import { setup } from './helpers.js';

// Mirrors the "tests to write first" list for safespend_vault, against the mock client.

function ctx() {
  const s = setup();
  const { vault, senior, guardians, payees, businesses } = s.demo;
  const balance = async () => (await s.client.getVault(vault)).balance;
  return { ...s, vault, senior, guardians, payees, businesses, balance };
}

describe('pay', () => {
  it('pays an allowlisted payee within limits', async () => {
    const c = ctx();
    await c.client.pay(c.vault, c.payees.maria, $(20));
    expect(await c.balance()).toBe($(1180));
  });

  it('rejects a payee that is not allowlisted', async () => {
    const c = ctx();
    await expect(c.client.pay(c.vault, c.businesses.plumber, $(20))).rejects.toMatchObject({ code: 'PayeeNotAllowlisted' });
  });

  it('rejects over the per-payment limit', async () => {
    const c = ctx();
    await expect(c.client.pay(c.vault, c.payees.maria, $(101))).rejects.toMatchObject({ code: 'OverPerPaymentLimit' });
  });

  it('enforces the weekly cap and resets after the window', async () => {
    const c = ctx();
    for (let i = 0; i < 3; i++) await c.client.pay(c.vault, c.payees.maria, $(100));
    await expect(c.client.pay(c.vault, c.payees.maria, $(1))).rejects.toMatchObject({ code: 'OverWeeklyCap' });
    c.clock.advance(WEEK_SECONDS);
    await c.client.pay(c.vault, c.payees.maria, $(100));
    expect((await c.client.getVault(c.vault)).spentInWindow).toBe($(100));
  });

  it('a failed pay leaves state untouched', async () => {
    const c = ctx();
    const before = await c.client.getVault(c.vault);
    await expect(c.client.pay(c.vault, c.payees.maria, $(500))).rejects.toThrow();
    expect(await c.client.getVault(c.vault)).toEqual(before);
  });
});

describe('holds', () => {
  it('approve before the deadline pays the recipient and closes the hold', async () => {
    const c = ctx();
    const { hold } = await c.client.requestHold(c.vault, c.businesses.plumber, $(400));
    expect(await c.balance()).toBe($(800));
    const r = await c.client.approve(c.vault, hold.address, c.guardians.sam);
    expect(r.released).toBe(true);
    expect(await c.client.listHolds(c.vault)).toHaveLength(0);
    expect((await c.client.getVault(c.vault)).openHolds).toBe(0);
    // second release has nothing to act on
    await expect(c.client.approve(c.vault, hold.address, c.guardians.priya)).rejects.toMatchObject({ code: 'HoldNotFound' });
  });

  it('approve after the deadline fails', async () => {
    const c = ctx();
    const { hold } = await c.client.requestHold(c.vault, c.businesses.plumber, $(50));
    c.clock.advance(600);
    await expect(c.client.approve(c.vault, hold.address, c.guardians.sam)).rejects.toMatchObject({ code: 'HoldExpired' });
  });

  it('expire fails before the deadline and refunds after it', async () => {
    const c = ctx();
    const { hold } = await c.client.requestHold(c.vault, c.businesses.plumber, $(50));
    await expect(c.client.expire(c.vault, hold.address)).rejects.toMatchObject({ code: 'HoldNotExpired' });
    c.clock.advance(600);
    await c.client.expire(c.vault, hold.address);
    expect(await c.balance()).toBe($(1200));
  });

  it('non-guardians cannot approve or reject', async () => {
    const c = ctx();
    const { hold } = await c.client.requestHold(c.vault, c.businesses.plumber, $(50));
    await expect(c.client.approve(c.vault, hold.address, c.payees.maria)).rejects.toMatchObject({ code: 'NotGuardian' });
    await expect(c.client.reject(c.vault, hold.address, c.payees.maria)).rejects.toMatchObject({ code: 'Unauthorized' });
  });

  it('the senior can reject and is refunded', async () => {
    const c = ctx();
    const { hold } = await c.client.requestHold(c.vault, c.businesses.plumber, $(50));
    await c.client.reject(c.vault, hold.address, c.senior);
    expect(await c.balance()).toBe($(1200));
  });

  it('big amounts need two distinct guardians', async () => {
    const c = ctx();
    const { hold } = await c.client.requestHold(c.vault, c.businesses.plumber, $(600));
    expect(hold.approvalsRequired).toBe(2);
    expect((await c.client.approve(c.vault, hold.address, c.guardians.sam)).released).toBe(false);
    await expect(c.client.approve(c.vault, hold.address, c.guardians.sam)).rejects.toMatchObject({ code: 'AlreadyApproved' });
    expect((await c.client.approve(c.vault, hold.address, c.guardians.priya)).released).toBe(true);
  });

  it('caps open holds', async () => {
    const c = ctx();
    for (let i = 0; i < 5; i++) await c.client.requestHold(c.vault, c.businesses.plumber, $(1));
    await expect(c.client.requestHold(c.vault, c.businesses.plumber, $(1))).rejects.toMatchObject({ code: 'TooManyHolds' });
  });
});

describe('freeze', () => {
  it('blocks pay, request and approve but still allows refunds', async () => {
    const c = ctx();
    const { hold } = await c.client.requestHold(c.vault, c.businesses.plumber, $(50));
    await c.client.freeze(c.vault, { kind: 'guardian', key: c.guardians.sam });
    await expect(c.client.pay(c.vault, c.payees.maria, $(1))).rejects.toMatchObject({ code: 'Frozen' });
    await expect(c.client.requestHold(c.vault, c.payees.maria, $(1))).rejects.toMatchObject({ code: 'Frozen' });
    await expect(c.client.approve(c.vault, hold.address, c.guardians.sam)).rejects.toMatchObject({ code: 'Frozen' });
    await c.client.reject(c.vault, hold.address, c.guardians.sam);
    expect(await c.balance()).toBe($(1200));
  });

  it('senior unfreeze waits out the delay', async () => {
    const c = ctx();
    await c.client.freeze(c.vault, { kind: 'sentinel' });
    await expect(c.client.requestUnfreeze(c.vault, c.guardians.sam)).rejects.toMatchObject({ code: 'Unauthorized' });
    await c.client.requestUnfreeze(c.vault, c.senior);
    c.clock.advance(48 * 3600 - 1);
    await expect(c.client.executeUnfreeze(c.vault)).rejects.toMatchObject({ code: 'UnfreezeDelayNotElapsed' });
    c.clock.advance(1);
    await c.client.executeUnfreeze(c.vault);
    expect((await c.client.getVault(c.vault)).frozen).toBe(false);
  });

  it('after a self-unfreeze, one family guardian cannot refreeze alone', async () => {
    const c = ctx();
    await c.client.freeze(c.vault, { kind: 'guardian', key: c.guardians.sam });
    await c.client.requestUnfreeze(c.vault, c.senior);
    c.clock.advance(48 * 3600);
    await c.client.executeUnfreeze(c.vault);

    expect((await c.client.freeze(c.vault, { kind: 'guardian', key: c.guardians.sam })).frozen).toBe(false);
    expect((await c.client.getVault(c.vault)).frozen).toBe(false);
    expect((await c.client.freeze(c.vault, { kind: 'guardian', key: c.guardians.priya })).frozen).toBe(true);
  });

  it('after a self-unfreeze, a professional guardian can refreeze alone', async () => {
    const c = ctx();
    await c.client.freeze(c.vault, { kind: 'sentinel' });
    await c.client.requestUnfreeze(c.vault, c.senior);
    c.clock.advance(48 * 3600);
    await c.client.executeUnfreeze(c.vault);
    expect((await c.client.freeze(c.vault, { kind: 'guardian', key: c.guardians.maple })).frozen).toBe(true);
  });

  it('any single guardian can freeze an unfrozen vault', async () => {
    const c = ctx();
    expect((await c.client.freeze(c.vault, { kind: 'guardian', key: c.guardians.priya })).frozen).toBe(true);
  });
});

describe('payee waiting period', () => {
  it('a new payee is not payable until the delay passes', async () => {
    const c = ctx();
    await c.client.addPayee(c.vault, c.senior, c.businesses.plumber);
    await expect(c.client.pay(c.vault, c.businesses.plumber, $(20))).rejects.toMatchObject({ code: 'PayeeNotAllowlisted' });
    c.clock.advance(24 * 3600);
    await c.client.pay(c.vault, c.businesses.plumber, $(20));
  });
});
