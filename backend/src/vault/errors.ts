/** Mirrors `SafeSpendError` in the Anchor program, plus a few client-side codes. */
export const VAULT_ERROR_MESSAGES = {
  VaultNotFound: 'Vault not found',
  Frozen: 'Vault is frozen',
  NotFrozen: 'Vault is not frozen',
  AlreadyFrozen: 'Vault is already frozen',
  InvalidAmount: 'Amount must be greater than zero',
  InsufficientFunds: 'Not enough money in the spending balance',
  PayeeNotAllowlisted: 'Recipient is not an active payee',
  PayeeExists: 'Recipient is already a payee',
  OverPerPaymentLimit: 'Amount is over the per-payment limit',
  OverWeeklyCap: 'Amount is over the weekly cap',
  TooManyHolds: 'Too many payments are already on hold',
  HoldNotFound: 'Hold not found',
  HoldExpired: 'Hold approval deadline has passed',
  HoldNotExpired: 'Hold approval deadline has not passed yet',
  NotGuardian: 'Signer is not a guardian of this vault',
  Unauthorized: 'Signer is not allowed to do this',
  AlreadyApproved: 'Guardian has already approved this hold',
  UnfreezeAlreadyRequested: 'An unfreeze has already been requested',
  NoUnfreezeRequested: 'No unfreeze has been requested',
  UnfreezeDelayNotElapsed: 'The unfreeze waiting period has not passed yet',
} as const;

export type VaultErrorCode = keyof typeof VAULT_ERROR_MESSAGES;

export class VaultError extends Error {
  constructor(
    readonly code: VaultErrorCode,
    detail?: string,
  ) {
    const base = VAULT_ERROR_MESSAGES[code];
    super(detail ? `${base}: ${detail}` : base);
    this.name = 'VaultError';
  }
}

export function isVaultError(e: unknown, code?: VaultErrorCode): e is VaultError {
  return e instanceof VaultError && (code === undefined || e.code === code);
}
