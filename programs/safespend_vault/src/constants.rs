use anchor_lang::prelude::*;

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
#[constant]
pub const PAYEE_SEED: &[u8] = b"payee";
#[constant]
pub const PENDING_SEED: &[u8] = b"pending";
#[constant]
pub const ESCROW_SEED: &[u8] = b"escrow";

pub const MAX_GUARDIANS: usize = 3;
/// Caps hold spam from a compromised agent: it can lock funds in holds but never release them.
pub const MAX_OPEN_HOLDS: u8 = 5;
/// The weekly cap uses a fixed window that restarts at the first payment after it lapses.
pub const WEEK_SECONDS: i64 = 7 * 24 * 60 * 60;
