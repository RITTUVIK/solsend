//! Shared LiteSVM harness: the REAL devnet Allowances binary + the locally built SolSend program.
//!
//! Prereqs (see `scripts/program/fetch-allowances.sh`):
//!   - `NO_DNA=1 anchor build`  → target/deploy/solsend.so (override: env SOLSEND_SO)
//!   - `scripts/program/fetch-allowances.sh` → target/fixtures/subscriptions_devnet.so (override: env ALLOWANCES_SO)
#![allow(dead_code)]

use std::path::PathBuf;

pub use {
    anchor_lang::{
        error::{ErrorCode as AnchorErrorCode, ERROR_CODE_OFFSET},
        prelude::{Clock, Pubkey},
        solana_program::{
            instruction::{AccountMeta, Instruction},
            program_option::COption,
            program_pack::Pack,
            system_program,
        },
        AccountDeserialize, AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas,
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
    solsend::{
        accounts as acc, derive_delegation, derive_event_authority, derive_subscription_authority, instruction as sx, Card,
        Config, InitializeConfigArgs, SettlementRecord, SolsendError, ALLOWANCES_PROGRAM_ID, CARD_SEED, CONFIG_SEED,
        KIND_ONE_TIME, KIND_STORE_LOCKED, KIND_SUBSCRIPTION, SETTLE_SEED, STATUS_ACTIVE, STATUS_CLOSED, STATUS_FROZEN,
        STATUS_USED, TREASURY_SEED,
    },
};

pub const USDC: u64 = 1_000_000;
pub const DAY: i64 = 86_400;
/// A realistic wall-clock start (2026-11-18T07:00:00Z) so timestamps are non-zero.
pub const START_TS: i64 = 1_795_503_600;
pub const OWNER_START: u64 = 100 * USDC;

pub const ALLOWANCES_ERR_UNAUTHORIZED: u32 = 130;
pub const ALLOWANCES_ERR_EXCEEDS_FIXED: u32 = 300;
pub const ALLOWANCES_ERR_EXCEEDS_PERIOD: u32 = 400;
pub const SYSTEM_ERR_ALREADY_IN_USE: u32 = 0;

pub fn sol(e: SolsendError) -> u32 {
    ERROR_CODE_OFFSET + e as u32
}
pub fn anchor_err(e: AnchorErrorCode) -> u32 {
    e as u32
}

fn read_artifact(env_var: &str, default_rel: &str, hint: &str) -> Vec<u8> {
    let path = std::env::var(env_var)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(default_rel));
    std::fs::read(&path).unwrap_or_else(|e| panic!("cannot read {} ({e}); {hint}", path.display()))
}

// ── PDAs ────────────────────────────────────────────────────────────────────
pub fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &solsend::id()).0
}
pub fn treasury_pda() -> Pubkey {
    Pubkey::find_program_address(&[TREASURY_SEED], &solsend::id()).0
}
pub fn card_pda(owner: &Pubkey, card_id: u64) -> Pubkey {
    Pubkey::find_program_address(&[CARD_SEED, owner.as_ref(), &card_id.to_le_bytes()], &solsend::id()).0
}
pub fn record_pda(card: &Pubkey, auth: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[SETTLE_SEED, card.as_ref(), auth.as_ref()], &solsend::id()).0
}

// ── transactions ────────────────────────────────────────────────────────────
#[derive(Debug)]
pub struct TxOk {
    pub cu: u64,
    pub logs: Vec<String>,
}

#[derive(Debug)]
pub struct TxFail {
    pub err: String,
    pub logs: Vec<String>,
}

impl TxFail {
    /// The `Custom(n)` instruction error code, if the failure is one.
    pub fn custom(&self) -> Option<u32> {
        let i = self.err.find("Custom(")? + "Custom(".len();
        let digits: String = self.err[i..].chars().take_while(|c| c.is_ascii_digit()).collect();
        digits.parse().ok()
    }
}

pub type TxResult = Result<TxOk, TxFail>;

pub fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> TxResult {
    svm.expire_blockhash(); // never collide with an identical earlier transaction
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &bh);
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    svm.send_transaction(tx)
        .map(|m| TxOk { cu: m.compute_units_consumed, logs: m.logs })
        .map_err(|e| TxFail { err: format!("{:?}", e.err), logs: e.meta.logs })
}

#[track_caller]
pub fn ok(r: TxResult, what: &str) -> TxOk {
    match r {
        Ok(t) => t,
        Err(f) => panic!("{what}: expected success, got {} | logs: {:#?}", f.err, f.logs),
    }
}

#[track_caller]
pub fn fails_with(r: TxResult, code: u32, what: &str) -> TxFail {
    match r {
        Ok(t) => panic!("{what}: expected Custom({code}) but the tx succeeded | logs: {:#?}", t.logs),
        Err(f) => {
            assert_eq!(f.custom(), Some(code), "{what}: wrong error {} | logs: {:#?}", f.err, f.logs);
            f
        }
    }
}

#[track_caller]
pub fn fails_containing(r: TxResult, needle: &str, what: &str) -> TxFail {
    match r {
        Ok(t) => panic!("{what}: expected failure ({needle}) but the tx succeeded | logs: {:#?}", t.logs),
        Err(f) => {
            assert!(f.err.contains(needle), "{what}: expected {needle}, got {} | logs: {:#?}", f.err, f.logs);
            f
        }
    }
}

// ── token accounts ──────────────────────────────────────────────────────────
pub fn put_mint(svm: &mut LiteSVM, mint: Pubkey) {
    let mut d = [0u8; SplMint::LEN];
    SplMint::pack(
        SplMint { mint_authority: COption::None, supply: 1_000_000 * USDC, decimals: 6, is_initialized: true, freeze_authority: COption::None },
        &mut d,
    )
    .unwrap();
    svm.set_account(mint, Account { lamports: 1_461_600, data: d.to_vec(), owner: spl_token::ID, executable: false, rent_epoch: 0 })
        .unwrap();
}

pub fn put_token_account(svm: &mut LiteSVM, addr: Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) {
    let mut d = [0u8; SplAccount::LEN];
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
        &mut d,
    )
    .unwrap();
    svm.set_account(addr, Account { lamports: 2_039_280, data: d.to_vec(), owner: spl_token::ID, executable: false, rent_epoch: 0 })
        .unwrap();
}

pub fn token_amount(svm: &LiteSVM, a: &Pubkey) -> u64 {
    SplAccount::unpack(&svm.get_account(a).expect("token account").data).unwrap().amount
}

// ── Allowances instructions (hand-built from the Codama IDL, as in CP0b) ───
pub fn ix_init_subscription_authority(owner: &Pubkey, mint: &Pubkey, owner_ata: &Pubkey) -> Instruction {
    Instruction {
        program_id: ALLOWANCES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*owner, true),
            AccountMeta::new(derive_subscription_authority(owner, mint), false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*owner_ata, false),
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new_readonly(spl_token::ID, false),
        ],
        data: vec![0],
    }
}

/// SubscriptionAuthority: disc1 user32 mint32 payer32 bump1 init_id8 → init_id @98.
pub fn sa_init_id(svm: &LiteSVM, owner: &Pubkey, mint: &Pubkey) -> i64 {
    let d = svm.get_account(&derive_subscription_authority(owner, mint)).expect("SA").data;
    i64::from_le_bytes(d[98..106].try_into().unwrap())
}

pub enum Terms {
    Fixed { amount: u64, expiry_ts: i64 },
    Recurring { amount_per_period: u64, period_secs: u64, start_ts: i64, expiry_ts: i64 },
}

/// Allowances ix 1 (fixed) / 2 (recurring); delegator = `owner`, optional trailing sponsor `payer`.
pub fn ix_create_delegation(
    svm: &LiteSVM,
    owner: &Pubkey,
    mint: &Pubkey,
    delegatee: &Pubkey,
    nonce: u64,
    terms: &Terms,
    payer: Option<&Pubkey>,
) -> (Instruction, Pubkey) {
    let sa = derive_subscription_authority(owner, mint);
    let delegation = derive_delegation(&sa, owner, delegatee, nonce);
    let init_id = sa_init_id(svm, owner, mint);
    let mut data = Vec::new();
    match terms {
        Terms::Fixed { amount, expiry_ts } => {
            data.push(1);
            data.extend_from_slice(&nonce.to_le_bytes());
            data.extend_from_slice(&amount.to_le_bytes());
            data.extend_from_slice(&expiry_ts.to_le_bytes());
        }
        Terms::Recurring { amount_per_period, period_secs, start_ts, expiry_ts } => {
            data.push(2);
            data.extend_from_slice(&nonce.to_le_bytes());
            data.extend_from_slice(&amount_per_period.to_le_bytes());
            data.extend_from_slice(&period_secs.to_le_bytes());
            data.extend_from_slice(&start_ts.to_le_bytes());
            data.extend_from_slice(&expiry_ts.to_le_bytes());
        }
    }
    data.extend_from_slice(&init_id.to_le_bytes());
    let mut accounts = vec![
        AccountMeta::new(*owner, true),
        AccountMeta::new_readonly(sa, false),
        AccountMeta::new(delegation, false),
        AccountMeta::new_readonly(*delegatee, false),
        AccountMeta::new_readonly(system_program::ID, false),
    ];
    if let Some(p) = payer {
        accounts.push(AccountMeta::new(*p, true));
    }
    (Instruction { program_id: ALLOWANCES_PROGRAM_ID, accounts, data }, delegation)
}

pub fn ix_revoke_delegation(authority: &Pubkey, delegation: &Pubkey, receiver: Option<&Pubkey>) -> Instruction {
    let mut accounts = vec![AccountMeta::new(*authority, true), AccountMeta::new(*delegation, false)];
    if let Some(r) = receiver {
        accounts.push(AccountMeta::new(*r, false));
    }
    Instruction { program_id: ALLOWANCES_PROGRAM_ID, accounts, data: vec![3] }
}

/// Fixed delegation remaining amount @171.
pub fn fixed_remaining(svm: &LiteSVM, delegation: &Pubkey) -> u64 {
    let d = svm.get_account(delegation).unwrap().data;
    u64::from_le_bytes(d[171..179].try_into().unwrap())
}

// ── SolSend instructions ───────────────────────────────────────────────────
pub fn ix_initialize_config(admin: &Pubkey, mint: &Pubkey, args: InitializeConfigArgs) -> Instruction {
    Instruction::new_with_bytes(
        solsend::id(),
        &sx::InitializeConfig { args }.data(),
        acc::InitializeConfig { admin: *admin, config: config_pda(), treasury: treasury_pda(), usdc_mint: *mint, system_program: system_program::ID }
            .to_account_metas(None),
    )
}

pub fn ix_set_paused(admin: &Pubkey, paused: bool) -> Instruction {
    Instruction::new_with_bytes(solsend::id(), &sx::SetPaused { paused }.data(), acc::AdminOnly { admin: *admin, config: config_pda() }.to_account_metas(None))
}

pub fn ix_set_settlement_authority(admin: &Pubkey, new_authority: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        solsend::id(),
        &sx::SetSettlementAuthority { new_authority }.data(),
        acc::AdminOnly { admin: *admin, config: config_pda() }.to_account_metas(None),
    )
}

pub fn label(s: &str) -> [u8; 32] {
    let mut l = [0u8; 32];
    l[..s.len()].copy_from_slice(s.as_bytes());
    l
}

#[allow(clippy::too_many_arguments)]
pub fn ix_register_card(owner: &Pubkey, payer: &Pubkey, mint: &Pubkey, card_id: u64, kind: u8, nonce: u64, delegation: Pubkey, label: [u8; 32]) -> Instruction {
    Instruction::new_with_bytes(
        solsend::id(),
        &sx::RegisterCard { card_id, kind, delegation_nonce: nonce, label }.data(),
        acc::RegisterCard {
            owner: *owner,
            payer: *payer,
            config: config_pda(),
            card: card_pda(owner, card_id),
            delegation,
            owner_ata: get_associated_token_address(owner, mint),
            usdc_mint: *mint,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

/// Settle accounts for (owner, card_id) as the shared TS builder derives them (nonce = card_id).
pub fn settle_accounts(settler: &Pubkey, owner: &Pubkey, mint: &Pubkey, card_id: u64, auth: &[u8; 32]) -> acc::Settle {
    let card = card_pda(owner, card_id);
    let sa = derive_subscription_authority(owner, mint);
    acc::Settle {
        settlement_authority: *settler,
        config: config_pda(),
        card,
        settlement_record: record_pda(&card, auth),
        delegation: derive_delegation(&sa, owner, &card, card_id),
        subscription_authority: sa,
        source_token_account: get_associated_token_address(owner, mint),
        treasury: treasury_pda(),
        treasury_ata: get_associated_token_address(&treasury_pda(), mint),
        usdc_mint: *mint,
        event_authority: derive_event_authority(),
        allowances_program: ALLOWANCES_PROGRAM_ID,
        token_program: spl_token::ID,
        associated_token_program: anchor_spl::associated_token::ID,
        system_program: system_program::ID,
    }
}

pub fn ix_settle_with(accounts: acc::Settle, amount: u64, auth_hash: [u8; 32], merchant_hash: [u8; 32]) -> Instruction {
    Instruction::new_with_bytes(solsend::id(), &sx::Settle { amount, auth_hash, merchant_hash }.data(), accounts.to_account_metas(None))
}

pub fn refund_accounts(settler: &Pubkey, owner: &Pubkey, mint: &Pubkey, card_id: u64, auth: &[u8; 32]) -> acc::Refund {
    let card = card_pda(owner, card_id);
    acc::Refund {
        settlement_authority: *settler,
        config: config_pda(),
        card,
        settlement_record: record_pda(&card, auth),
        source_token_account: get_associated_token_address(owner, mint),
        treasury: treasury_pda(),
        treasury_ata: get_associated_token_address(&treasury_pda(), mint),
        usdc_mint: *mint,
        token_program: spl_token::ID,
    }
}

pub fn ix_refund_with(accounts: acc::Refund, amount: u64, auth_hash: [u8; 32]) -> Instruction {
    Instruction::new_with_bytes(solsend::id(), &sx::Refund { amount, auth_hash }.data(), accounts.to_account_metas(None))
}

pub fn ix_freeze(authority: &Pubkey, card: Pubkey) -> Instruction {
    Instruction::new_with_bytes(solsend::id(), &sx::FreezeCard {}.data(), acc::FreezeCard { authority: *authority, config: config_pda(), card }.to_account_metas(None))
}

pub fn ix_unfreeze(owner: &Pubkey, card: Pubkey) -> Instruction {
    Instruction::new_with_bytes(solsend::id(), &sx::UnfreezeCard {}.data(), acc::OwnerCard { owner: *owner, card }.to_account_metas(None))
}

pub fn ix_close_card(owner: &Pubkey, card: Pubkey) -> Instruction {
    Instruction::new_with_bytes(solsend::id(), &sx::CloseCard {}.data(), acc::OwnerCard { owner: *owner, card }.to_account_metas(None))
}

pub fn ix_admin_withdraw(admin: &Pubkey, mint: &Pubkey, destination: Pubkey, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        solsend::id(),
        &sx::AdminWithdraw { amount }.data(),
        acc::AdminWithdraw {
            admin: *admin,
            config: config_pda(),
            treasury: treasury_pda(),
            treasury_ata: get_associated_token_address(&treasury_pda(), mint),
            destination,
            usdc_mint: *mint,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    )
}

// ── account readers ────────────────────────────────────────────────────────
pub fn read_card(svm: &LiteSVM, card: &Pubkey) -> Card {
    Card::try_deserialize(&mut &svm.get_account(card).expect("card account").data[..]).unwrap()
}
pub fn read_config(svm: &LiteSVM) -> Config {
    Config::try_deserialize(&mut &svm.get_account(&config_pda()).expect("config account").data[..]).unwrap()
}
pub fn read_record(svm: &LiteSVM, record: &Pubkey) -> SettlementRecord {
    SettlementRecord::try_deserialize(&mut &svm.get_account(record).expect("record account").data[..]).unwrap()
}

/// Decode SolSend events of type `E` from `Program data:` log lines.
pub fn events<E: AnchorDeserialize + Discriminator>(logs: &[String]) -> Vec<E> {
    use anchor_lang::__private::base64::{engine::general_purpose::STANDARD, Engine};
    logs.iter()
        .filter_map(|l| l.strip_prefix("Program data: "))
        .filter_map(|b64| STANDARD.decode(b64).ok())
        .filter(|b| b.len() >= 8 && &b[..8] == E::DISCRIMINATOR)
        .map(|b| E::deserialize(&mut &b[8..]).unwrap())
        .collect()
}

pub fn h(n: u8) -> [u8; 32] {
    [n; 32]
}

// ── environment ────────────────────────────────────────────────────────────
pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub settler: Keypair,
    /// Server fee payer: sponsors delegation + Card rent (CP1 F3).
    pub payer: Keypair,
    pub owner: Keypair,
    pub mallory: Keypair,
    pub mint: Pubkey,
    pub owner_ata: Pubkey,
    pub treasury_ata: Pubkey,
    /// config.treasury_destination (admin's USDC account).
    pub destination: Pubkey,
}

/// Config overrides for `setup_with` (defaults: no per-tx cap, idle lock disabled).
#[derive(Default)]
pub struct Opts {
    pub per_tx_max: u64,
    pub idle_secs: i64,
}

pub fn new_svm() -> LiteSVM {
    let mut svm = LiteSVM::new();
    let allowances = read_artifact(
        "ALLOWANCES_SO",
        "../../target/fixtures/subscriptions_devnet.so",
        "run scripts/program/fetch-allowances.sh (or set ALLOWANCES_SO)",
    );
    let program = read_artifact("SOLSEND_SO", "../../target/deploy/solsend.so", "run `NO_DNA=1 anchor build` (or set SOLSEND_SO)");
    svm.add_program(ALLOWANCES_PROGRAM_ID, &allowances).unwrap();
    svm.add_program(solsend::id(), &program).unwrap();
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = START_TS;
    svm.set_sysvar::<Clock>(&clock);
    svm
}

pub fn setup() -> Env {
    setup_with(Opts::default())
}

pub fn setup_with(opts: Opts) -> Env {
    let mut svm = new_svm();
    let (admin, settler, payer, owner, mallory) = (Keypair::new(), Keypair::new(), Keypair::new(), Keypair::new(), Keypair::new());
    for k in [&admin, &settler, &payer, &owner, &mallory] {
        svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
    }
    let mint = Pubkey::new_unique();
    put_mint(&mut svm, mint);
    let owner_ata = get_associated_token_address(&owner.pubkey(), &mint);
    put_token_account(&mut svm, owner_ata, mint, owner.pubkey(), OWNER_START);
    let treasury_ata = get_associated_token_address(&treasury_pda(), &mint);
    put_token_account(&mut svm, treasury_ata, mint, treasury_pda(), 0);
    let destination = get_associated_token_address(&admin.pubkey(), &mint);
    put_token_account(&mut svm, destination, mint, admin.pubkey(), 0);
    let mallory_ata = get_associated_token_address(&mallory.pubkey(), &mint);
    put_token_account(&mut svm, mallory_ata, mint, mallory.pubkey(), 0);

    let args = InitializeConfigArgs {
        settlement_authority: settler.pubkey(),
        treasury_destination: destination,
        per_tx_max: opts.per_tx_max,
        idle_secs: opts.idle_secs,
    };
    ok(send(&mut svm, &[ix_initialize_config(&admin.pubkey(), &mint, args)], &admin, &[]), "initialize_config");
    ok(
        send(&mut svm, &[ix_init_subscription_authority(&owner.pubkey(), &mint, &owner_ata)], &owner, &[]),
        "init subscription authority",
    );
    Env { svm, admin, settler, payer, owner, mallory, mint, owner_ata, treasury_ata, destination }
}

impl Env {
    pub fn card(&self, card_id: u64) -> Pubkey {
        card_pda(&self.owner.pubkey(), card_id)
    }

    pub fn mallory_ata(&self) -> Pubkey {
        get_associated_token_address(&self.mallory.pubkey(), &self.mint)
    }

    /// A second funded user with an initialized Subscription Authority.
    pub fn add_user(&mut self, amount: u64) -> Keypair {
        let u = Keypair::new();
        self.svm.airdrop(&u.pubkey(), 10_000_000_000).unwrap();
        let ata = get_associated_token_address(&u.pubkey(), &self.mint);
        put_token_account(&mut self.svm, ata, self.mint, u.pubkey(), amount);
        ok(send(&mut self.svm, &[ix_init_subscription_authority(&u.pubkey(), &self.mint, &ata)], &u, &[]), "init SA (user)");
        u
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn warp(&mut self, secs: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp += secs;
        clock.slot += 1;
        self.svm.set_sysvar::<Clock>(&clock);
        self.svm.expire_blockhash();
    }

    /// Production F3 shape: ONE tx = Allowances createDelegation (payer = fee payer) + register_card,
    /// fee payer = our fee payer, owner co-signs. Delegation nonce = card_id. Returns the tx result.
    pub fn try_create_card(&mut self, card_id: u64, kind: u8, terms: Terms) -> TxResult {
        let owner = self.owner.insecure_clone();
        let payer = self.payer.insecure_clone();
        let card = self.card(card_id);
        let (create, delegation) =
            ix_create_delegation(&self.svm, &owner.pubkey(), &self.mint, &card, card_id, &terms, Some(&payer.pubkey()));
        let register = ix_register_card(&owner.pubkey(), &payer.pubkey(), &self.mint, card_id, kind, card_id, delegation, label("test card"));
        send(&mut self.svm, &[create, register], &payer, &[&owner])
    }

    pub fn create_card(&mut self, card_id: u64, kind: u8, terms: Terms) -> Pubkey {
        ok(self.try_create_card(card_id, kind, terms), "create card (delegation + register_card)");
        self.card(card_id)
    }

    pub fn fixed_card(&mut self, card_id: u64, kind: u8, cap: u64) -> Pubkey {
        self.create_card(card_id, kind, Terms::Fixed { amount: cap, expiry_ts: 0 })
    }

    pub fn delegation(&self, card_id: u64) -> Pubkey {
        read_card(&self.svm, &self.card(card_id)).delegation
    }

    pub fn settle_ix(&self, card_id: u64, amount: u64, auth: [u8; 32], merchant: [u8; 32]) -> Instruction {
        ix_settle_with(settle_accounts(&self.settler.pubkey(), &self.owner.pubkey(), &self.mint, card_id, &auth), amount, auth, merchant)
    }

    pub fn settle(&mut self, card_id: u64, amount: u64, auth: [u8; 32], merchant: [u8; 32]) -> TxResult {
        let ix = self.settle_ix(card_id, amount, auth, merchant);
        let s = self.settler.insecure_clone();
        send(&mut self.svm, &[ix], &s, &[])
    }

    pub fn refund(&mut self, card_id: u64, amount: u64, auth: [u8; 32]) -> TxResult {
        let ix = ix_refund_with(refund_accounts(&self.settler.pubkey(), &self.owner.pubkey(), &self.mint, card_id, &auth), amount, auth);
        let s = self.settler.insecure_clone();
        send(&mut self.svm, &[ix], &s, &[])
    }

    pub fn owner_send(&mut self, ix: Instruction) -> TxResult {
        let o = self.owner.insecure_clone();
        send(&mut self.svm, &[ix], &o, &[])
    }

    pub fn admin_send(&mut self, ix: Instruction) -> TxResult {
        let a = self.admin.insecure_clone();
        send(&mut self.svm, &[ix], &a, &[])
    }

    pub fn mallory_send(&mut self, ix: Instruction) -> TxResult {
        let m = self.mallory.insecure_clone();
        send(&mut self.svm, &[ix], &m, &[])
    }

    /// (owner ATA, treasury ATA) balances.
    pub fn balances(&self) -> (u64, u64) {
        (token_amount(&self.svm, &self.owner_ata), token_amount(&self.svm, &self.treasury_ata))
    }
}
