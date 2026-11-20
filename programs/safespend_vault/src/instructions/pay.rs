use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{
    constants::*,
    error::SafeSpendError,
    events::PaymentSent,
    state::{Payee, Vault},
};

#[derive(Accounts)]
pub struct Pay<'info> {
    pub agent: Signer<'info>,
    #[account(
        mut,
        constraint = vault.agent_session_key == agent.key() @ SafeSpendError::Unauthorized
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        seeds = [PAYEE_SEED, vault.key().as_ref(), recipient.key().as_ref()],
        bump = payee.bump
    )]
    pub payee: Account<'info, Payee>,
    /// CHECK: only the owner of `recipient_token`; bound to the allowlist by the `payee` seeds.
    pub recipient: UncheckedAccount<'info>,
    #[account(address = vault.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault)]
    pub vault_token: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = recipient)]
    pub recipient_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// Instant payment to an active allowlisted payee, within the per-payment limit and weekly cap.
pub fn handle_pay(ctx: Context<Pay>, amount: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let vault = &ctx.accounts.vault;
    require!(!vault.frozen, SafeSpendError::Frozen);
    require!(amount > 0, SafeSpendError::InvalidAmount);
    require!(now >= ctx.accounts.payee.active_at, SafeSpendError::PayeeNotAllowlisted);
    require!(amount <= vault.per_payment_limit, SafeSpendError::OverPerPaymentLimit);
    let spent = vault
        .spent_this_window(now)
        .checked_add(amount)
        .ok_or(SafeSpendError::MathOverflow)?;
    require!(spent <= vault.weekly_cap, SafeSpendError::OverWeeklyCap);
    require!(
        amount <= ctx.accounts.vault_token.amount,
        SafeSpendError::InsufficientFunds
    );

    let senior = vault.senior;
    let bump = [vault.bump];
    let seeds: &[&[u8]] = &[VAULT_SEED, senior.as_ref(), &bump];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault_token.to_account_info(),
                to: ctx.accounts.recipient_token.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    let vault = &mut ctx.accounts.vault;
    if vault.window_expired(now) {
        vault.window_start = now;
    }
    vault.spent_in_window = spent;

    emit!(PaymentSent {
        vault: vault.key(),
        recipient: ctx.accounts.recipient.key(),
        amount,
        spent_in_window: spent,
    });
    Ok(())
}
