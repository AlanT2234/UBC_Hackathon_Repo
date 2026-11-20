use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{constants::*, error::SafeSpendError, events::VaultInitialized, state::Vault};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitVaultParams {
    pub guardians: Vec<Pubkey>,
    pub professional_mask: u8,
    pub big_amount_threshold: u64,
    pub per_payment_limit: u64,
    pub weekly_cap: u64,
    pub hold_seconds: i64,
    pub unfreeze_delay_seconds: i64,
    pub change_delay_seconds: i64,
    pub agent_session_key: Pubkey,
}

#[derive(Accounts)]
pub struct InitVault<'info> {
    /// Backend fee payer; the senior never holds SOL.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub senior: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, senior.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = vault
    )]
    pub vault_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_vault(ctx: Context<InitVault>, p: InitVaultParams) -> Result<()> {
    let senior = ctx.accounts.senior.key();
    let n = p.guardians.len();
    require!((1..=MAX_GUARDIANS).contains(&n), SafeSpendError::InvalidConfig);
    for (i, g) in p.guardians.iter().enumerate() {
        require!(
            *g != senior && *g != p.agent_session_key && *g != Pubkey::default(),
            SafeSpendError::InvalidConfig
        );
        require!(!p.guardians[..i].contains(g), SafeSpendError::InvalidConfig);
    }
    require!(p.agent_session_key != senior, SafeSpendError::InvalidConfig);
    require!(u32::from(p.professional_mask) >> n == 0, SafeSpendError::InvalidConfig);
    require!(
        p.per_payment_limit > 0 && p.per_payment_limit <= p.weekly_cap,
        SafeSpendError::InvalidConfig
    );
    require!(p.big_amount_threshold > 0, SafeSpendError::InvalidConfig);
    require!(
        p.hold_seconds > 0 && p.unfreeze_delay_seconds >= 0 && p.change_delay_seconds >= 0,
        SafeSpendError::InvalidConfig
    );

    let now = Clock::get()?.unix_timestamp;
    let vault = &mut ctx.accounts.vault;
    vault.set_inner(Vault {
        senior,
        mint: ctx.accounts.mint.key(),
        guardians: p.guardians,
        professional_mask: p.professional_mask,
        big_amount_threshold: p.big_amount_threshold,
        per_payment_limit: p.per_payment_limit,
        weekly_cap: p.weekly_cap,
        window_start: now,
        spent_in_window: 0,
        hold_seconds: p.hold_seconds,
        unfreeze_delay_seconds: p.unfreeze_delay_seconds,
        change_delay_seconds: p.change_delay_seconds,
        frozen: false,
        unfreeze_requested_at: None,
        self_unfrozen_at: None,
        freeze_votes: 0,
        agent_session_key: p.agent_session_key,
        next_nonce: 0,
        open_holds: 0,
        setup_complete: false,
        bump: ctx.bumps.vault,
    });

    emit!(VaultInitialized {
        vault: vault.key(),
        senior,
        mint: vault.mint,
        guardians: vault.guardians.clone(),
    });
    Ok(())
}
