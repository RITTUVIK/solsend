//! CP0b / S1 — LiteSVM tests against the REAL Solana Subscriptions & Allowances program
//! binary dumped from devnet (run `scripts/fetch-vendor.sh` first).
//! Every Allowances instruction below is hand-built from its Codama IDL.

use {
    allowances_spike::{
        derive_delegation, derive_event_authority, derive_subscription_authority, ALLOWANCES_PROGRAM_ID,
        CARD_SEED, CONFIG_SEED, KIND_FIXED, KIND_RECURRING, SETTLE_SEED, TREASURY_SEED,
    },
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{
            instruction::{AccountMeta, Instruction},
            program_option::COption,
            program_pack::Pack,
            system_program,
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
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const USDC: u64 = 1_000_000;
const DAY: i64 = 86_400;

struct Env {
    svm: LiteSVM,
    owner: Keypair,
    settler: Keypair,
    mint: Pubkey,
    owner_ata: Pubkey,
    treasury_ata: Pubkey,
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> Result<u64, String> {
    svm.expire_blockhash(); // never collide with an identical earlier tx
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &bh);
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    svm.send_transaction(tx)
        .map(|m| m.compute_units_consumed)
        .map_err(|e| format!("{:?} | logs: {:?}", e.err, e.meta.logs.iter().rev().take(4).collect::<Vec<_>>()))
}

fn token_amount(svm: &LiteSVM, a: &Pubkey) -> u64 {
    SplAccount::unpack(&svm.get_account(a).unwrap().data).unwrap().amount
}

fn put_token_account(svm: &mut LiteSVM, addr: Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) {
    let mut d = [0u8; SplAccount::LEN];
    SplAccount::pack(
        SplAccount { mint, owner, amount, delegate: COption::None, state: AccountState::Initialized,
            is_native: COption::None, delegated_amount: 0, close_authority: COption::None },
        &mut d,
    ).unwrap();
    svm.set_account(addr, Account { lamports: 2_039_280, data: d.to_vec(), owner: spl_token::ID, executable: false, rent_epoch: 0 }).unwrap();
}

fn setup() -> Env {
    let mut svm = LiteSVM::new();
    svm.add_program(ALLOWANCES_PROGRAM_ID, include_bytes!("../../../vendor/subscriptions_devnet.so")).unwrap();
    svm.add_program(allowances_spike::id(), include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/allowances_spike.so"))).unwrap();
    let owner = Keypair::new();
    let settler = Keypair::new();
    let admin = Keypair::new();
    for k in [&owner, &settler, &admin] {
        svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    }
    let mint = Pubkey::new_unique();
    let mut d = [0u8; SplMint::LEN];
    SplMint::pack(SplMint { mint_authority: COption::None, supply: 1_000_000 * USDC, decimals: 6, is_initialized: true, freeze_authority: COption::None }, &mut d).unwrap();
    svm.set_account(mint, Account { lamports: 1_461_600, data: d.to_vec(), owner: spl_token::ID, executable: false, rent_epoch: 0 }).unwrap();

    let owner_ata = get_associated_token_address(&owner.pubkey(), &mint);
    put_token_account(&mut svm, owner_ata, mint, owner.pubkey(), 100 * USDC);
    let treasury = Pubkey::find_program_address(&[TREASURY_SEED], &allowances_spike::id()).0;
    let treasury_ata = get_associated_token_address(&treasury, &mint);
    put_token_account(&mut svm, treasury_ata, mint, treasury, 0);

    // policy config
    let config = Pubkey::find_program_address(&[CONFIG_SEED], &allowances_spike::id()).0;
    let ix = Instruction::new_with_bytes(
        allowances_spike::id(),
        &allowances_spike::instruction::InitializeConfig { settlement_authority: settler.pubkey() }.data(),
        allowances_spike::accounts::InitializeConfig { admin: admin.pubkey(), config, treasury, mint, system_program: system_program::ID }.to_account_metas(None),
    );
    send(&mut svm, &[ix], &admin, &[]).unwrap();

    // user creates their Subscription Authority (Allowances ix 0): SA becomes the ATA's single delegate (u64::MAX)
    let sa = derive_subscription_authority(&owner.pubkey(), &mint);
    let ix = Instruction {
        program_id: ALLOWANCES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(owner.pubkey(), true),
            AccountMeta::new(sa, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(owner_ata, false),
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new_readonly(spl_token::ID, false),
        ],
        data: vec![0],
    };
    send(&mut svm, &[ix], &owner, &[]).expect("init subscription authority");
    Env { svm, owner, settler, mint, owner_ata, treasury_ata }
}

fn sa_init_id(svm: &LiteSVM, sa: &Pubkey) -> i64 {
    let d = svm.get_account(sa).unwrap().data;
    i64::from_le_bytes(d[98..106].try_into().unwrap()) // disc1+user32+mint32+payer32+bump1
}

fn card_pda(owner: &Pubkey, id: u64) -> Pubkey {
    Pubkey::find_program_address(&[CARD_SEED, owner.as_ref(), &id.to_le_bytes()], &allowances_spike::id()).0
}

/// Allowances ix 1 (fixed) or 2 (recurring), delegator = owner, delegatee = Card PDA.
fn create_delegation(e: &mut Env, card: Pubkey, nonce: u64, kind: u8, amount: u64, period_s: u64, expiry: i64) -> Pubkey {
    let sa = derive_subscription_authority(&e.owner.pubkey(), &e.mint);
    let delegation = derive_delegation(&sa, &e.owner.pubkey(), &card, nonce);
    let init_id = sa_init_id(&e.svm, &sa);
    let now = e.svm.get_sysvar::<Clock>().unix_timestamp;
    let mut data = vec![if kind == KIND_FIXED { 1 } else { 2 }];
    data.extend_from_slice(&nonce.to_le_bytes());
    if kind == KIND_FIXED {
        data.extend_from_slice(&amount.to_le_bytes());
        data.extend_from_slice(&expiry.to_le_bytes());
    } else {
        data.extend_from_slice(&amount.to_le_bytes()); // amount_per_period
        data.extend_from_slice(&period_s.to_le_bytes());
        data.extend_from_slice(&now.to_le_bytes()); // start_ts
        data.extend_from_slice(&expiry.to_le_bytes());
    }
    data.extend_from_slice(&init_id.to_le_bytes());
    let ix = Instruction {
        program_id: ALLOWANCES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(e.owner.pubkey(), true),
            AccountMeta::new_readonly(sa, false),
            AccountMeta::new(delegation, false),
            AccountMeta::new_readonly(card, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    };
    let owner = e.owner.insecure_clone();
    send(&mut e.svm, &[ix], &owner, &[]).expect("create delegation");
    delegation
}

fn register(e: &mut Env, card_id: u64, kind: u8, nonce: u64, delegation: Pubkey) -> Result<u64, String> {
    let card = card_pda(&e.owner.pubkey(), card_id);
    let config = Pubkey::find_program_address(&[CONFIG_SEED], &allowances_spike::id()).0;
    let ix = Instruction::new_with_bytes(
        allowances_spike::id(),
        &allowances_spike::instruction::RegisterCard { card_id, kind, delegation_nonce: nonce }.data(),
        allowances_spike::accounts::RegisterCard {
            owner: e.owner.pubkey(), config, card, delegation, owner_ata: e.owner_ata, mint: e.mint, system_program: system_program::ID,
        }.to_account_metas(None),
    );
    let owner = e.owner.insecure_clone();
    send(&mut e.svm, &[ix], &owner, &[])
}

fn settle_ix(e: &Env, signer: &Pubkey, card_id: u64, amount: u64, auth: [u8; 32]) -> Instruction {
    let card = card_pda(&e.owner.pubkey(), card_id);
    let config = Pubkey::find_program_address(&[CONFIG_SEED], &allowances_spike::id()).0;
    let treasury = Pubkey::find_program_address(&[TREASURY_SEED], &allowances_spike::id()).0;
    let delegation_acct = {
        let d = e.svm.get_account(&card).unwrap().data;
        // Card: disc8 owner32 card_id8 kind1 status1 delegation32 ...
        Pubkey::try_from(&d[8 + 32 + 8 + 1 + 1..8 + 32 + 8 + 1 + 1 + 32]).unwrap()
    };
    let record = Pubkey::find_program_address(&[SETTLE_SEED, card.as_ref(), auth.as_ref()], &allowances_spike::id()).0;
    Instruction::new_with_bytes(
        allowances_spike::id(),
        &allowances_spike::instruction::Settle { amount, auth_hash: auth }.data(),
        allowances_spike::accounts::Settle {
            settlement_authority: *signer, config, card, settlement_record: record, delegation: delegation_acct,
            subscription_authority: derive_subscription_authority(&e.owner.pubkey(), &e.mint),
            source_token_account: e.owner_ata, treasury, treasury_ata: e.treasury_ata, mint: e.mint,
            event_authority: derive_event_authority(), allowances_program: ALLOWANCES_PROGRAM_ID,
            token_program: spl_token::ID, associated_token_program: anchor_spl::associated_token::ID, system_program: system_program::ID,
        }.to_account_metas(None),
    )
}

fn settle(e: &mut Env, card_id: u64, amount: u64, auth: [u8; 32]) -> Result<u64, String> {
    let s = e.settler.insecure_clone();
    let ix = settle_ix(e, &s.pubkey(), card_id, amount, auth);
    send(&mut e.svm, &[ix], &s, &[])
}

fn fixed_remaining(svm: &LiteSVM, delegation: &Pubkey) -> u64 {
    let d = svm.get_account(delegation).unwrap().data;
    u64::from_le_bytes(d[171..179].try_into().unwrap()) // header107 + sa32 + mint32
}

fn h(n: u8) -> [u8; 32] {
    [n; 32]
}

#[test]
fn s1a_fixed_delegation_pull_via_cpi_with_card_pda_delegatee() {
    let mut e = setup();
    let card = card_pda(&e.owner.pubkey(), 1);
    let del = create_delegation(&mut e, card, 1, KIND_FIXED, 40 * USDC, 0, 0);
    register(&mut e, 1, KIND_FIXED, 1, del).expect("register card");
    let cu = settle(&mut e, 1, 23_170_000, h(1)).expect("settle 23.17 via CPI");
    println!("S1a settle compute units: {cu}");
    assert_eq!(token_amount(&e.svm, &e.owner_ata), 100 * USDC - 23_170_000);
    assert_eq!(token_amount(&e.svm, &e.treasury_ata), 23_170_000);
    assert_eq!(fixed_remaining(&e.svm, &del), 40 * USDC - 23_170_000, "delegation cap decremented by the Allowances program");
}

#[test]
fn s1b_pull_above_remaining_cap_fails_and_moves_nothing() {
    let mut e = setup();
    let card = card_pda(&e.owner.pubkey(), 1);
    let del = create_delegation(&mut e, card, 1, KIND_FIXED, 40 * USDC, 0, 0);
    register(&mut e, 1, KIND_FIXED, 1, del).unwrap();
    settle(&mut e, 1, 23_170_000, h(1)).unwrap();
    let before = (token_amount(&e.svm, &e.owner_ata), token_amount(&e.svm, &e.treasury_ata));
    let err = settle(&mut e, 1, 16_830_001, h(2)).unwrap_err();
    println!("S1b over-cap error: {err}");
    assert_eq!(before, (token_amount(&e.svm, &e.owner_ata), token_amount(&e.svm, &e.treasury_ata)));
    settle(&mut e, 1, 16_830_000, h(3)).expect("exactly the remaining cap is allowed");
    assert_eq!(fixed_remaining(&e.svm, &del), 0);
}

#[test]
fn s1c_revoke_outside_solsend_blocks_pull() {
    let mut e = setup();
    let card = card_pda(&e.owner.pubkey(), 1);
    let del = create_delegation(&mut e, card, 1, KIND_FIXED, 40 * USDC, 0, 0);
    register(&mut e, 1, KIND_FIXED, 1, del).unwrap();
    // The user revokes directly in the Allowances program (ix 3) — SolSend is not involved.
    let ix = Instruction { program_id: ALLOWANCES_PROGRAM_ID, accounts: vec![AccountMeta::new(e.owner.pubkey(), true), AccountMeta::new(del, false)], data: vec![3] };
    let owner = e.owner.insecure_clone();
    send(&mut e.svm, &[ix], &owner, &[]).expect("revoke delegation");
    let before = token_amount(&e.svm, &e.owner_ata);
    let err = settle(&mut e, 1, USDC, h(1)).unwrap_err();
    println!("S1c after external revoke: {err}");
    assert_eq!(before, token_amount(&e.svm, &e.owner_ata));
}

#[test]
fn s1d_recurring_delegation_period_cap_and_reset() {
    let mut e = setup();
    let card = card_pda(&e.owner.pubkey(), 2);
    let now = e.svm.get_sysvar::<Clock>().unix_timestamp;
    let del = create_delegation(&mut e, card, 7, KIND_RECURRING, 15_990_000, (30 * DAY) as u64, now + 365 * DAY);
    register(&mut e, 2, KIND_RECURRING, 7, del).unwrap();
    settle(&mut e, 2, 15_990_000, h(1)).expect("first period charge");
    let err = settle(&mut e, 2, 10_000, h(2)).unwrap_err();
    println!("S1d same-period overcharge: {err}");
    let mut clock = e.svm.get_sysvar::<Clock>();
    clock.unix_timestamp += 30 * DAY + 1;
    e.svm.set_sysvar::<Clock>(&clock);
    let err = settle(&mut e, 2, 22_990_000, h(3)).unwrap_err();
    println!("S1d price hike (22.99 > 15.99/period): {err}");
    settle(&mut e, 2, 15_990_000, h(4)).expect("next period charge after reset");
    assert_eq!(token_amount(&e.svm, &e.treasury_ata), 2 * 15_990_000);
}

#[test]
fn s1e_duplicate_authorization_settles_once() {
    let mut e = setup();
    let card = card_pda(&e.owner.pubkey(), 1);
    let del = create_delegation(&mut e, card, 1, KIND_FIXED, 40 * USDC, 0, 0);
    register(&mut e, 1, KIND_FIXED, 1, del).unwrap();
    settle(&mut e, 1, 5 * USDC, h(9)).unwrap();
    let before = (token_amount(&e.svm, &e.owner_ata), token_amount(&e.svm, &e.treasury_ata), fixed_remaining(&e.svm, &del));
    let err = settle(&mut e, 1, 5 * USDC, h(9)).unwrap_err();
    println!("S1e duplicate settle: {err}");
    assert_eq!(before, (token_amount(&e.svm, &e.owner_ata), token_amount(&e.svm, &e.treasury_ata), fixed_remaining(&e.svm, &del)));
}

#[test]
fn s1x_policy_and_attacker_checks() {
    let mut e = setup();
    let card = card_pda(&e.owner.pubkey(), 1);
    let del = create_delegation(&mut e, card, 1, KIND_FIXED, 40 * USDC, 0, 0);
    register(&mut e, 1, KIND_FIXED, 1, del).unwrap();
    let start = token_amount(&e.svm, &e.owner_ata);

    // (1) a non-settlement-authority signer cannot settle
    let mallory = Keypair::new();
    e.svm.airdrop(&mallory.pubkey(), 1_000_000_000).unwrap();
    let ix = settle_ix(&e, &mallory.pubkey(), 1, USDC, h(1));
    assert!(send(&mut e.svm, &[ix], &mallory, &[]).is_err(), "mallory settle must fail");

    // (2) mallory cannot pull directly from the Allowances program: the delegatee is the Card PDA
    let sa = derive_subscription_authority(&e.owner.pubkey(), &e.mint);
    let mallory_ata = get_associated_token_address(&mallory.pubkey(), &e.mint);
    put_token_account(&mut e.svm, mallory_ata, e.mint, mallory.pubkey(), 0);
    let mut data = vec![4];
    data.extend_from_slice(&USDC.to_le_bytes());
    data.extend_from_slice(e.owner.pubkey().as_ref());
    data.extend_from_slice(e.mint.as_ref());
    let direct = Instruction {
        program_id: ALLOWANCES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(del, false), AccountMeta::new_readonly(sa, false), AccountMeta::new(e.owner_ata, false),
            AccountMeta::new(mallory_ata, false), AccountMeta::new_readonly(e.mint, false), AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(mallory.pubkey(), true), AccountMeta::new_readonly(derive_event_authority(), false),
            AccountMeta::new_readonly(ALLOWANCES_PROGRAM_ID, false),
        ],
        data,
    };
    let err = send(&mut e.svm, &[direct], &mallory, &[]).unwrap_err();
    println!("S1x direct pull by non-delegatee: {err}");

    // (3) frozen card cannot be settled
    let ix = Instruction::new_with_bytes(
        allowances_spike::id(),
        &allowances_spike::instruction::Freeze {}.data(),
        allowances_spike::accounts::OwnerCard { owner: e.owner.pubkey(), card }.to_account_metas(None),
    );
    let owner = e.owner.insecure_clone();
    send(&mut e.svm, &[ix], &owner, &[]).unwrap();
    assert!(settle(&mut e, 1, USDC, h(2)).is_err(), "frozen card must not settle");
    assert_eq!(start, token_amount(&e.svm, &e.owner_ata), "no funds moved in any attack");

    // (4) registering a card against someone else's delegation address is rejected
    let bogus = Pubkey::new_unique();
    assert!(register(&mut e, 5, KIND_FIXED, 1, bogus).is_err());
}

fn refund(e: &mut Env, signer: &Keypair, card_id: u64, amount: u64, auth: [u8; 32]) -> Result<u64, String> {
    let card = card_pda(&e.owner.pubkey(), card_id);
    let config = Pubkey::find_program_address(&[CONFIG_SEED], &allowances_spike::id()).0;
    let treasury = Pubkey::find_program_address(&[TREASURY_SEED], &allowances_spike::id()).0;
    let record = Pubkey::find_program_address(&[SETTLE_SEED, card.as_ref(), auth.as_ref()], &allowances_spike::id()).0;
    let ix = Instruction::new_with_bytes(
        allowances_spike::id(),
        &allowances_spike::instruction::Refund { amount, _auth_hash: auth }.data(),
        allowances_spike::accounts::Refund {
            settlement_authority: signer.pubkey(), config, card, settlement_record: record, source_token_account: e.owner_ata,
            treasury, treasury_ata: e.treasury_ata, mint: e.mint, token_program: spl_token::ID,
        }.to_account_metas(None),
    );
    send(&mut e.svm, &[ix], signer, &[])
}

#[test]
fn s4_refund_is_bounded_per_authorization_and_only_to_source() {
    let mut e = setup();
    let card = card_pda(&e.owner.pubkey(), 1);
    let del = create_delegation(&mut e, card, 1, KIND_FIXED, 40 * USDC, 0, 0);
    register(&mut e, 1, KIND_FIXED, 1, del).unwrap();
    settle(&mut e, 1, 5 * USDC, h(1)).unwrap();
    let settler = e.settler.insecure_clone();
    refund(&mut e, &settler, 1, 2 * USDC, h(1)).expect("partial refund");
    assert_eq!(token_amount(&e.svm, &e.owner_ata), 100 * USDC - 3 * USDC);
    let err = refund(&mut e, &settler, 1, 3 * USDC + 1, h(1)).unwrap_err();
    println!("S4 over-refund: {err}");
    refund(&mut e, &settler, 1, 3 * USDC, h(1)).expect("refund the rest");
    assert_eq!(token_amount(&e.svm, &e.owner_ata), 100 * USDC);
    assert_eq!(token_amount(&e.svm, &e.treasury_ata), 0);
    assert!(refund(&mut e, &settler, 1, 1, h(1)).is_err(), "nothing left to refund");
    assert!(refund(&mut e, &settler, 1, 1, h(2)).is_err(), "no record for an unknown authorization");
    let mallory = Keypair::new();
    e.svm.airdrop(&mallory.pubkey(), 1_000_000_000).unwrap();
    assert!(refund(&mut e, &mallory, 1, 1, h(1)).is_err(), "only the settlement authority may refund");
}
