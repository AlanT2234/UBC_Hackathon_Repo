import type { Hold, Payee, Pubkey, Units, VaultState } from '../domain/types.js';

export interface TxResult {
  signature: string;
}

/** Who is freezing: a single guardian, or the scam scorer via the backend's sentinel key. */
export type FreezeAuthority = { kind: 'guardian'; key: Pubkey } | { kind: 'sentinel' };

/**
 * One method per `safespend_vault` instruction. Implementations: `MockVaultClient` (in-memory,
 * enforces the same rules) now; an Anchor client once the program IDL is published.
 * Errors are thrown as `VaultError`.
 */
export interface VaultClient {
  getVault(vault: Pubkey): Promise<VaultState>;
  listPayees(vault: Pubkey): Promise<Payee[]>;
  listHolds(vault: Pubkey): Promise<Hold[]>;

  /** Senior or guardian. Becomes usable after `changeDelaySeconds`. */
  addPayee(vault: Pubkey, signer: Pubkey, recipient: Pubkey): Promise<TxResult & { payee: Payee }>;
  /** Agent session key. Instant transfer within onchain limits. */
  pay(vault: Pubkey, recipient: Pubkey, amount: Units): Promise<TxResult>;
  /** Agent session key. Moves funds into escrow until approved, rejected or expired. */
  requestHold(vault: Pubkey, recipient: Pubkey, amount: Units): Promise<TxResult & { hold: Hold }>;
  /** Guardian. Releases once enough distinct guardians have approved. */
  approve(vault: Pubkey, hold: Pubkey, guardian: Pubkey): Promise<TxResult & { released: boolean }>;
  /** Guardian or senior. Refunds escrow to the vault. */
  reject(vault: Pubkey, hold: Pubkey, signer: Pubkey): Promise<TxResult>;
  /** Anyone, after the deadline. Refunds escrow to the vault. */
  expire(vault: Pubkey, hold: Pubkey): Promise<TxResult>;
  /** `frozen: false` means a refreeze vote was recorded but quorum is not reached yet. */
  freeze(vault: Pubkey, by: FreezeAuthority): Promise<TxResult & { frozen: boolean }>;
  /** Guardian, immediate. */
  unfreeze(vault: Pubkey, guardian: Pubkey): Promise<TxResult>;
  /** Senior. Starts the ~48h clock and alerts guardians. */
  requestUnfreeze(vault: Pubkey, senior: Pubkey): Promise<TxResult>;
  /** Anyone, once the senior's unfreeze delay has passed. */
  executeUnfreeze(vault: Pubkey): Promise<TxResult>;
}
