use anchor_lang::prelude::*;

// Names match the backend's VaultErrorCode so the TS client can map them one to one.
#[error_code]
pub enum SafeSpendError {
    #[msg("Payments are frozen")]
    Frozen,
    #[msg("The vault is not frozen")]
    NotFrozen,
    #[msg("The vault is already frozen")]
    AlreadyFrozen,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Not enough money in the vault")]
    InsufficientFunds,
    #[msg("Payee is not on the allowlist yet")]
    PayeeNotAllowlisted,
    #[msg("Amount is over the per-payment limit")]
    OverPerPaymentLimit,
    #[msg("Amount would go over the weekly cap")]
    OverWeeklyCap,
    #[msg("Too many holds are open")]
    TooManyHolds,
    #[msg("The hold's approval deadline has passed")]
    HoldExpired,
    #[msg("The hold's approval deadline has not passed yet")]
    HoldNotExpired,
    #[msg("Signer is not a guardian of this vault")]
    NotGuardian,
    #[msg("Signer is not allowed to do this")]
    Unauthorized,
    #[msg("This guardian already approved the hold")]
    AlreadyApproved,
    #[msg("An unfreeze is already requested")]
    UnfreezeAlreadyRequested,
    #[msg("No unfreeze has been requested")]
    NoUnfreezeRequested,
    #[msg("The unfreeze delay has not elapsed")]
    UnfreezeDelayNotElapsed,
    #[msg("Invalid vault configuration")]
    InvalidConfig,
    #[msg("Hold nonce does not match the vault's next nonce")]
    InvalidNonce,
    #[msg("Invalid recipient")]
    InvalidRecipient,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
