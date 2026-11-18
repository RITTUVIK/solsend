//! SolSend policy program (CP1 CONTRACT).
//!
//! Each SolSend card is a delegation in the Solana Foundation's Subscriptions & Allowances
//! program (`De1egAFM…`): FixedDelegation for StoreLocked / OneTime cards, RecurringDelegation
//! for Subscription cards. The delegatee is this program's Card PDA, so ONLY this program can
//! pull — and only through `settle`, which enforces card policy and per-authorization
//! idempotency (one SettlementRecord PDA per card authorization).
//!
//! Trust model (docs/TRUST.md): the settlement authority can pull a live card up to its onchain
//! allowance into the program treasury and nowhere else; refunds go only to the card's stored
//! source token account; the admin can pause, rotate the settlement key and withdraw the treasury
//! only to a fixed destination; users can revoke any card directly in the Allowances program.
//!
//! IDL STABILITY: account structs, instruction names/args/account order and events below are the
//! CP1 contract consumed by packages/shared. Changing them requires coordinator approval.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

declare_id!("GfMyGffqQA7KNUYWByEDtQKEFmHzBPTJgsuYSaruWdZp");

// ── External program + seeds ───────────────────────────────────────────────
pub const ALLOWANCES_PROGRAM_ID: Pubkey = pubkey!("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44");
pub const SA_SEED: &[u8] = b"SubscriptionAuthority";
pub const DELEGATION_SEED: &[u8] = b"delegation";
pub const EVENT_AUTHORITY_SEED: &[u8] = b"event_authority";
pub const ALLOWANCES_IX_TRANSFER_FIXED: u8 = 4;
pub const ALLOWANCES_IX_TRANSFER_RECURRING: u8 = 5;

pub const CONFIG_SEED: &[u8] = b"config";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const CARD_SEED: &[u8] = b"card";
pub const SETTLE_SEED: &[u8] = b"settle";

/// SettlementRecords older than this (or fully refunded) may be closed to reclaim rent.
pub const RECORD_RETENTION_SECS: i64 = 7 * 24 * 60 * 60;

// ── Enums stored as u8 (IDL-friendly) ──────────────────────────────────────
pub const KIND_STORE_LOCKED: u8 = 0; // FixedDelegation, merchant-locked on first settle
pub const KIND_ONE_TIME: u8 = 1; // FixedDelegation, merchant-locked, status -> Used after first settle
pub const KIND_SUBSCRIPTION: u8 = 2; // RecurringDelegation (per-period cap), merchant-locked

pub const STATUS_ACTIVE: u8 = 0;
pub const STATUS_FROZEN: u8 = 1;
pub const STATUS_USED: u8 = 2;
pub const STATUS_CLOSED: u8 = 3;

#[program]
pub mod solsend {
    use super::*;

    /// Admin creates the singleton Config. `treasury_destination` is the ONLY token account that
    /// `admin_withdraw` may ever pay (fixed at init). `per_tx_max` 0 = no per-transaction cap.
    pub fn initialize_config(ctx: Context<InitializeConfig>, args: InitializeConfigArgs) -> Result<()> {
        handlers::initialize_config(ctx, args)
    }

    /// Admin rotates the settlement authority (e.g., suspected key compromise).
    pub fn set_settlement_authority(ctx: Context<AdminOnly>, new_authority: Pubkey) -> Result<()> {
        handlers::set_settlement_authority(ctx, new_authority)
    }

    /// Admin kill switch: when paused, `settle` is refused (reduce-only; refunds still work).
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        handlers::set_paused(ctx, paused)
    }

    /// Owner registers a card whose spending power is an EXISTING Allowances delegation created in
    /// the same transaction (delegator = owner, delegatee = this Card PDA). `payer` sponsors rent.
    /// Must verify: delegation owned by the Allowances program; header.delegator == owner;
    /// header.delegatee == card PDA; delegation PDA == derive(SA(owner, mint), owner, card, nonce);
    /// delegation type matches `kind` (fixed for StoreLocked/OneTime, recurring for Subscription).
    pub fn register_card(ctx: Context<RegisterCard>, card_id: u64, kind: u8, delegation_nonce: u64, label: [u8; 32]) -> Result<()> {
        handlers::register_card(ctx, card_id, kind, delegation_nonce, label)
    }

    /// Settlement authority pulls `amount` (USDC base units) for ONE card authorization.
    /// Refuse when: config.paused; card not Active; per_tx_max exceeded; idle (now - max(created,last_used)
    /// > idle_secs); merchant_hash != card.merchant_lock (lock set on first settle). Creates the
    /// SettlementRecord (init ⇒ duplicate auth fails atomically), CPIs transfer_fixed/transfer_recurring
    /// with the Card PDA as delegatee signer into the treasury ATA, reads the remaining allowance from
    /// the delegation account AFTER the CPI, updates totals, OneTime ⇒ status Used, emits CardSettled.
    pub fn settle(ctx: Context<Settle>, amount: u64, auth_hash: [u8; 32], merchant_hash: [u8; 32]) -> Result<()> {
        handlers::settle(ctx, amount, auth_hash, merchant_hash)
    }

    /// Settlement authority refunds part/all of ONE settled authorization from the treasury to the
    /// card's stored source token account. Bounded: record.refunded + amount <= record.amount.
    /// Works for any card status (refunds after freeze/close must still land). Does NOT restore the
    /// card's consumed allowance (MVP product decision). Emits CardRefunded.
    pub fn refund(ctx: Context<Refund>, amount: u64, auth_hash: [u8; 32]) -> Result<()> {
        handlers::refund(ctx, amount, auth_hash)
    }

    /// Owner OR settlement authority (reduce-only) freezes an Active card. Emits CardFrozen.
    pub fn freeze_card(ctx: Context<FreezeCard>) -> Result<()> {
        handlers::freeze_card(ctx)
    }

    /// Owner only: Frozen -> Active. Emits CardUnfrozen.
    pub fn unfreeze_card(ctx: Context<OwnerCard>) -> Result<()> {
        handlers::unfreeze_card(ctx)
    }

    /// Owner closes a card (status Closed, account kept so late refunds still work). The client
    /// includes Allowances `revoke_delegation` in the same transaction. Emits CardClosed.
    pub fn close_card(ctx: Context<OwnerCard>) -> Result<()> {
        handlers::close_card(ctx)
    }

    /// Settlement authority reclaims rent of a SettlementRecord that is fully refunded or older than
    /// RECORD_RETENTION_SECS.
    pub fn close_settlement_record(ctx: Context<CloseSettlementRecord>, auth_hash: [u8; 32]) -> Result<()> {
        handlers::close_settlement_record(ctx, auth_hash)
    }

    /// Admin moves treasury funds ONLY to config.treasury_destination (issuer-settlement account).
    pub fn admin_withdraw(ctx: Context<AdminWithdraw>, amount: u64) -> Result<()> {
        handlers::admin_withdraw(ctx, amount)
    }
}

// ── Args / state ────────────────────────────────────────────────────────────
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeConfigArgs {
    pub settlement_authority: Pubkey,
    pub treasury_destination: Pubkey,
    pub per_tx_max: u64,
    pub idle_secs: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub settlement_authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub treasury_destination: Pubkey,
    pub per_tx_max: u64,
    pub idle_secs: i64,
    pub paused: bool,
    pub treasury_bump: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Card {
    pub owner: Pubkey,
    pub card_id: u64,
    pub kind: u8,
    pub status: u8,
    pub delegation: Pubkey,
    pub delegation_nonce: u64,
    /// The ONLY refund destination (owner's USDC ATA at registration).
    pub source_token_account: Pubkey,
    pub label: [u8; 32],
    /// sha256(card-network merchant acceptor id) of the first settled merchant; zero = not yet locked.
    pub merchant_lock: [u8; 32],
    pub created_ts: i64,
    pub last_used_ts: i64,
    pub total_settled: u64,
    pub total_refunded: u64,
    pub settle_count: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct SettlementRecord {
    pub card: Pubkey,
    pub auth_hash: [u8; 32],
    pub amount: u64,
    pub refunded: u64,
    pub created_ts: i64,
    pub bump: u8,
}

// ── Accounts ───────────────────────────────────────────────────────────────
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    /// CHECK: data-less PDA owning the treasury ATA.
    #[account(seeds = [TREASURY_SEED], bump)]
    pub treasury: UncheckedAccount<'info>,
    pub usdc_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ SolsendError::NotAdmin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(card_id: u64)]
pub struct RegisterCard<'info> {
    pub owner: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = payer, space = 8 + Card::INIT_SPACE,
              seeds = [CARD_SEED, owner.key().as_ref(), &card_id.to_le_bytes()], bump)]
    pub card: Account<'info, Card>,
    /// CHECK: verified in the handler (owner program, header fields, derivation, type).
    pub delegation: UncheckedAccount<'info>,
    #[account(associated_token::mint = usdc_mint, associated_token::authority = owner)]
    pub owner_ata: Account<'info, TokenAccount>,
    #[account(address = config.usdc_mint @ SolsendError::InvalidMint)]
    pub usdc_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, auth_hash: [u8; 32])]
pub struct Settle<'info> {
    #[account(mut, address = config.settlement_authority @ SolsendError::NotSettlementAuthority)]
    pub settlement_authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CARD_SEED, card.owner.as_ref(), &card.card_id.to_le_bytes()], bump = card.bump)]
    pub card: Account<'info, Card>,
    #[account(init, payer = settlement_authority, space = 8 + SettlementRecord::INIT_SPACE,
              seeds = [SETTLE_SEED, card.key().as_ref(), auth_hash.as_ref()], bump)]
    pub settlement_record: Account<'info, SettlementRecord>,
    /// CHECK: must equal card.delegation (Allowances delegation PDA).
    #[account(mut, address = card.delegation @ SolsendError::DelegationMismatch)]
    pub delegation: UncheckedAccount<'info>,
    /// CHECK: owner's Subscription Authority PDA (verified against derivation in handler).
    pub subscription_authority: UncheckedAccount<'info>,
    #[account(mut, address = card.source_token_account @ SolsendError::SourceMismatch)]
    pub source_token_account: Account<'info, TokenAccount>,
    /// CHECK: data-less treasury PDA.
    #[account(seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = treasury)]
    pub treasury_ata: Account<'info, TokenAccount>,
    #[account(address = config.usdc_mint @ SolsendError::InvalidMint)]
    pub usdc_mint: Account<'info, Mint>,
    /// CHECK: Allowances event authority PDA (verified in handler).
    pub event_authority: UncheckedAccount<'info>,
    /// CHECK: the Allowances program.
    #[account(address = ALLOWANCES_PROGRAM_ID)]
    pub allowances_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, auth_hash: [u8; 32])]
pub struct Refund<'info> {
    #[account(address = config.settlement_authority @ SolsendError::NotSettlementAuthority)]
    pub settlement_authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CARD_SEED, card.owner.as_ref(), &card.card_id.to_le_bytes()], bump = card.bump)]
    pub card: Account<'info, Card>,
    #[account(mut, has_one = card, seeds = [SETTLE_SEED, card.key().as_ref(), auth_hash.as_ref()], bump = settlement_record.bump)]
    pub settlement_record: Account<'info, SettlementRecord>,
    #[account(mut, address = card.source_token_account @ SolsendError::SourceMismatch)]
    pub source_token_account: Account<'info, TokenAccount>,
    /// CHECK: data-less treasury PDA (signs the refund).
    #[account(seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = treasury)]
    pub treasury_ata: Account<'info, TokenAccount>,
    #[account(address = config.usdc_mint @ SolsendError::InvalidMint)]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FreezeCard<'info> {
    /// Owner or the settlement authority (verified in handler).
    pub authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CARD_SEED, card.owner.as_ref(), &card.card_id.to_le_bytes()], bump = card.bump)]
    pub card: Account<'info, Card>,
}

#[derive(Accounts)]
pub struct OwnerCard<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner @ SolsendError::NotOwner,
              seeds = [CARD_SEED, owner.key().as_ref(), &card.card_id.to_le_bytes()], bump = card.bump)]
    pub card: Account<'info, Card>,
}

#[derive(Accounts)]
#[instruction(auth_hash: [u8; 32])]
pub struct CloseSettlementRecord<'info> {
    #[account(mut, address = config.settlement_authority @ SolsendError::NotSettlementAuthority)]
    pub settlement_authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub card: Account<'info, Card>,
    #[account(mut, has_one = card, close = settlement_authority,
              seeds = [SETTLE_SEED, card.key().as_ref(), auth_hash.as_ref()], bump = settlement_record.bump)]
    pub settlement_record: Account<'info, SettlementRecord>,
}

#[derive(Accounts)]
pub struct AdminWithdraw<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ SolsendError::NotAdmin)]
    pub config: Account<'info, Config>,
    /// CHECK: data-less treasury PDA (signs the withdrawal).
    #[account(seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = treasury)]
    pub treasury_ata: Account<'info, TokenAccount>,
    #[account(mut, address = config.treasury_destination @ SolsendError::InvalidDestination)]
    pub destination: Account<'info, TokenAccount>,
    #[account(address = config.usdc_mint @ SolsendError::InvalidMint)]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

// ── Events (decoded by the QuickNode Stream filter from `Program data:` logs) ──
#[event]
pub struct CardRegistered { pub card: Pubkey, pub owner: Pubkey, pub card_id: u64, pub kind: u8, pub delegation: Pubkey, pub label: [u8; 32] }
#[event]
pub struct CardSettled { pub card: Pubkey, pub owner: Pubkey, pub amount: u64, pub remaining_allowance: u64, pub auth_hash: [u8; 32], pub merchant_hash: [u8; 32], pub total_settled: u64, pub status_after: u8 }
#[event]
pub struct CardRefunded { pub card: Pubkey, pub owner: Pubkey, pub amount: u64, pub auth_hash: [u8; 32], pub record_refunded: u64, pub destination: Pubkey }
#[event]
pub struct CardFrozen { pub card: Pubkey, pub by: Pubkey }
#[event]
pub struct CardUnfrozen { pub card: Pubkey }
#[event]
pub struct CardClosed { pub card: Pubkey }
#[event]
pub struct ConfigUpdated { pub paused: bool, pub settlement_authority: Pubkey }

#[error_code]
pub enum SolsendError {
    #[msg("delegation does not match the card's Allowances delegation")]
    DelegationMismatch,
    #[msg("delegation account is not a valid Allowances delegation for this owner/card/kind")]
    InvalidDelegation,
    #[msg("invalid card kind")]
    InvalidKind,
    #[msg("card is not active")]
    CardNotActive,
    #[msg("card is idle-locked")]
    CardIdle,
    #[msg("merchant does not match the card's merchant lock")]
    MerchantMismatch,
    #[msg("amount exceeds the per-transaction maximum")]
    PerTxLimitExceeded,
    #[msg("settlements are paused")]
    Paused,
    #[msg("signer is not the settlement authority")]
    NotSettlementAuthority,
    #[msg("signer is not the admin")]
    NotAdmin,
    #[msg("signer is not the card owner")]
    NotOwner,
    #[msg("signer may not perform this action")]
    NotAuthorized,
    #[msg("source token account does not match the card")]
    SourceMismatch,
    #[msg("invalid USDC mint")]
    InvalidMint,
    #[msg("destination is not the configured treasury destination")]
    InvalidDestination,
    #[msg("invalid Allowances account")]
    InvalidAllowancesAccount,
    #[msg("amount must be > 0")]
    ZeroAmount,
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("refund would exceed the settled amount for this authorization")]
    RefundExceedsSettled,
    #[msg("settlement record is not yet closable")]
    RecordNotClosable,
}

/// Handler bodies — implemented by W1 (program owner). Signatures above are frozen by CP1.
pub mod handlers {
    use super::*;
    pub fn initialize_config(_ctx: Context<InitializeConfig>, _args: InitializeConfigArgs) -> Result<()> { err!(SolsendError::NotAuthorized) }
    pub fn set_settlement_authority(_ctx: Context<AdminOnly>, _new: Pubkey) -> Result<()> { err!(SolsendError::NotAuthorized) }
    pub fn set_paused(_ctx: Context<AdminOnly>, _paused: bool) -> Result<()> { err!(SolsendError::NotAuthorized) }
    pub fn register_card(_ctx: Context<RegisterCard>, _card_id: u64, _kind: u8, _nonce: u64, _label: [u8; 32]) -> Result<()> { err!(SolsendError::NotAuthorized) }
    pub fn settle(_ctx: Context<Settle>, _amount: u64, _auth_hash: [u8; 32], _merchant_hash: [u8; 32]) -> Result<()> { err!(SolsendError::NotAuthorized) }
    pub fn refund(_ctx: Context<Refund>, _amount: u64, _auth_hash: [u8; 32]) -> Result<()> { err!(SolsendError::NotAuthorized) }
    pub fn freeze_card(_ctx: Context<FreezeCard>) -> Result<()> { err!(SolsendError::NotAuthorized) }
    pub fn unfreeze_card(_ctx: Context<OwnerCard>) -> Result<()> { err!(SolsendError::NotAuthorized) }
    pub fn close_card(_ctx: Context<OwnerCard>) -> Result<()> { err!(SolsendError::NotAuthorized) }
    pub fn close_settlement_record(_ctx: Context<CloseSettlementRecord>, _auth_hash: [u8; 32]) -> Result<()> { err!(SolsendError::NotAuthorized) }
    pub fn admin_withdraw(_ctx: Context<AdminWithdraw>, _amount: u64) -> Result<()> { err!(SolsendError::NotAuthorized) }
}
