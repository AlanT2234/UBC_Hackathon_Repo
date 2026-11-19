import type { Units } from './domain/types.js';

export const USDC_DECIMALS = 6;
const UNITS_PER_DOLLAR = 1_000_000n;
const UNITS_PER_CENT = 10_000n;

/** Parses a dollar amount (as the voice agent sends it) into USDC base units. */
export function parseDollars(input: number | string): Units {
  let s: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0 || input > 1e12) {
      throw new RangeError(`Not a dollar amount: ${input}`);
    }
    // toFixed avoids float noise like 0.30000000000000004.
    s = input.toFixed(6);
  } else {
    s = input.trim().replace(/^\$/, '').replace(/,/g, '');
  }
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) throw new RangeError(`Not a dollar amount: ${input}`);
  return BigInt(m[1]!) * UNITS_PER_DOLLAR + BigInt((m[2] ?? '').padEnd(6, '0'));
}

/** "$1,200.50". Truncates below a cent. */
export function formatUsd(units: Units): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const dollars = abs / UNITS_PER_DOLLAR;
  const cents = (abs % UNITS_PER_DOLLAR) / UNITS_PER_CENT;
  return `${neg ? '-' : ''}$${dollars.toLocaleString('en-US')}.${cents.toString().padStart(2, '0')}`;
}

/** "20 dollars and 50 cents", for the agent to read aloud. */
export function spokenUsd(units: Units): string {
  const dollars = units / UNITS_PER_DOLLAR;
  const cents = Number((units % UNITS_PER_DOLLAR) / UNITS_PER_CENT);
  const d = `${dollars} dollar${dollars === 1n ? '' : 's'}`;
  const c = `${cents} cent${cents === 1 ? '' : 's'}`;
  if (cents === 0) return d;
  if (dollars === 0n) return c;
  return `${d} and ${c}`;
}

/** amount / total as a float in [0, ∞), safe for large bigints. */
export function ratio(amount: Units, total: Units): number {
  if (total <= 0n) return amount > 0n ? Infinity : 0;
  return Number((amount * 10_000n) / total) / 10_000;
}
