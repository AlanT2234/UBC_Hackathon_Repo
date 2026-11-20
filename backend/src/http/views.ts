import { isPayeeActive, isProfessional, popcount, weeklyRemaining } from '../domain/rules.js';
import type { Hold, Payee, UnixSeconds, Units, VaultState } from '../domain/types.js';
import type { VaultEvent } from '../events/types.js';
import { formatUsd } from '../money.js';
import type { PayeeDirectory } from '../payees/directory.js';
import type { PaymentRecord } from '../payments/log.js';
import type { PaymentDecision } from '../policy/engine.js';
import { MOCK_SIGNATURE_PREFIX } from '../vault/mock.js';

// JSON shapes for the dashboard and the voice agent. Amounts carry raw base units (string) plus display text.

export const usd = (u: Units) => ({ units: u.toString(), display: formatUsd(u) });

export function explorerTxUrl(signature: string, cluster: string): string | null {
  if (signature.startsWith(MOCK_SIGNATURE_PREFIX)) return null;
  const suffix = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster === 'localnet' ? 'custom' : cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

export function vaultView(v: VaultState, now: UnixSeconds, directory: PayeeDirectory) {
  return {
    address: v.address,
    owner: directory.label(v.senior) ?? null,
    senior: v.senior,
    balance: usd(v.balance),
    perPaymentLimit: usd(v.perPaymentLimit),
    weeklyCap: usd(v.weeklyCap),
    weeklyRemaining: usd(weeklyRemaining(v, now)),
    bigAmountThreshold: usd(v.bigAmountThreshold),
    frozen: v.frozen,
    unfreezeRequestedAt: v.unfreezeRequestedAt,
    unfreezeEffectiveAt: v.unfreezeRequestedAt === null ? null : v.unfreezeRequestedAt + v.unfreezeDelaySeconds,
    selfUnfrozenAt: v.selfUnfrozenAt,
    refreezeNeedsQuorum: v.selfUnfrozenAt !== null,
    freezeVotes: popcount(v.freezeVotes),
    guardians: v.guardians.map((key, i) => ({
      key,
      name: directory.label(key) ?? null,
      professional: isProfessional(v, i),
    })),
    openHolds: v.openHolds,
    holdSeconds: v.holdSeconds,
    unfreezeDelaySeconds: v.unfreezeDelaySeconds,
    changeDelaySeconds: v.changeDelaySeconds,
  };
}

export function holdView(h: Hold, now: UnixSeconds, directory: PayeeDirectory) {
  return {
    address: h.address,
    recipient: h.recipient,
    payee: directory.label(h.recipient) ?? null,
    amount: usd(h.amount),
    nonce: h.nonce.toString(),
    createdAt: h.createdAt,
    expiresAt: h.expiresAt,
    expiresInSeconds: Math.max(0, h.expiresAt - now),
    approvalsRequired: h.approvalsRequired,
    approvals: h.approvals.map((key) => ({ key, name: directory.label(key) ?? null })),
  };
}

export function payeeView(p: Payee, now: UnixSeconds, directory: PayeeDirectory) {
  return {
    recipient: p.recipient,
    name: directory.label(p.recipient) ?? null,
    aliases: directory.get(p.recipient)?.aliases ?? [],
    activeAt: p.activeAt,
    active: isPayeeActive(p, now),
  };
}

export function paymentView(p: PaymentRecord, now: UnixSeconds, directory: PayeeDirectory, cluster: string) {
  return {
    id: p.id,
    payee: p.payee,
    recipient: p.recipient,
    amount: usd(p.amount),
    memo: p.memo,
    status: p.status,
    reasons: p.reasons,
    requestedAt: p.requestedAt,
    decidedAt: p.decidedAt,
    hold: p.hold,
    expiresAt: p.expiresAt,
    expiresInSeconds: p.status === 'held' && p.expiresAt !== null ? Math.max(0, p.expiresAt - now) : null,
    approvalsRequired: p.approvalsRequired,
    approvals: p.approvals.map((key) => ({ key, name: directory.label(key) ?? null })),
    explorerUrl: p.signature ? explorerTxUrl(p.signature, cluster) : null,
  };
}

export function eventView(e: VaultEvent, cluster: string) {
  return { ...e, explorerUrl: explorerTxUrl(e.signature, cluster) };
}

/** Snake-case response for ElevenLabs server tools; `message` is what the agent should say. */
export function decisionView(d: PaymentDecision, cluster: string) {
  const base = { outcome: d.outcome, message: d.message, amount: formatUsd(d.amount) };
  switch (d.outcome) {
    case 'paid':
      return { ...base, payee: d.payee.name, signature: d.signature, explorer_url: explorerTxUrl(d.signature, cluster) };
    case 'held':
      return {
        ...base,
        payee: d.payee.name,
        hold_id: d.hold.address,
        expires_at: d.hold.expiresAt,
        approvals_required: d.hold.approvalsRequired,
        reasons: d.reasons,
      };
    case 'refused':
      return { ...base, payee: d.payee?.name ?? null, code: d.code, reasons: d.reasons };
    case 'clarify':
      return { ...base, options: d.options };
  }
}
