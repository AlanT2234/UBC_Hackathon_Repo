/** USDC base units (6 decimals). */
export type Units = bigint;
/** Base58 Solana address. */
export type Pubkey = string;
export type UnixSeconds = number;
export type Clock = () => UnixSeconds;

export const systemClock: Clock = () => Math.floor(Date.now() / 1000);

/**
 * Offchain mirror of the `Vault` account in `safespend_vault`.
 * Keep field semantics in sync with the Anchor program.
 */
export interface VaultState {
  address: Pubkey;
  senior: Pubkey;
  mint: Pubkey;
  guardians: Pubkey[];
  /** Bitmap over `guardians` marking vetted professionals. */
  professionalMask: number;
  /** At or above this, a hold needs 2 approvals (when there are ≥2 guardians). */
  bigAmountThreshold: Units;
  perPaymentLimit: Units;
  weeklyCap: Units;
  windowStart: UnixSeconds;
  spentInWindow: Units;
  holdSeconds: number;
  unfreezeDelaySeconds: number;
  changeDelaySeconds: number;
  frozen: boolean;
  unfreezeRequestedAt: UnixSeconds | null;
  /** Set when a senior self-unfreeze executes; a guardian refreeze then needs a quorum or a professional. */
  selfUnfrozenAt: UnixSeconds | null;
  /** Bitmap over `guardians` of refreeze votes collected after a self-unfreeze. */
  freezeVotes: number;
  agentSessionKey: Pubkey;
  nextNonce: bigint;
  openHolds: number;
  /** Vault token account balance: the truly spendable amount (held funds sit in per-hold escrows). */
  balance: Units;
}

/** Allowlist entry. Usable only once `activeAt` has passed. */
export interface Payee {
  vault: Pubkey;
  recipient: Pubkey;
  activeAt: UnixSeconds;
}

/** Mirror of `PendingTransfer`: an escrowed payment awaiting guardian approval. */
export interface Hold {
  address: Pubkey;
  vault: Pubkey;
  recipient: Pubkey;
  amount: Units;
  nonce: bigint;
  createdAt: UnixSeconds;
  /** Approval deadline. There is no auto-release; after this, the only exit is a refund. */
  expiresAt: UnixSeconds;
  approvalsRequired: number;
  approvals: Pubkey[];
}
