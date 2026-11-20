use anchor_lang::prelude::*;

use crate::{
    error::SafeSpendError,
    events::{FreezeVoteRecorded, UnfreezeRequested, VaultFrozen, VaultUnfrozen},
    state::Vault,
};

#[derive(Accounts)]
pub struct Freeze<'info> {
    /// A guardian, or the agent session key acting as the scam sentinel.
    pub authority: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
}

/// Blocks `pay`, `request_hold` and `approve`. Any single guardian or the sentinel can freeze, except
/// that after a senior self-unfreeze a family guardian only casts a vote until a quorum is reached
/// (a professional guardian or the sentinel still freezes alone).
pub fn handle_freeze(ctx: Context<Freeze>) -> Result<()> {
    let authority = ctx.accounts.authority.key();
    let vault = &mut ctx.accounts.vault;
    require!(!vault.frozen, SafeSpendError::AlreadyFrozen);

    let sentinel = authority == vault.agent_session_key;
    if !sentinel {
        let index = vault
            .guardian_index(&authority)
            .ok_or(SafeSpendError::NotGuardian)?;
        if vault.self_unfrozen_at.is_some() && !vault.is_professional(index) {
            let votes_mask = vault.freeze_votes | (1u8 << index);
            let votes = votes_mask.count_ones();
            let required = vault.refreeze_quorum();
            if votes < required {
                vault.freeze_votes = votes_mask;
                emit!(FreezeVoteRecorded {
                    vault: vault.key(),
                    guardian: authority,
                    votes: votes as u8,
                    required: required as u8,
                });
                return Ok(());
            }
        }
    }

    vault.frozen = true;
    vault.freeze_votes = 0;
    vault.unfreeze_requested_at = None;
    emit!(VaultFrozen {
        vault: vault.key(),
        by: authority,
        sentinel,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct Unfreeze<'info> {
    pub guardian: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
}

/// Instant guardian unfreeze (authenticated dashboard tap, never voice).
pub fn handle_unfreeze(ctx: Context<Unfreeze>) -> Result<()> {
    let guardian = ctx.accounts.guardian.key();
    let vault = &mut ctx.accounts.vault;
    require!(vault.frozen, SafeSpendError::NotFrozen);
    require!(vault.is_guardian(&guardian), SafeSpendError::NotGuardian);
    vault.frozen = false;
    vault.unfreeze_requested_at = None;
    vault.self_unfrozen_at = None;
    vault.freeze_votes = 0;
    emit!(VaultUnfrozen {
        vault: vault.key(),
        by: Some(guardian),
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RequestUnfreeze<'info> {
    pub senior: Signer<'info>,
    #[account(mut, has_one = senior @ SafeSpendError::Unauthorized)]
    pub vault: Account<'info, Vault>,
}

/// Starts the senior's self-unfreeze clock. Payments stay frozen for the whole delay and every
/// guardian is alerted, so a scammer can't turn a coached "unfreeze" into an instant payment.
pub fn handle_request_unfreeze(ctx: Context<RequestUnfreeze>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let vault = &mut ctx.accounts.vault;
    require!(vault.frozen, SafeSpendError::NotFrozen);
    require!(
        vault.unfreeze_requested_at.is_none(),
        SafeSpendError::UnfreezeAlreadyRequested
    );
    let effective_at = now
        .checked_add(vault.unfreeze_delay_seconds)
        .ok_or(SafeSpendError::MathOverflow)?;
    vault.unfreeze_requested_at = Some(now);
    emit!(UnfreezeRequested {
        vault: vault.key(),
        requested_at: now,
        effective_at,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteUnfreeze<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
}

/// Permissionless once the delay has passed, so no guardian can hold the senior's money hostage.
pub fn handle_execute_unfreeze(ctx: Context<ExecuteUnfreeze>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let vault = &mut ctx.accounts.vault;
    require!(vault.frozen, SafeSpendError::NotFrozen);
    let requested_at = vault
        .unfreeze_requested_at
        .ok_or(SafeSpendError::NoUnfreezeRequested)?;
    let effective_at = requested_at
        .checked_add(vault.unfreeze_delay_seconds)
        .ok_or(SafeSpendError::MathOverflow)?;
    require!(now >= effective_at, SafeSpendError::UnfreezeDelayNotElapsed);
    vault.frozen = false;
    vault.unfreeze_requested_at = None;
    vault.self_unfrozen_at = Some(now);
    vault.freeze_votes = 0;
    emit!(VaultUnfrozen {
        vault: vault.key(),
        by: None,
    });
    Ok(())
}
