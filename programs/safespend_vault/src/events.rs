use anchor_lang::prelude::*;

// Every state change emits one of these; QuickNode Streams decodes them from the program logs.
// Names match the backend's VaultEventKind.

#[event]
pub struct VaultInitialized {
    pub vault: Pubkey,
    pub senior: Pubkey,
    pub mint: Pubkey,
    pub guardians: Vec<Pubkey>,
}

#[event]
pub struct SetupCompleted {
    pub vault: Pubkey,
}

#[event]
pub struct PayeeProposed {
    pub vault: Pubkey,
    pub recipient: Pubkey,
    pub proposed_by: Pubkey,
    pub active_at: i64,
}

#[event]
pub struct PayeeRemoved {
    pub vault: Pubkey,
    pub recipient: Pubkey,
    pub removed_by: Pubkey,
}

#[event]
pub struct PaymentSent {
    pub vault: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub spent_in_window: u64,
}

#[event]
pub struct HoldCreated {
    pub vault: Pubkey,
    pub hold: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub nonce: u64,
    pub expires_at: i64,
    pub approvals_required: u8,
}

#[event]
pub struct HoldApproved {
    pub vault: Pubkey,
    pub hold: Pubkey,
    pub guardian: Pubkey,
    pub approvals: u8,
    pub approvals_required: u8,
}

#[event]
pub struct HoldReleased {
    pub vault: Pubkey,
    pub hold: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub guardian: Pubkey,
}

#[event]
pub struct HoldRejected {
    pub vault: Pubkey,
    pub hold: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub by: Pubkey,
}

#[event]
pub struct HoldExpired {
    pub vault: Pubkey,
    pub hold: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct VaultFrozen {
    pub vault: Pubkey,
    pub by: Pubkey,
    /// True when the backend scam sentinel froze it.
    pub sentinel: bool,
}

#[event]
pub struct FreezeVoteRecorded {
    pub vault: Pubkey,
    pub guardian: Pubkey,
    pub votes: u8,
    pub required: u8,
}

#[event]
pub struct UnfreezeRequested {
    pub vault: Pubkey,
    pub requested_at: i64,
    pub effective_at: i64,
}

#[event]
pub struct VaultUnfrozen {
    pub vault: Pubkey,
    /// The guardian who unfroze it, or `None` when the senior's delayed unfreeze executed.
    pub by: Option<Pubkey>,
}
