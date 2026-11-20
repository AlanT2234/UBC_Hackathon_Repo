use anchor_lang::prelude::*;

use crate::constants::*;

/// One per senior, PDA `["vault", senior]`. Owns the USDC associated token account that holds the
/// spendable balance; held funds sit in per-hold escrows, so this balance is always spendable.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub senior: Pubkey,
    pub mint: Pubkey,
    /// 1..=3. A vetted professional fills a slot when there is no family.
    #[max_len(3)]
    pub guardians: Vec<Pubkey>,
    /// Bitmap over `guardians` marking vetted professionals.
    pub professional_mask: u8,
    /// At or above this, a hold needs 2 approvals (if there are at least 2 guardians).
    pub big_amount_threshold: u64,
    pub per_payment_limit: u64,
    pub weekly_cap: u64,
    pub window_start: i64,
    pub spent_in_window: u64,
    /// Approval deadline length for holds.
    pub hold_seconds: i64,
    /// Senior self-unfreeze delay (~48h).
    pub unfreeze_delay_seconds: i64,
    /// Waiting period before a new payee becomes usable.
    pub change_delay_seconds: i64,
    pub frozen: bool,
    pub unfreeze_requested_at: Option<i64>,
    /// Set when a senior self-unfreeze executes; a family-guardian refreeze then needs a quorum.
    pub self_unfrozen_at: Option<i64>,
    /// Bitmap of guardians who voted to refreeze after a self-unfreeze.
    pub freeze_votes: u8,
    /// The backend's limited key: may only `pay`, `request_hold` and freeze (scam sentinel).
    pub agent_session_key: Pubkey,
    pub next_nonce: u64,
    pub open_holds: u8,
    /// While false, payees added at onboarding are active immediately.
    pub setup_complete: bool,
    pub bump: u8,
}

impl Vault {
    pub fn guardian_index(&self, key: &Pubkey) -> Option<usize> {
        self.guardians.iter().position(|g| g == key)
    }

    pub fn is_guardian(&self, key: &Pubkey) -> bool {
        self.guardian_index(key).is_some()
    }

    pub fn is_professional(&self, index: usize) -> bool {
        (self.professional_mask >> index) & 1 == 1
    }

    /// 2-of-N for big amounts; with fewer than 2 guardians, falls back to 1.
    pub fn approvals_required_for(&self, amount: u64) -> u8 {
        if amount >= self.big_amount_threshold && self.guardians.len() >= 2 {
            2
        } else {
            1
        }
    }

    /// Votes needed for a family-guardian refreeze after a senior self-unfreeze.
    pub fn refreeze_quorum(&self) -> u32 {
        self.guardians.len().min(2) as u32
    }

    pub fn window_expired(&self, now: i64) -> bool {
        now >= self.window_start.saturating_add(WEEK_SECONDS)
    }

    pub fn spent_this_window(&self, now: i64) -> u64 {
        if self.window_expired(now) {
            0
        } else {
            self.spent_in_window
        }
    }
}

/// Allowlist entry, PDA `["payee", vault, recipient]`. Usable from `active_at`.
#[account]
#[derive(InitSpace)]
pub struct Payee {
    pub vault: Pubkey,
    pub recipient: Pubkey,
    pub active_at: i64,
    pub rent_payer: Pubkey,
    pub bump: u8,
}

/// An escrowed payment awaiting guardian approval, PDA `["pending", vault, nonce_le]`.
/// Its funds sit in a token account at PDA `["escrow", pending]` owned by this account.
/// Every exit (approve, reject, expire) closes both, so there is no status field to keep in sync.
#[account]
#[derive(InitSpace)]
pub struct PendingTransfer {
    pub vault: Pubkey,
    /// Fixed at request time; guardians can only say yes or no, never redirect.
    pub recipient: Pubkey,
    pub amount: u64,
    pub nonce: u64,
    pub created_at: i64,
    /// Approval deadline. There is no auto-release: after it, the only exit is a refund.
    pub expires_at: i64,
    pub approvals_required: u8,
    /// Bitmap over `vault.guardians`.
    pub approvals: u8,
    pub rent_receiver: Pubkey,
    pub bump: u8,
    pub escrow_bump: u8,
}
