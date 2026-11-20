use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::SafeSpendError,
    events::{PayeeProposed, PayeeRemoved, SetupCompleted},
    state::{Payee, Vault},
};

#[derive(Accounts)]
#[instruction(recipient: Pubkey)]
pub struct AddPayee<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// The senior or a guardian.
    pub proposer: Signer<'info>,
    pub vault: Account<'info, Vault>,
    #[account(
        init,
        payer = payer,
        space = 8 + Payee::INIT_SPACE,
        seeds = [PAYEE_SEED, vault.key().as_ref(), recipient.as_ref()],
        bump
    )]
    pub payee: Account<'info, Payee>,
    pub system_program: Program<'info, System>,
}

/// Proposes an allowlist entry. After onboarding it only becomes usable once the waiting period
/// passes, so a coached or compromised change can't be paid right away and everyone gets alerted.
pub fn handle_add_payee(ctx: Context<AddPayee>, recipient: Pubkey) -> Result<()> {
    let vault = &ctx.accounts.vault;
    let proposer = ctx.accounts.proposer.key();
    require!(
        proposer == vault.senior || vault.is_guardian(&proposer),
        SafeSpendError::Unauthorized
    );
    require!(
        recipient != Pubkey::default() && recipient != vault.key(),
        SafeSpendError::InvalidRecipient
    );

    let now = Clock::get()?.unix_timestamp;
    let active_at = if vault.setup_complete {
        now.checked_add(vault.change_delay_seconds)
            .ok_or(SafeSpendError::MathOverflow)?
    } else {
        now
    };
    ctx.accounts.payee.set_inner(Payee {
        vault: vault.key(),
        recipient,
        active_at,
        rent_payer: ctx.accounts.payer.key(),
        bump: ctx.bumps.payee,
    });

    emit!(PayeeProposed {
        vault: vault.key(),
        recipient,
        proposed_by: proposer,
        active_at,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RemovePayee<'info> {
    /// The senior or a guardian.
    pub signer: Signer<'info>,
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        has_one = vault,
        has_one = rent_payer,
        close = rent_payer,
        seeds = [PAYEE_SEED, vault.key().as_ref(), payee.recipient.as_ref()],
        bump = payee.bump
    )]
    pub payee: Account<'info, Payee>,
    /// CHECK: bound by `has_one` on `payee`; only receives the rent refund.
    #[account(mut)]
    pub rent_payer: UncheckedAccount<'info>,
}

/// Removal takes effect immediately: it can only narrow where money may go.
pub fn handle_remove_payee(ctx: Context<RemovePayee>) -> Result<()> {
    let vault = &ctx.accounts.vault;
    let signer = ctx.accounts.signer.key();
    require!(
        signer == vault.senior || vault.is_guardian(&signer),
        SafeSpendError::Unauthorized
    );
    emit!(PayeeRemoved {
        vault: vault.key(),
        recipient: ctx.accounts.payee.recipient,
        removed_by: signer,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct CompleteSetup<'info> {
    pub senior: Signer<'info>,
    #[account(mut, has_one = senior @ SafeSpendError::Unauthorized)]
    pub vault: Account<'info, Vault>,
}

/// Ends onboarding: from now on every new payee waits `change_delay_seconds`.
pub fn handle_complete_setup(ctx: Context<CompleteSetup>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.setup_complete = true;
    emit!(SetupCompleted { vault: vault.key() });
    Ok(())
}
