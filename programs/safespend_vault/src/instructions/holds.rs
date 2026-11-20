use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

use crate::{
    constants::*,
    error::SafeSpendError,
    events::{HoldApproved, HoldCreated, HoldExpired, HoldRejected, HoldReleased},
    state::{PendingTransfer, Vault},
};

#[derive(Accounts)]
#[instruction(amount: u64, nonce: u64)]
pub struct RequestHold<'info> {
    /// Backend fee payer; gets the rent back when the hold closes.
    #[account(mut)]
    pub payer: Signer<'info>,
    pub agent: Signer<'info>,
    #[account(
        mut,
        constraint = vault.agent_session_key == agent.key() @ SafeSpendError::Unauthorized
    )]
    pub vault: Account<'info, Vault>,
    /// CHECK: any wallet; fixed here so approval can only ever pay this owner's token account.
    pub recipient: UncheckedAccount<'info>,
    #[account(address = vault.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault)]
    pub vault_token: Account<'info, TokenAccount>,
    /// Must already exist (the client creates it in the same transaction) so release can't fail.
    #[account(associated_token::mint = mint, associated_token::authority = recipient)]
    pub recipient_token: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        space = 8 + PendingTransfer::INIT_SPACE,
        seeds = [PENDING_SEED, vault.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub pending: Account<'info, PendingTransfer>,
    #[account(
        init,
        payer = payer,
        seeds = [ESCROW_SEED, pending.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = pending
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Moves funds from the vault into a per-hold escrow with an approval deadline.
pub fn handle_request_hold(ctx: Context<RequestHold>, amount: u64, nonce: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let vault = &ctx.accounts.vault;
    require!(!vault.frozen, SafeSpendError::Frozen);
    require!(amount > 0, SafeSpendError::InvalidAmount);
    require!(nonce == vault.next_nonce, SafeSpendError::InvalidNonce);
    require!(vault.open_holds < MAX_OPEN_HOLDS, SafeSpendError::TooManyHolds);
    require!(
        ctx.accounts.recipient.key() != vault.key(),
        SafeSpendError::InvalidRecipient
    );
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
                to: ctx.accounts.escrow.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    let expires_at = now
        .checked_add(vault.hold_seconds)
        .ok_or(SafeSpendError::MathOverflow)?;
    let approvals_required = vault.approvals_required_for(amount);
    ctx.accounts.pending.set_inner(PendingTransfer {
        vault: vault.key(),
        recipient: ctx.accounts.recipient.key(),
        amount,
        nonce,
        created_at: now,
        expires_at,
        approvals_required,
        approvals: 0,
        rent_receiver: ctx.accounts.payer.key(),
        bump: ctx.bumps.pending,
        escrow_bump: ctx.bumps.escrow,
    });

    let vault = &mut ctx.accounts.vault;
    vault.next_nonce = vault.next_nonce.checked_add(1).ok_or(SafeSpendError::MathOverflow)?;
    vault.open_holds += 1;

    emit!(HoldCreated {
        vault: vault.key(),
        hold: ctx.accounts.pending.key(),
        recipient: ctx.accounts.recipient.key(),
        amount,
        nonce,
        expires_at,
        approvals_required,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Approve<'info> {
    pub guardian: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        has_one = vault,
        has_one = recipient,
        has_one = rent_receiver,
        seeds = [PENDING_SEED, vault.key().as_ref(), &pending.nonce.to_le_bytes()],
        bump = pending.bump
    )]
    pub pending: Account<'info, PendingTransfer>,
    #[account(mut, seeds = [ESCROW_SEED, pending.key().as_ref()], bump = pending.escrow_bump)]
    pub escrow: Account<'info, TokenAccount>,
    /// CHECK: bound by `has_one` on `pending`.
    pub recipient: UncheckedAccount<'info>,
    #[account(address = vault.mint)]
    pub mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = recipient)]
    pub recipient_token: Account<'info, TokenAccount>,
    /// CHECK: bound by `has_one` on `pending`; only receives rent refunds.
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Records one guardian approval; releases to the fixed recipient once enough guardians agree.
pub fn handle_approve(ctx: Context<Approve>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let vault = &ctx.accounts.vault;
    let guardian = ctx.accounts.guardian.key();
    require!(!vault.frozen, SafeSpendError::Frozen);
    require!(now < ctx.accounts.pending.expires_at, SafeSpendError::HoldExpired);
    let index = vault
        .guardian_index(&guardian)
        .ok_or(SafeSpendError::NotGuardian)?;
    let bit = 1u8 << index;
    require!(ctx.accounts.pending.approvals & bit == 0, SafeSpendError::AlreadyApproved);

    let pending = &mut ctx.accounts.pending;
    pending.approvals |= bit;
    let approvals = pending.approvals.count_ones() as u8;
    if approvals < pending.approvals_required {
        emit!(HoldApproved {
            vault: vault.key(),
            hold: pending.key(),
            guardian,
            approvals,
            approvals_required: pending.approvals_required,
        });
        return Ok(());
    }

    let (amount, recipient) = (pending.amount, pending.recipient);
    let a = &ctx.accounts;
    settle_and_close(
        &a.token_program,
        &a.pending,
        &a.escrow,
        a.recipient_token.to_account_info(),
        a.rent_receiver.to_account_info(),
    )?;
    let vault = &mut ctx.accounts.vault;
    vault.open_holds = vault.open_holds.saturating_sub(1);

    emit!(HoldReleased {
        vault: vault.key(),
        hold: ctx.accounts.pending.key(),
        recipient,
        amount,
        guardian,
    });
    Ok(())
}

/// Accounts shared by both refund exits.
#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        has_one = vault,
        has_one = rent_receiver,
        seeds = [PENDING_SEED, vault.key().as_ref(), &pending.nonce.to_le_bytes()],
        bump = pending.bump
    )]
    pub pending: Account<'info, PendingTransfer>,
    #[account(mut, seeds = [ESCROW_SEED, pending.key().as_ref()], bump = pending.escrow_bump)]
    pub escrow: Account<'info, TokenAccount>,
    #[account(mut, address = anchor_spl::associated_token::get_associated_token_address(&vault.key(), &vault.mint))]
    pub vault_token: Account<'info, TokenAccount>,
    /// CHECK: bound by `has_one` on `pending`; only receives rent refunds.
    #[account(mut)]
    pub rent_receiver: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

impl<'info> Refund<'info> {
    fn refund(&mut self) -> Result<()> {
        settle_and_close(
            &self.token_program,
            &self.pending,
            &self.escrow,
            self.vault_token.to_account_info(),
            self.rent_receiver.to_account_info(),
        )?;
        self.vault.open_holds = self.vault.open_holds.saturating_sub(1);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Reject<'info> {
    /// The senior or a guardian.
    pub signer: Signer<'info>,
    pub refund: Refund<'info>,
}

/// Refunds the hold to the vault. Works while frozen: money only moves back home.
pub fn handle_reject(ctx: Context<Reject>) -> Result<()> {
    let signer = ctx.accounts.signer.key();
    let r = &mut ctx.accounts.refund;
    require!(
        signer == r.vault.senior || r.vault.is_guardian(&signer),
        SafeSpendError::Unauthorized
    );
    let event = HoldRejected {
        vault: r.vault.key(),
        hold: r.pending.key(),
        recipient: r.pending.recipient,
        amount: r.pending.amount,
        by: signer,
    };
    r.refund()?;
    emit!(event);
    Ok(())
}

#[derive(Accounts)]
pub struct Expire<'info> {
    pub refund: Refund<'info>,
}

/// Permissionless once the deadline passes; the backend scheduler calls it.
pub fn handle_expire(ctx: Context<Expire>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let r = &mut ctx.accounts.refund;
    require!(now >= r.pending.expires_at, SafeSpendError::HoldNotExpired);
    let event = HoldExpired {
        vault: r.vault.key(),
        hold: r.pending.key(),
        recipient: r.pending.recipient,
        amount: r.pending.amount,
    };
    r.refund()?;
    emit!(event);
    Ok(())
}

/// Moves the whole escrow to `destination`, then closes the escrow and the pending record, sending
/// their rent to `rent_receiver`. Closing both is what makes a second approve/reject/expire impossible.
fn settle_and_close<'info>(
    token_program: &Program<'info, Token>,
    pending: &Account<'info, PendingTransfer>,
    escrow: &Account<'info, TokenAccount>,
    destination: AccountInfo<'info>,
    rent_receiver: AccountInfo<'info>,
) -> Result<()> {
    let nonce = pending.nonce.to_le_bytes();
    let bump = [pending.bump];
    let seeds: &[&[u8]] = &[PENDING_SEED, pending.vault.as_ref(), &nonce, &bump];
    let signer = &[seeds];

    token::transfer(
        CpiContext::new_with_signer(
            token_program.key(),
            Transfer {
                from: escrow.to_account_info(),
                to: destination,
                authority: pending.to_account_info(),
            },
            signer,
        ),
        escrow.amount,
    )?;
    token::close_account(CpiContext::new_with_signer(
        token_program.key(),
        CloseAccount {
            account: escrow.to_account_info(),
            destination: rent_receiver.clone(),
            authority: pending.to_account_info(),
        },
        signer,
    ))?;
    pending.close(rent_receiver)
}
