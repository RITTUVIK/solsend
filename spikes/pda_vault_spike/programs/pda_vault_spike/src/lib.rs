//! GATE 0 / G0.4 throwaway spike — NOT the SolSend program.
//!
//! Question under test: can a Stripe Issuing card whose `crypto_wallet[address]`
//! is a *PDA* (off-curve) be funded from that PDA's USDC ATA, with the SPL
//! delegate approval signed by this program via `invoke_signed`?
//!
//! The PDA ("card authority") owns the vault ATA. This program is the only way
//! to sign for it. `approve_issuer` approves the Bridge issuer delegate PDA
//! (derived from the issuer program) to pull up to `amount`.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Approve, Mint, Revoke, Token, TokenAccount, TransferChecked},
};

declare_id!("C31ntvRNLT8YuMuqHNkto5Pj3hgkQbCE1YZ4uaent8Zc");

/// Bridge card issuer program (per team plan; confirmed executable on devnet 2026-11-17).
pub const ISSUER_PROGRAM_ID: Pubkey = pubkey!("cardWArqhdV5jeRXXjUti7cHAa4mj41Nj3Apc6RPZH2");
pub const USER_DELEGATE_SEED: &[u8] = b"user_delegate";
pub const CARD_SEED: &[u8] = b"spike_card";

/// Derive the issuer delegate PDA exactly as the team plan specifies:
/// `["user_delegate", u64_le(merchant_id), mint, token_account]` under the issuer program.
pub fn issuer_delegate(merchant_id: u64, mint: &Pubkey, token_account: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            USER_DELEGATE_SEED,
            &merchant_id.to_le_bytes(),
            mint.as_ref(),
            token_account.as_ref(),
        ],
        &ISSUER_PROGRAM_ID,
    )
}

#[program]
pub mod pda_vault_spike {
    use super::*;

    /// Approve the issuer delegate PDA to pull up to `amount` from the PDA-owned vault.
    pub fn approve_issuer(
        ctx: Context<ApproveIssuer>,
        card_id: u64,
        merchant_id: u64,
        amount: u64,
    ) -> Result<()> {
        let (expected, _) = issuer_delegate(
            merchant_id,
            &ctx.accounts.mint.key(),
            &ctx.accounts.vault.key(),
        );
        require_keys_eq!(
            expected,
            ctx.accounts.issuer_delegate.key(),
            SpikeError::InvalidIssuerDelegate
        );
        require!(
            amount <= ctx.accounts.vault.amount,
            SpikeError::InsufficientVaultBalance
        );

        let authority = ctx.accounts.authority.key();
        let card_id_le = card_id.to_le_bytes();
        let bump = [ctx.bumps.card_authority];
        let seeds: &[&[u8]] = &[CARD_SEED, authority.as_ref(), &card_id_le, &bump];
        let signer: &[&[&[u8]]] = &[seeds];

        token::approve(
            CpiContext::new_with_signer(
                Token::id(),
                Approve {
                    to: ctx.accounts.vault.to_account_info(),
                    delegate: ctx.accounts.issuer_delegate.to_account_info(),
                    authority: ctx.accounts.card_authority.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;
        msg!(
            "spike: approved {} to issuer delegate {} on vault {}",
            amount,
            expected,
            ctx.accounts.vault.key()
        );
        Ok(())
    }

    /// Revoke any delegate on the PDA-owned vault.
    pub fn revoke_issuer(ctx: Context<RevokeIssuer>, card_id: u64) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        let card_id_le = card_id.to_le_bytes();
        let bump = [ctx.bumps.card_authority];
        let seeds: &[&[u8]] = &[CARD_SEED, authority.as_ref(), &card_id_le, &bump];
        let signer: &[&[&[u8]]] = &[seeds];

        token::revoke(CpiContext::new_with_signer(
            Token::id(),
            Revoke {
                source: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.card_authority.to_account_info(),
            },
            signer,
        ))?;
        msg!("spike: revoked delegate on vault {}", ctx.accounts.vault.key());
        Ok(())
    }

    /// Move `amount` from the PDA-owned vault back to the authority's token account (cleanup).
    pub fn withdraw(ctx: Context<Withdraw>, card_id: u64, amount: u64) -> Result<()> {
        let authority = ctx.accounts.authority.key();
        let card_id_le = card_id.to_le_bytes();
        let bump = [ctx.bumps.card_authority];
        let seeds: &[&[u8]] = &[CARD_SEED, authority.as_ref(), &card_id_le, &bump];
        let signer: &[&[&[u8]]] = &[seeds];

        token::transfer_checked(
            CpiContext::new_with_signer(
                Token::id(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.card_authority.to_account_info(),
                },
                signer,
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(card_id: u64)]
pub struct ApproveIssuer<'info> {
    pub authority: Signer<'info>,
    /// CHECK: data-less PDA; only used as the vault owner and CPI signer.
    #[account(seeds = [CARD_SEED, authority.key().as_ref(), &card_id.to_le_bytes()], bump)]
    pub card_authority: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = card_authority,
    )]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK: verified in the handler against the issuer program's derived delegate PDA.
    pub issuer_delegate: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(card_id: u64)]
pub struct RevokeIssuer<'info> {
    pub authority: Signer<'info>,
    /// CHECK: data-less PDA; only used as the vault owner and CPI signer.
    #[account(seeds = [CARD_SEED, authority.key().as_ref(), &card_id.to_le_bytes()], bump)]
    pub card_authority: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = card_authority,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(card_id: u64)]
pub struct Withdraw<'info> {
    pub authority: Signer<'info>,
    /// CHECK: data-less PDA; only used as the vault owner and CPI signer.
    #[account(seeds = [CARD_SEED, authority.key().as_ref(), &card_id.to_le_bytes()], bump)]
    pub card_authority: UncheckedAccount<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = card_authority,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = authority)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[error_code]
pub enum SpikeError {
    #[msg("issuer_delegate does not match the PDA derived from the issuer program")]
    InvalidIssuerDelegate,
    #[msg("approve amount exceeds vault balance")]
    InsufficientVaultBalance,
}
