//! CP0b / S1 spike — NOT the SolSend program.
//!
//! Question under test: can a SolSend policy program act as the *delegatee* of a
//! Solana Subscriptions & Allowances delegation (FixedDelegation / RecurringDelegation),
//! signing the pull with a Card PDA via `invoke_signed`, while enforcing its own
//! policy (card status, settlement authority, idempotency per authorization)?
//!
//! Funds flow: user's USDC ATA --(Allowances transfer_fixed/recurring, SA delegate)--> treasury ATA.
//! The user's funds never sit in a SolSend account before a confirmed pull.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

declare_id!("8uSYgZn5rvEbrpc3NgQFvqcqMA7snptsmiey5457ddR9");

/// Solana Subscriptions & Allowances program (Solana Foundation / Moonsong Labs).
pub const ALLOWANCES_PROGRAM_ID: Pubkey = pubkey!("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44");
pub const SA_SEED: &[u8] = b"SubscriptionAuthority";
pub const DELEGATION_SEED: &[u8] = b"delegation";
pub const EVENT_AUTHORITY_SEED: &[u8] = b"event_authority";
const IX_TRANSFER_FIXED: u8 = 4;
const IX_TRANSFER_RECURRING: u8 = 5;

pub const CONFIG_SEED: &[u8] = b"config";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const CARD_SEED: &[u8] = b"card";
pub const SETTLE_SEED: &[u8] = b"settle";

pub const KIND_FIXED: u8 = 0;
pub const KIND_RECURRING: u8 = 1;
pub const STATUS_ACTIVE: u8 = 0;
pub const STATUS_FROZEN: u8 = 1;

pub fn derive_subscription_authority(user: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[SA_SEED, user.as_ref(), mint.as_ref()], &ALLOWANCES_PROGRAM_ID).0
}

pub fn derive_delegation(sa: &Pubkey, delegator: &Pubkey, delegatee: &Pubkey, nonce: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[DELEGATION_SEED, sa.as_ref(), delegator.as_ref(), delegatee.as_ref(), &nonce.to_le_bytes()],
        &ALLOWANCES_PROGRAM_ID,
    )
    .0
}

pub fn derive_event_authority() -> Pubkey {
    Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &ALLOWANCES_PROGRAM_ID).0
}

#[program]
pub mod allowances_spike {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, settlement_authority: Pubkey) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.settlement_authority = settlement_authority;
        c.mint = ctx.accounts.mint.key();
        c.treasury_bump = ctx.bumps.treasury;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Owner registers a card whose spending power is an Allowances delegation
    /// (delegator = owner, delegatee = this Card PDA). The refund/source account is
    /// fixed here and never taken from instruction args later.
    pub fn register_card(ctx: Context<RegisterCard>, card_id: u64, kind: u8, delegation_nonce: u64) -> Result<()> {
        require!(kind == KIND_FIXED || kind == KIND_RECURRING, SpikeError::InvalidKind);
        let owner = ctx.accounts.owner.key();
        let mint = ctx.accounts.config.mint;
        let sa = derive_subscription_authority(&owner, &mint);
        let expected = derive_delegation(&sa, &owner, &ctx.accounts.card.key(), delegation_nonce);
        require_keys_eq!(expected, ctx.accounts.delegation.key(), SpikeError::DelegationMismatch);

        let card = &mut ctx.accounts.card;
        card.owner = owner;
        card.card_id = card_id;
        card.kind = kind;
        card.status = STATUS_ACTIVE;
        card.delegation = expected;
        card.delegation_nonce = delegation_nonce;
        card.source_token_account = ctx.accounts.owner_ata.key();
        card.total_settled = 0;
        card.total_refunded = 0;
        card.bump = ctx.bumps.card;
        Ok(())
    }

    /// Settlement authority pulls `amount` for one card authorization. Idempotent:
    /// the SettlementRecord PDA (seeded by the authorization hash) can only be created once,
    /// so a duplicate settle fails atomically and moves no funds.
    pub fn settle(ctx: Context<Settle>, amount: u64, auth_hash: [u8; 32]) -> Result<()> {
        require!(amount > 0, SpikeError::ZeroAmount);
        let card = &ctx.accounts.card;
        require!(card.status == STATUS_ACTIVE, SpikeError::CardNotActive);

        let owner = card.owner;
        let mint = ctx.accounts.mint.key();
        let disc = if card.kind == KIND_FIXED { IX_TRANSFER_FIXED } else { IX_TRANSFER_RECURRING };
        let mut data = Vec::with_capacity(1 + 8 + 32 + 32);
        data.push(disc);
        data.extend_from_slice(&amount.to_le_bytes());
        data.extend_from_slice(owner.as_ref());
        data.extend_from_slice(mint.as_ref());

        let ix = Instruction {
            program_id: ALLOWANCES_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.delegation.key(), false),
                AccountMeta::new_readonly(ctx.accounts.subscription_authority.key(), false),
                AccountMeta::new(ctx.accounts.source_token_account.key(), false),
                AccountMeta::new(ctx.accounts.treasury_ata.key(), false),
                AccountMeta::new_readonly(mint, false),
                AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
                AccountMeta::new_readonly(card.key(), true), // delegatee = Card PDA (signs via seeds)
                AccountMeta::new_readonly(ctx.accounts.event_authority.key(), false),
                AccountMeta::new_readonly(ALLOWANCES_PROGRAM_ID, false),
            ],
            data,
        };
        let card_id_le = card.card_id.to_le_bytes();
        let bump = [card.bump];
        let seeds: &[&[u8]] = &[CARD_SEED, owner.as_ref(), &card_id_le, &bump];
        invoke_signed(
            &ix,
            &[
                ctx.accounts.delegation.to_account_info(),
                ctx.accounts.subscription_authority.to_account_info(),
                ctx.accounts.source_token_account.to_account_info(),
                ctx.accounts.treasury_ata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.card.to_account_info(),
                ctx.accounts.event_authority.to_account_info(),
                ctx.accounts.allowances_program.to_account_info(),
            ],
            &[seeds],
        )?;

        // Remaining spending power, read from the Allowances delegation account AFTER the CPI
        // (fixed: `amount` at 171; recurring: amount_per_period@195 - amount_pulled_in_period@203).
        let remaining = {
            let d = ctx.accounts.delegation.try_borrow_data()?;
            if card.kind == KIND_FIXED && d.len() >= 179 {
                u64::from_le_bytes(d[171..179].try_into().unwrap())
            } else if d.len() >= 211 {
                let per = u64::from_le_bytes(d[195..203].try_into().unwrap());
                let pulled = u64::from_le_bytes(d[203..211].try_into().unwrap());
                per.saturating_sub(pulled)
            } else {
                0
            }
        };

        let record = &mut ctx.accounts.settlement_record;
        record.card = ctx.accounts.card.key();
        record.auth_hash = auth_hash;
        record.amount = amount;
        record.refunded = 0;
        record.bump = ctx.bumps.settlement_record;
        let card = &mut ctx.accounts.card;
        card.total_settled = card.total_settled.checked_add(amount).ok_or(SpikeError::Overflow)?;
        emit!(CardSettled {
            card: card.key(), owner: card.owner, amount, remaining_allowance: remaining,
            auth_hash, total_settled: card.total_settled,
        });
        Ok(())
    }

    pub fn freeze(ctx: Context<OwnerCard>) -> Result<()> {
        ctx.accounts.card.status = STATUS_FROZEN;
        Ok(())
    }

    /// Refund (void / late-settle-after-decline / reversal) for ONE settled authorization.
    /// Trust bounds: only the settlement authority; only from the treasury PDA; only to the
    /// card's stored source account; never more than `record.amount - record.refunded`.
    pub fn refund(ctx: Context<Refund>, amount: u64, _auth_hash: [u8; 32]) -> Result<()> {
        require!(amount > 0, SpikeError::ZeroAmount);
        let record = &mut ctx.accounts.settlement_record;
        let new_refunded = record.refunded.checked_add(amount).ok_or(SpikeError::Overflow)?;
        require!(new_refunded <= record.amount, SpikeError::RefundExceedsSettled);
        let bump = [ctx.accounts.config.treasury_bump];
        let seeds: &[&[u8]] = &[TREASURY_SEED, &bump];
        token::transfer_checked(
            CpiContext::new_with_signer(
                Token::id(),
                TransferChecked {
                    from: ctx.accounts.treasury_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.source_token_account.to_account_info(),
                    authority: ctx.accounts.treasury.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        record.refunded = new_refunded;
        let card = &mut ctx.accounts.card;
        card.total_refunded = card.total_refunded.checked_add(amount).ok_or(SpikeError::Overflow)?;
        emit!(CardRefunded {
            card: card.key(), owner: card.owner, amount, auth_hash: _auth_hash,
            record_refunded: new_refunded, destination: ctx.accounts.source_token_account.key(),
        });
        Ok(())
    }
}

/// Emitted after a confirmed-path pull; decoded from `Program data:` logs by the QuickNode Stream filter.
#[event]
pub struct CardSettled {
    pub card: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub remaining_allowance: u64,
    pub auth_hash: [u8; 32],
    pub total_settled: u64,
}

#[event]
pub struct CardRefunded {
    pub card: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub auth_hash: [u8; 32],
    pub record_refunded: u64,
    pub destination: Pubkey,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub settlement_authority: Pubkey,
    pub mint: Pubkey,
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
    pub source_token_account: Pubkey,
    pub total_settled: u64,
    pub total_refunded: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct SettlementRecord {
    pub card: Pubkey,
    pub auth_hash: [u8; 32],
    pub amount: u64,
    pub refunded: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    /// CHECK: data-less PDA that owns the treasury ATA.
    #[account(seeds = [TREASURY_SEED], bump)]
    pub treasury: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(card_id: u64)]
pub struct RegisterCard<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = owner, space = 8 + Card::INIT_SPACE,
              seeds = [CARD_SEED, owner.key().as_ref(), &card_id.to_le_bytes()], bump)]
    pub card: Account<'info, Card>,
    /// CHECK: must equal the derived Allowances delegation PDA (verified in handler).
    pub delegation: UncheckedAccount<'info>,
    #[account(associated_token::mint = mint, associated_token::authority = owner)]
    pub owner_ata: Account<'info, TokenAccount>,
    #[account(address = config.mint)]
    pub mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, auth_hash: [u8; 32])]
pub struct Settle<'info> {
    #[account(mut, address = config.settlement_authority @ SpikeError::NotSettlementAuthority)]
    pub settlement_authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CARD_SEED, card.owner.as_ref(), &card.card_id.to_le_bytes()], bump = card.bump)]
    pub card: Account<'info, Card>,
    #[account(init, payer = settlement_authority, space = 8 + SettlementRecord::INIT_SPACE,
              seeds = [SETTLE_SEED, card.key().as_ref(), auth_hash.as_ref()], bump)]
    pub settlement_record: Account<'info, SettlementRecord>,
    /// CHECK: verified against the card's stored delegation.
    #[account(mut, address = card.delegation @ SpikeError::DelegationMismatch)]
    pub delegation: UncheckedAccount<'info>,
    /// CHECK: verified as the owner's Subscription Authority PDA.
    #[account(address = derive_subscription_authority(&card.owner, &config.mint) @ SpikeError::InvalidSubscriptionAuthority)]
    pub subscription_authority: UncheckedAccount<'info>,
    #[account(mut, address = card.source_token_account @ SpikeError::SourceMismatch)]
    pub source_token_account: Account<'info, TokenAccount>,
    /// CHECK: data-less treasury PDA.
    #[account(seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = treasury)]
    pub treasury_ata: Account<'info, TokenAccount>,
    #[account(address = config.mint)]
    pub mint: Account<'info, Mint>,
    /// CHECK: Allowances event authority PDA.
    #[account(address = derive_event_authority())]
    pub event_authority: UncheckedAccount<'info>,
    /// CHECK: the Allowances program itself.
    #[account(address = ALLOWANCES_PROGRAM_ID)]
    pub allowances_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, auth_hash: [u8; 32])]
pub struct Refund<'info> {
    #[account(address = config.settlement_authority @ SpikeError::NotSettlementAuthority)]
    pub settlement_authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CARD_SEED, card.owner.as_ref(), &card.card_id.to_le_bytes()], bump = card.bump)]
    pub card: Account<'info, Card>,
    #[account(mut, has_one = card, seeds = [SETTLE_SEED, card.key().as_ref(), auth_hash.as_ref()], bump = settlement_record.bump)]
    pub settlement_record: Account<'info, SettlementRecord>,
    #[account(mut, address = card.source_token_account @ SpikeError::SourceMismatch)]
    pub source_token_account: Account<'info, TokenAccount>,
    /// CHECK: data-less treasury PDA (signs the refund transfer).
    #[account(seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: UncheckedAccount<'info>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = treasury)]
    pub treasury_ata: Account<'info, TokenAccount>,
    #[account(address = config.mint)]
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OwnerCard<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner, seeds = [CARD_SEED, owner.key().as_ref(), &card.card_id.to_le_bytes()], bump = card.bump)]
    pub card: Account<'info, Card>,
}

#[error_code]
pub enum SpikeError {
    #[msg("delegation account does not match the derived Allowances delegation PDA")]
    DelegationMismatch,
    #[msg("invalid card kind")]
    InvalidKind,
    #[msg("card is not active")]
    CardNotActive,
    #[msg("signer is not the settlement authority")]
    NotSettlementAuthority,
    #[msg("invalid subscription authority")]
    InvalidSubscriptionAuthority,
    #[msg("source token account does not match the card")]
    SourceMismatch,
    #[msg("amount must be > 0")]
    ZeroAmount,
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("refund would exceed the settled amount for this authorization")]
    RefundExceedsSettled,
}
