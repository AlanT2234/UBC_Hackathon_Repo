//! SafeSpend vault: the language model proposes; this program disposes.
//!
//! One vault PDA per senior holds USDC. The backend's agent session key can only `pay` allowlisted
//! payees within limits or `request_hold` into a per-hold escrow; guardians approve, reject and
//! freeze but can never start a payment.

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("EDNVa6JcB6sabYhnhGiAhvLvPLBGLmiJRTnixFPS4RM8");

#[program]
pub mod safespend_vault {
    use super::*;

    pub fn init_vault(ctx: Context<InitVault>, params: InitVaultParams) -> Result<()> {
        instructions::init_vault::handle_init_vault(ctx, params)
    }

    pub fn add_payee(ctx: Context<AddPayee>, recipient: Pubkey) -> Result<()> {
        instructions::payees::handle_add_payee(ctx, recipient)
    }

    pub fn remove_payee(ctx: Context<RemovePayee>) -> Result<()> {
        instructions::payees::handle_remove_payee(ctx)
    }

    pub fn complete_setup(ctx: Context<CompleteSetup>) -> Result<()> {
        instructions::payees::handle_complete_setup(ctx)
    }

    pub fn pay(ctx: Context<Pay>, amount: u64) -> Result<()> {
        instructions::pay::handle_pay(ctx, amount)
    }

    pub fn request_hold(ctx: Context<RequestHold>, amount: u64, nonce: u64) -> Result<()> {
        instructions::holds::handle_request_hold(ctx, amount, nonce)
    }

    pub fn approve(ctx: Context<Approve>) -> Result<()> {
        instructions::holds::handle_approve(ctx)
    }

    pub fn reject(ctx: Context<Reject>) -> Result<()> {
        instructions::holds::handle_reject(ctx)
    }

    pub fn expire(ctx: Context<Expire>) -> Result<()> {
        instructions::holds::handle_expire(ctx)
    }

    pub fn freeze(ctx: Context<Freeze>) -> Result<()> {
        instructions::freeze::handle_freeze(ctx)
    }

    pub fn unfreeze(ctx: Context<Unfreeze>) -> Result<()> {
        instructions::freeze::handle_unfreeze(ctx)
    }

    pub fn request_unfreeze(ctx: Context<RequestUnfreeze>) -> Result<()> {
        instructions::freeze::handle_request_unfreeze(ctx)
    }

    pub fn execute_unfreeze(ctx: Context<ExecuteUnfreeze>) -> Result<()> {
        instructions::freeze::handle_execute_unfreeze(ctx)
    }
}
