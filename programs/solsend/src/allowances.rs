//! Solana Subscriptions & Allowances (`De1egAFM…`) integration: PDA derivations, account layouts
//! and the hand-built `transfer_fixed` / `transfer_recurring` CPI.
//!
//! Layouts come from the pinned Codama IDL (`solana-foundation/subscriptions@57290f41`,
//! `accountDiscriminator` enum + `header` struct) and were verified against the devnet binary
//! (sha256 `2675ad1d…ddbf`) in CP0b S1 / S1f. All Allowances accounts are `#[repr(C, packed)]`.
//!
//! ```text
//! Header (107):            disc u8 @0 | version u8 @1 | bump u8 @2 | delegator @3 | delegatee @35
//!                          | payer @67 | init_id i64 @99
//! FixedDelegation (187):   header | subscription_authority @107 | mint @139 | amount u64 @171
//!                          | expiry_ts i64 @179
//! RecurringDelegation (211): header | subscription_authority @107 | mint @139
//!                          | current_period_start_ts @171 | period_length_s @179 | expiry_ts @187
//!                          | amount_per_period u64 @195 | amount_pulled_in_period u64 @203
//! ```

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

use crate::{
    ALLOWANCES_IX_TRANSFER_FIXED, ALLOWANCES_IX_TRANSFER_RECURRING, ALLOWANCES_PROGRAM_ID, DELEGATION_SEED,
    EVENT_AUTHORITY_SEED, KIND_SUBSCRIPTION, SA_SEED,
};

/// Codama `accountDiscriminator` (u8 at offset 0 of every Allowances account).
pub const ACCOUNT_DISC_FIXED_DELEGATION: u8 = 2;
pub const ACCOUNT_DISC_RECURRING_DELEGATION: u8 = 3;

pub const HEADER_DISCRIMINATOR_OFFSET: usize = 0;
pub const HEADER_DELEGATOR_OFFSET: usize = 3;
pub const HEADER_DELEGATEE_OFFSET: usize = 35;
pub const DELEGATION_SA_OFFSET: usize = 107;
pub const DELEGATION_MINT_OFFSET: usize = 139;

pub const FIXED_AMOUNT_OFFSET: usize = 171;
pub const FIXED_DELEGATION_LEN: usize = 187;

pub const RECURRING_AMOUNT_PER_PERIOD_OFFSET: usize = 195;
pub const RECURRING_PULLED_IN_PERIOD_OFFSET: usize = 203;
pub const RECURRING_DELEGATION_LEN: usize = 211;

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

/// The Allowances account type (and minimum length) a card kind must be backed by:
/// FixedDelegation for StoreLocked / OneTime, RecurringDelegation for Subscription.
pub fn expected_delegation_type(kind: u8) -> (u8, usize) {
    if kind == KIND_SUBSCRIPTION {
        (ACCOUNT_DISC_RECURRING_DELEGATION, RECURRING_DELEGATION_LEN)
    } else {
        (ACCOUNT_DISC_FIXED_DELEGATION, FIXED_DELEGATION_LEN)
    }
}

/// True when `data` is a delegation of the type `kind` requires, with the given header and mint.
pub fn delegation_matches(data: &[u8], kind: u8, delegator: &Pubkey, delegatee: &Pubkey, sa: &Pubkey, mint: &Pubkey) -> bool {
    let (disc, min_len) = expected_delegation_type(kind);
    data.len() >= min_len
        && data[HEADER_DISCRIMINATOR_OFFSET] == disc
        && &data[HEADER_DELEGATOR_OFFSET..HEADER_DELEGATOR_OFFSET + 32] == delegator.as_ref()
        && &data[HEADER_DELEGATEE_OFFSET..HEADER_DELEGATEE_OFFSET + 32] == delegatee.as_ref()
        && &data[DELEGATION_SA_OFFSET..DELEGATION_SA_OFFSET + 32] == sa.as_ref()
        && &data[DELEGATION_MINT_OFFSET..DELEGATION_MINT_OFFSET + 32] == mint.as_ref()
}

fn read_u64(data: &[u8], offset: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&data[offset..offset + 8]);
    u64::from_le_bytes(b)
}

/// Spending power left on the delegation: fixed = remaining lifetime cap; recurring =
/// amount_per_period - amount_pulled_in_period (saturating; current period as of the last pull).
/// Returns 0 for an account that is not (or no longer) a delegation of the expected type.
pub fn remaining_allowance(data: &[u8], kind: u8) -> u64 {
    let (disc, min_len) = expected_delegation_type(kind);
    if data.len() < min_len || data[HEADER_DISCRIMINATOR_OFFSET] != disc {
        return 0;
    }
    if kind == KIND_SUBSCRIPTION {
        read_u64(data, RECURRING_AMOUNT_PER_PERIOD_OFFSET).saturating_sub(read_u64(data, RECURRING_PULLED_IN_PERIOD_OFFSET))
    } else {
        read_u64(data, FIXED_AMOUNT_OFFSET)
    }
}

/// Accounts for the Allowances transfer CPI, in the program's required order.
pub struct TransferAccounts<'a, 'info> {
    pub delegation: &'a AccountInfo<'info>,
    pub subscription_authority: &'a AccountInfo<'info>,
    pub source: &'a AccountInfo<'info>,
    pub destination: &'a AccountInfo<'info>,
    pub mint: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
    /// The delegatee (SolSend Card PDA); signs via `signer_seeds`.
    pub delegatee: &'a AccountInfo<'info>,
    pub event_authority: &'a AccountInfo<'info>,
    pub allowances_program: &'a AccountInfo<'info>,
}

/// `transfer_fixed` (4) / `transfer_recurring` (5). Data: `[disc] amount_le delegator mint`.
/// Accounts: delegation(w), SA, source(w), destination(w), mint, token program, delegatee(signer),
/// event authority, Allowances program (self-CPI event emission).
pub fn transfer(a: TransferAccounts<'_, '_>, kind: u8, amount: u64, delegator: &Pubkey, signer_seeds: &[&[&[u8]]]) -> Result<()> {
    let disc = if kind == KIND_SUBSCRIPTION { ALLOWANCES_IX_TRANSFER_RECURRING } else { ALLOWANCES_IX_TRANSFER_FIXED };
    let mut data = Vec::with_capacity(1 + 8 + 32 + 32);
    data.push(disc);
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(delegator.as_ref());
    data.extend_from_slice(a.mint.key.as_ref());

    let ix = Instruction {
        program_id: ALLOWANCES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*a.delegation.key, false),
            AccountMeta::new_readonly(*a.subscription_authority.key, false),
            AccountMeta::new(*a.source.key, false),
            AccountMeta::new(*a.destination.key, false),
            AccountMeta::new_readonly(*a.mint.key, false),
            AccountMeta::new_readonly(*a.token_program.key, false),
            AccountMeta::new_readonly(*a.delegatee.key, true),
            AccountMeta::new_readonly(*a.event_authority.key, false),
            AccountMeta::new_readonly(ALLOWANCES_PROGRAM_ID, false),
        ],
        data,
    };
    invoke_signed(
        &ix,
        &[
            a.delegation.clone(),
            a.subscription_authority.clone(),
            a.source.clone(),
            a.destination.clone(),
            a.mint.clone(),
            a.token_program.clone(),
            a.delegatee.clone(),
            a.event_authority.clone(),
            a.allowances_program.clone(),
        ],
        signer_seeds,
    )
    .map_err(Into::into)
}
