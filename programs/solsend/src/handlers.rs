//! Handler bodies for the CP1-frozen instruction interface in `lib.rs`.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, TransferChecked};

use crate::allowances::{self, TransferAccounts};
use crate::*;

fn now() -> Result<i64> {
    Ok(Clock::get()?.unix_timestamp)
}

fn emit_config_updated(config: &Config) {
    emit!(ConfigUpdated { paused: config.paused, settlement_authority: config.settlement_authority });
}

pub fn initialize_config(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
    // Negative idle windows are out of range (0 = idle lock disabled). The frozen error enum has
    // no dedicated config error, so this reuses `Overflow` ("value out of range").
    require!(args.idle_secs >= 0, SolsendError::Overflow);
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.settlement_authority = args.settlement_authority;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.treasury_destination = args.treasury_destination;
    config.per_tx_max = args.per_tx_max;
    config.idle_secs = args.idle_secs;
    config.paused = false;
    config.treasury_bump = ctx.bumps.treasury;
    config.bump = ctx.bumps.config;
    emit_config_updated(config);
    Ok(())
}

pub fn set_settlement_authority(ctx: Context<AdminOnly>, new_authority: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.settlement_authority = new_authority;
    emit_config_updated(config);
    Ok(())
}

pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.paused = paused;
    emit_config_updated(config);
    Ok(())
}

pub fn register_card(
    ctx: Context<RegisterCard>,
    card_id: u64,
    kind: u8,
    delegation_nonce: u64,
    label: [u8; 32],
    merchant_lock: [u8; 32],
) -> Result<()> {
    require!(kind <= KIND_SUBSCRIPTION, SolsendError::InvalidKind);
    let owner = ctx.accounts.owner.key();
    let card_key = ctx.accounts.card.key();
    let mint = ctx.accounts.config.usdc_mint;
    let delegation = &ctx.accounts.delegation;

    require_keys_eq!(*delegation.owner, ALLOWANCES_PROGRAM_ID, SolsendError::InvalidDelegation);
    let sa = allowances::derive_subscription_authority(&owner, &mint);
    {
        let data = delegation.try_borrow_data()?;
        require!(
            allowances::delegation_matches(&data, kind, &owner, &card_key, &sa, &mint),
            SolsendError::InvalidDelegation
        );
    }
    let expected = allowances::derive_delegation(&sa, &owner, &card_key, delegation_nonce);
    require_keys_eq!(expected, delegation.key(), SolsendError::InvalidDelegation);

    let ts = now()?;
    let card = &mut ctx.accounts.card;
    card.owner = owner;
    card.card_id = card_id;
    card.kind = kind;
    card.status = STATUS_ACTIVE;
    card.delegation = expected;
    card.delegation_nonce = delegation_nonce;
    card.source_token_account = ctx.accounts.owner_ata.key();
    card.label = label;
    // zero = lock to the first settled merchant; non-zero = pre-locked from registration
    card.merchant_lock = merchant_lock;
    card.created_ts = ts;
    card.last_used_ts = ts;
    card.total_settled = 0;
    card.total_refunded = 0;
    card.settle_count = 0;
    card.bump = ctx.bumps.card;
    emit!(CardRegistered { card: card_key, owner, card_id, kind, delegation: expected, label });
    Ok(())
}

pub fn settle(ctx: Context<Settle>, amount: u64, auth_hash: [u8; 32], merchant_hash: [u8; 32]) -> Result<()> {
    // Account constraints already ran: settlement authority, card PDA, delegation == card.delegation,
    // source == card.source_token_account, treasury ATA, mint, Allowances program id, and the
    // SettlementRecord `init` (a duplicate authorization fails here, atomically, before any pull).
    let config = &ctx.accounts.config;
    let card = &ctx.accounts.card;
    let ts = now()?;

    require!(amount > 0, SolsendError::ZeroAmount);
    require!(!config.paused, SolsendError::Paused);
    require!(card.status == STATUS_ACTIVE, SolsendError::CardNotActive);
    require!(config.per_tx_max == 0 || amount <= config.per_tx_max, SolsendError::PerTxLimitExceeded);
    // Idle lock (audit H1): StoreLocked / OneTime only. A Subscription is charged on its own
    // schedule (e.g. monthly, trials) and is governed by the recurring delegation's period cap.
    if card.kind != KIND_SUBSCRIPTION && config.idle_secs > 0 {
        let last_activity = card.created_ts.max(card.last_used_ts);
        require!(ts.saturating_sub(last_activity) <= config.idle_secs, SolsendError::CardIdle);
    }
    require!(merchant_hash != [0u8; 32], SolsendError::MerchantMismatch);
    let lock_now = card.merchant_lock == [0u8; 32];
    require!(lock_now || card.merchant_lock == merchant_hash, SolsendError::MerchantMismatch);
    require_keys_eq!(
        ctx.accounts.subscription_authority.key(),
        allowances::derive_subscription_authority(&card.owner, &config.usdc_mint),
        SolsendError::InvalidAllowancesAccount
    );
    require_keys_eq!(
        ctx.accounts.event_authority.key(),
        allowances::derive_event_authority(),
        SolsendError::InvalidAllowancesAccount
    );

    // Pull from the owner's wallet into the treasury; the Card PDA signs as delegatee. The
    // Allowances program enforces the delegation cap (300) / period cap (400), expiry and revocation.
    let owner = card.owner;
    let kind = card.kind;
    let card_id_le = card.card_id.to_le_bytes();
    let bump = [card.bump];
    let seeds: &[&[u8]] = &[CARD_SEED, owner.as_ref(), &card_id_le, &bump];
    let card_info = card.to_account_info();
    allowances::transfer(
        TransferAccounts {
            delegation: &ctx.accounts.delegation.to_account_info(),
            subscription_authority: &ctx.accounts.subscription_authority.to_account_info(),
            source: &ctx.accounts.source_token_account.to_account_info(),
            destination: &ctx.accounts.treasury_ata.to_account_info(),
            mint: &ctx.accounts.usdc_mint.to_account_info(),
            token_program: &ctx.accounts.token_program.to_account_info(),
            delegatee: &card_info,
            event_authority: &ctx.accounts.event_authority.to_account_info(),
            allowances_program: &ctx.accounts.allowances_program.to_account_info(),
        },
        kind,
        amount,
        &owner,
        &[seeds],
    )?;

    // Remaining spending power, read from the delegation AFTER the pull (recurring: current period).
    let delegation_remaining = allowances::remaining_allowance(&ctx.accounts.delegation.try_borrow_data()?, kind);

    let card_key = ctx.accounts.card.key();
    let record = &mut ctx.accounts.settlement_record;
    record.card = card_key;
    record.auth_hash = auth_hash;
    record.amount = amount;
    record.refunded = 0;
    record.created_ts = ts;
    record.bump = ctx.bumps.settlement_record;

    let card = &mut ctx.accounts.card;
    if lock_now {
        card.merchant_lock = merchant_hash;
    }
    card.total_settled = card.total_settled.checked_add(amount).ok_or(SolsendError::Overflow)?;
    card.settle_count = card.settle_count.checked_add(1).ok_or(SolsendError::Overflow)?;
    card.last_used_ts = ts;
    if card.kind == KIND_ONE_TIME {
        card.status = STATUS_USED;
    }
    // A card that can no longer settle (Used one-time) has no spending power, whatever the
    // delegation still holds (audit L3).
    let remaining_allowance = if card.status == STATUS_ACTIVE { delegation_remaining } else { 0 };
    emit!(CardSettled {
        card: card_key,
        owner,
        amount,
        remaining_allowance,
        auth_hash,
        merchant_hash,
        total_settled: card.total_settled,
        status_after: card.status,
    });
    Ok(())
}

pub fn refund(ctx: Context<Refund>, amount: u64, auth_hash: [u8; 32]) -> Result<()> {
    require!(amount > 0, SolsendError::ZeroAmount);
    let record = &ctx.accounts.settlement_record;
    let new_refunded = record.refunded.checked_add(amount).ok_or(SolsendError::Overflow)?;
    require!(new_refunded <= record.amount, SolsendError::RefundExceedsSettled);

    let bump = [ctx.accounts.config.treasury_bump];
    let seeds: &[&[u8]] = &[TREASURY_SEED, &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.treasury_ata.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.source_token_account.to_account_info(),
                authority: ctx.accounts.treasury.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    ctx.accounts.settlement_record.refunded = new_refunded;
    let destination = ctx.accounts.source_token_account.key();
    let card_key = ctx.accounts.card.key();
    let card = &mut ctx.accounts.card;
    card.total_refunded = card.total_refunded.checked_add(amount).ok_or(SolsendError::Overflow)?;
    emit!(CardRefunded { card: card_key, owner: card.owner, amount, auth_hash, record_refunded: new_refunded, destination });
    Ok(())
}

pub fn freeze_card(ctx: Context<FreezeCard>) -> Result<()> {
    let by = ctx.accounts.authority.key();
    require!(
        by == ctx.accounts.card.owner || by == ctx.accounts.config.settlement_authority,
        SolsendError::NotAuthorized
    );
    require!(ctx.accounts.card.status == STATUS_ACTIVE, SolsendError::CardNotActive);
    let card_key = ctx.accounts.card.key();
    ctx.accounts.card.status = STATUS_FROZEN;
    emit!(CardFrozen { card: card_key, by });
    Ok(())
}

pub fn unfreeze_card(ctx: Context<OwnerCard>) -> Result<()> {
    // Owner re-activation (audit H1): Frozen -> Active, or an Active card (typically idle-locked)
    // re-armed. Both reset the idle timer. Used / Closed are final.
    let status = ctx.accounts.card.status;
    require!(status == STATUS_FROZEN || status == STATUS_ACTIVE, SolsendError::NotAuthorized);
    let ts = now()?;
    let card_key = ctx.accounts.card.key();
    let card = &mut ctx.accounts.card;
    card.status = STATUS_ACTIVE;
    card.last_used_ts = ts;
    emit!(CardUnfrozen { card: card_key });
    Ok(())
}

pub fn close_card(ctx: Context<OwnerCard>) -> Result<()> {
    require!(ctx.accounts.card.status != STATUS_CLOSED, SolsendError::CardNotActive);
    let card_key = ctx.accounts.card.key();
    ctx.accounts.card.status = STATUS_CLOSED;
    emit!(CardClosed { card: card_key });
    Ok(())
}
