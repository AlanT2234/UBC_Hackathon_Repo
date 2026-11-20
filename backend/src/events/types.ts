import type { Pubkey, UnixSeconds } from '../domain/types.js';

/** Event names emitted by `safespend_vault`. */
export const VAULT_EVENT_KINDS = [
  'VaultFunded',
  'PayeeProposed',
  'PayeeRemoved',
  'PaymentSent',
  'HoldCreated',
  'HoldApproved',
  'HoldReleased',
  'HoldRejected',
  'HoldExpired',
  'VaultFrozen',
  'FreezeVoteRecorded',
  'UnfreezeRequested',
  'VaultUnfrozen',
] as const;

export type VaultEventKind = (typeof VAULT_EVENT_KINDS)[number];

export type EventValue = string | number | boolean | null;

/** Amounts are base-unit strings; timestamps are unix seconds. */
export interface VaultEvent {
  kind: VaultEventKind;
  vault: Pubkey;
  signature: string;
  slot?: number;
  at: UnixSeconds;
  data: Record<string, EventValue>;
}
