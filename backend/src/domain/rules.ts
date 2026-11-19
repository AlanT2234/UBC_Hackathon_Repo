import type { Payee, UnixSeconds, Units, VaultState } from './types.js';

export const WEEK_SECONDS = 7 * 24 * 60 * 60;
/** Caps hold spam from a compromised agent. */
export const MAX_OPEN_HOLDS = 5;

// Weekly cap uses a fixed window that restarts at the first payment after it lapses.

export function windowExpired(v: VaultState, now: UnixSeconds): boolean {
  return now >= v.windowStart + WEEK_SECONDS;
}

export function spentThisWindow(v: VaultState, now: UnixSeconds): Units {
  return windowExpired(v, now) ? 0n : v.spentInWindow;
}

export function weeklyRemaining(v: VaultState, now: UnixSeconds): Units {
  const left = v.weeklyCap - spentThisWindow(v, now);
  return left > 0n ? left : 0n;
}

/** 2-of-N for big amounts; with fewer than 2 guardians, falls back to 1. */
export function approvalsRequiredFor(v: VaultState, amount: Units): number {
  return amount >= v.bigAmountThreshold && v.guardians.length >= 2 ? 2 : 1;
}

export function isProfessional(v: VaultState, guardianIndex: number): boolean {
  return ((v.professionalMask >> guardianIndex) & 1) === 1;
}

/** Votes needed for a family-guardian refreeze after a senior self-unfreeze. */
export function refreezeQuorum(v: VaultState): number {
  return Math.min(2, v.guardians.length);
}

export function isPayeeActive(p: Payee, now: UnixSeconds): boolean {
  return now >= p.activeAt;
}

export function popcount(bits: number): number {
  let n = 0;
  for (let x = bits; x; x >>>= 1) n += x & 1;
  return n;
}
