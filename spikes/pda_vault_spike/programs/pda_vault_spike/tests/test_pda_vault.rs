//! LiteSVM tests for the G0.4 spike program. These run locally (no devnet) and
//! prove the program side: a PDA-owned ATA can be delegated via invoke_signed.
//! Whether Bridge/Stripe accept a PDA wallet is a separate, devnet-only question.

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{
            instruction::Instruction,
            program_option::COption,
            program_pack::Pack,
        },
        InstructionData, ToAccountMetas,
    },
    anchor_spl::{
        associated_token::get_associated_token_address,
        token::spl_token::{
            self,
            state::{Account as SplAccount, AccountState, Mint as SplMint},
        },
    },
    litesvm::LiteSVM,
    pda_vault_spike::{issuer_delegate, CARD_SEED},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const DECIMALS: u8 = 6;
const MERCHANT_ID: u64 = 1;

struct Env {
    svm: LiteSVM,
    authority: Keypair,
    mint: Pubkey,
}

fn setup() -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/pda_vault_spike.so"
    ));
    svm.add_program(pda_vault_spike::id(), bytes).unwrap();
    let authority = Keypair::new();
    svm.airdrop(&authority.pubkey(), 10_000_000_000).unwrap();

    let mint = Pubkey::new_unique();
    let mut data = [0u8; SplMint::LEN];
    SplMint::pack(
        SplMint {
            mint_authority: COption::None,
            supply: 1_000_000_000_000,
            decimals: DECIMALS,
            is_initialized: true,
            freeze_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    svm.set_account(
        mint,
        Account { lamports: 1_000_000_000, data: data.to_vec(), owner: spl_token::ID, executable: false, rent_epoch: 0 },
    )
    .unwrap();
    Env { svm, authority, mint }
}

fn set_token_account(svm: &mut LiteSVM, address: Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) {
    let mut data = [0u8; SplAccount::LEN];
    SplAccount::pack(
        SplAccount {
            mint,
            owner,
            amount,
            delegate: COption::None,
            state: AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        },
        &mut data,
    )
    .unwrap();
    svm.set_account(
        address,
        Account { lamports: 2_039_280, data: data.to_vec(), owner: spl_token::ID, executable: false, rent_epoch: 0 },
    )
    .unwrap();
}

fn token_account(svm: &LiteSVM, address: &Pubkey) -> SplAccount {
    SplAccount::unpack(&svm.get_account(address).unwrap().data).unwrap()
}

fn card_pda(authority: &Pubkey, card_id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[CARD_SEED, authority.as_ref(), &card_id.to_le_bytes()],
        &pda_vault_spike::id(),
    )
    .0
}

fn send(svm: &mut LiteSVM, ix: Instruction, signer: &Keypair) -> Result<(), String> {
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.err))
}

fn approve_ix(authority: Pubkey, card_id: u64, mint: Pubkey, delegate: Pubkey, amount: u64) -> Instruction {
    let card_authority = card_pda(&authority, card_id);
    let vault = get_associated_token_address(&card_authority, &mint);
    Instruction::new_with_bytes(
        pda_vault_spike::id(),
        &pda_vault_spike::instruction::ApproveIssuer { card_id, merchant_id: MERCHANT_ID, amount }.data(),
        pda_vault_spike::accounts::ApproveIssuer {
            authority,
            card_authority,
            mint,
            vault,
            issuer_delegate: delegate,
            token_program: spl_token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
        }
        .to_account_metas(None),
    )
}

#[test]
fn pda_vault_can_approve_issuer_delegate_and_revoke() {
    let Env { mut svm, authority, mint } = setup();
    let card_id = 1u64;
    let card_authority = card_pda(&authority.pubkey(), card_id);
    assert!(!card_authority.is_on_curve(), "card authority must be off-curve (a PDA)");
    let vault = get_associated_token_address(&card_authority, &mint);
    set_token_account(&mut svm, vault, mint, card_authority, 3_000_000);

    let (delegate, _) = issuer_delegate(MERCHANT_ID, &mint, &vault);
    send(&mut svm, approve_ix(authority.pubkey(), card_id, mint, delegate, 3_000_000), &authority).unwrap();

    let acct = token_account(&svm, &vault);
    assert_eq!(acct.delegate, COption::Some(delegate));
    assert_eq!(acct.delegated_amount, 3_000_000);

    // Revoke clears the delegate.
    let revoke = Instruction::new_with_bytes(
        pda_vault_spike::id(),
        &pda_vault_spike::instruction::RevokeIssuer { card_id }.data(),
        pda_vault_spike::accounts::RevokeIssuer {
            authority: authority.pubkey(),
            card_authority,
            mint,
            vault,
            token_program: spl_token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, revoke, &authority).unwrap();
    let acct = token_account(&svm, &vault);
    assert_eq!(acct.delegate, COption::None);
    assert_eq!(acct.delegated_amount, 0);
}

#[test]
fn wrong_issuer_delegate_is_rejected() {
    let Env { mut svm, authority, mint } = setup();
    let card_authority = card_pda(&authority.pubkey(), 1);
    let vault = get_associated_token_address(&card_authority, &mint);
    set_token_account(&mut svm, vault, mint, card_authority, 3_000_000);

    let attacker_delegate = Pubkey::new_unique();
    let err = send(&mut svm, approve_ix(authority.pubkey(), 1, mint, attacker_delegate, 1_000_000), &authority).unwrap_err();
    assert!(err.contains("Custom(6000)"), "expected InvalidIssuerDelegate, got {err}");
    assert_eq!(token_account(&svm, &vault).delegate, COption::None);
}

#[test]
fn approve_above_balance_is_rejected() {
    let Env { mut svm, authority, mint } = setup();
    let card_authority = card_pda(&authority.pubkey(), 1);
    let vault = get_associated_token_address(&card_authority, &mint);
    set_token_account(&mut svm, vault, mint, card_authority, 1_000_000);
    let (delegate, _) = issuer_delegate(MERCHANT_ID, &mint, &vault);

    let err = send(&mut svm, approve_ix(authority.pubkey(), 1, mint, delegate, 1_000_001), &authority).unwrap_err();
    assert!(err.contains("Custom(6001)"), "expected InsufficientVaultBalance, got {err}");
}

#[test]
fn another_signer_cannot_approve_someone_elses_vault() {
    let Env { mut svm, authority, mint } = setup();
    let card_authority = card_pda(&authority.pubkey(), 1);
    let vault = get_associated_token_address(&card_authority, &mint);
    set_token_account(&mut svm, vault, mint, card_authority, 1_000_000);
    let (delegate, _) = issuer_delegate(MERCHANT_ID, &mint, &vault);

    let mallory = Keypair::new();
    svm.airdrop(&mallory.pubkey(), 1_000_000_000).unwrap();
    // Mallory passes the victim's card_authority + vault but signs as herself: the
    // seeds constraint (which includes the signer) must fail.
    let mut ix = approve_ix(authority.pubkey(), 1, mint, delegate, 1_000_000);
    ix.accounts[0].pubkey = mallory.pubkey();
    assert!(send(&mut svm, ix, &mallory).is_err());
    assert_eq!(token_account(&svm, &vault).delegate, COption::None);
}

#[test]
fn withdraw_returns_funds_to_authority() {
    let Env { mut svm, authority, mint } = setup();
    let card_authority = card_pda(&authority.pubkey(), 1);
    let vault = get_associated_token_address(&card_authority, &mint);
    set_token_account(&mut svm, vault, mint, card_authority, 2_500_000);
    let dest = get_associated_token_address(&authority.pubkey(), &mint);
    set_token_account(&mut svm, dest, mint, authority.pubkey(), 0);

    let ix = Instruction::new_with_bytes(
        pda_vault_spike::id(),
        &pda_vault_spike::instruction::Withdraw { card_id: 1, amount: 2_500_000 }.data(),
        pda_vault_spike::accounts::Withdraw {
            authority: authority.pubkey(),
            card_authority,
            mint,
            vault,
            destination: dest,
            token_program: spl_token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, ix, &authority).unwrap();
    assert_eq!(token_account(&svm, &vault).amount, 0);
    assert_eq!(token_account(&svm, &dest).amount, 2_500_000);
}
