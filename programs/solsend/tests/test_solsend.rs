//! SolSend program — LiteSVM tests against the REAL devnet Allowances binary
//! (`De1egAFM…`, sha256 2675ad1d…ddbf; fetch with scripts/program/fetch-allowances.sh).
//! Run: `NO_DNA=1 anchor build && pnpm test:program` (add `-- --nocapture` for CU numbers).

mod common;
use common::*;

const MERCHANT_A: [u8; 32] = [0xA1; 32];
const MERCHANT_B: [u8; 32] = [0xB2; 32];

// ═══ config / admin ═══════════════════════════════════════════════════════════
#[test]
fn initialize_config_sets_every_field() {
    let e = setup_with(Opts { per_tx_max: 1_000 * USDC, idle_secs: 30 * DAY });
    let c = read_config(&e.svm);
    assert_eq!(c.admin, e.admin.pubkey());
    assert_eq!(c.settlement_authority, e.settler.pubkey());
    assert_eq!(c.usdc_mint, e.mint);
    assert_eq!(c.treasury_destination, e.destination);
    assert_eq!(c.per_tx_max, 1_000 * USDC);
    assert_eq!(c.idle_secs, 30 * DAY);
    assert!(!c.paused);
    assert_eq!(c.treasury_bump, Pubkey::find_program_address(&[TREASURY_SEED], &solsend::id()).1);
    assert_eq!(c.bump, Pubkey::find_program_address(&[CONFIG_SEED], &solsend::id()).1);
}

#[test]
fn initialize_config_is_a_singleton_and_rejects_negative_idle() {
    let mut e = setup();
    let args = InitializeConfigArgs { settlement_authority: e.mallory.pubkey(), treasury_destination: e.mallory_ata(), per_tx_max: 0, idle_secs: 0 };
    let ix = ix_initialize_config(&e.mallory.pubkey(), &e.mint, args);
    fails_with(e.mallory_send(ix), SYSTEM_ERR_ALREADY_IN_USE, "second initialize_config (hijack attempt)");
    assert_eq!(read_config(&e.svm).admin, e.admin.pubkey());

    let mut svm = new_svm();
    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    set_upgrade_authority(&mut svm, Some(&admin.pubkey()));
    let mint = Pubkey::new_unique();
    put_mint(&mut svm, mint);
    let args = InitializeConfigArgs { settlement_authority: admin.pubkey(), treasury_destination: admin.pubkey(), per_tx_max: 0, idle_secs: -1 };
    fails_with(send(&mut svm, &[ix_initialize_config(&admin.pubkey(), &mint, args)], &admin, &[]), sol(SolsendError::Overflow), "idle_secs < 0");
}

#[test]
fn set_paused_and_rotate_settlement_authority_admin_only() {
    let mut e = setup();
    let t = ok(e.admin_send(ix_set_paused(&e.admin.pubkey(), true)), "pause");
    let ev = events::<solsend::ConfigUpdated>(&t.logs);
    assert_eq!(ev.len(), 1);
    assert!(ev[0].paused);
    assert_eq!(ev[0].settlement_authority, e.settler.pubkey());
    assert!(read_config(&e.svm).paused);

    fails_with(e.mallory_send(ix_set_paused(&e.mallory.pubkey(), false)), sol(SolsendError::NotAdmin), "mallory unpause");
    let ix = ix_set_settlement_authority(&e.mallory.pubkey(), e.mallory.pubkey());
    fails_with(e.mallory_send(ix), sol(SolsendError::NotAdmin), "mallory rotates settler");
    // the settlement authority is not the admin either
    let s = e.settler.insecure_clone();
    fails_with(send(&mut e.svm, &[ix_set_paused(&s.pubkey(), false)], &s, &[]), sol(SolsendError::NotAdmin), "settler unpause");

    ok(e.admin_send(ix_set_paused(&e.admin.pubkey(), false)), "unpause");
    let new_settler = Keypair::new();
    let t = ok(e.admin_send(ix_set_settlement_authority(&e.admin.pubkey(), new_settler.pubkey())), "rotate");
    let ev = events::<solsend::ConfigUpdated>(&t.logs);
    assert_eq!((ev[0].paused, ev[0].settlement_authority), (false, new_settler.pubkey()));
    assert_eq!(read_config(&e.svm).settlement_authority, new_settler.pubkey());
}

#[test]
fn rotated_settlement_authority_takes_over_settle_and_refund() {
    let mut e = setup();
    e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    ok(e.settle(1, USDC, h(1), MERCHANT_A), "settle by original settler");
    let new_settler = Keypair::new();
    e.svm.airdrop(&new_settler.pubkey(), 10_000_000_000).unwrap();
    ok(e.admin_send(ix_set_settlement_authority(&e.admin.pubkey(), new_settler.pubkey())), "rotate");

    fails_with(e.settle(1, USDC, h(2), MERCHANT_A), sol(SolsendError::NotSettlementAuthority), "old settler settles");
    fails_with(e.refund(1, USDC, h(1)), sol(SolsendError::NotSettlementAuthority), "old settler refunds");
    let old = std::mem::replace(&mut e.settler, new_settler);
    ok(e.settle(1, USDC, h(2), MERCHANT_A), "new settler settles");
    ok(e.refund(1, USDC, h(1)), "new settler refunds");
    let s = e.settler.insecure_clone();
    let ix = ix_freeze(&old.pubkey(), e.card(1));
    fails_with(send(&mut e.svm, &[ix], &old, &[]), sol(SolsendError::NotAuthorized), "old settler freezes");
    let ix = ix_freeze(&s.pubkey(), e.card(1));
    ok(send(&mut e.svm, &[ix], &s, &[]), "new settler freezes");
}

// ═══ register_card ═══════════════════════════════════════════════════════════
#[test]
fn register_card_happy_path_all_kinds_sponsored_by_fee_payer() {
    let mut e = setup();
    let owner_sol = e.svm.get_balance(&e.owner.pubkey()).unwrap();
    let card_id = 0xDEAD_BEEF_0000_0001u64;
    let card = e.card(card_id);
    let (create, delegation) = ix_create_delegation(
        &e.svm, &e.owner.pubkey(), &e.mint, &card, card_id, &Terms::Fixed { amount: 40 * USDC, expiry_ts: 0 }, Some(&e.payer.pubkey()),
    );
    let reg = ix_register_card(&e.owner.pubkey(), &e.payer.pubkey(), &e.mint, card_id, KIND_STORE_LOCKED, card_id, delegation, label("Temu"));
    let (payer, owner) = (e.payer.insecure_clone(), e.owner.insecure_clone());
    let t = ok(send(&mut e.svm, &[create, reg], &payer, &[&owner]), "create delegation + register_card in one tx");
    println!("register_card tx (createFixedDelegation + register_card) CU: {}", t.cu);
    assert_eq!(e.svm.get_balance(&e.owner.pubkey()).unwrap(), owner_sol, "owner pays no SOL (fee payer sponsors fees + rent)");

    let c = read_card(&e.svm, &card);
    assert_eq!(c.owner, e.owner.pubkey());
    assert_eq!(c.card_id, card_id);
    assert_eq!(c.kind, KIND_STORE_LOCKED);
    assert_eq!(c.status, STATUS_ACTIVE);
    assert_eq!(c.delegation, delegation);
    assert_eq!(c.delegation_nonce, card_id);
    assert_eq!(c.source_token_account, e.owner_ata);
    assert_eq!(c.label, label("Temu"));
    assert_eq!(c.merchant_lock, [0u8; 32]);
    assert_eq!((c.created_ts, c.last_used_ts), (START_TS, START_TS));
    assert_eq!((c.total_settled, c.total_refunded, c.settle_count), (0, 0, 0));
    assert_eq!(c.bump, Pubkey::find_program_address(&[CARD_SEED, e.owner.pubkey().as_ref(), &card_id.to_le_bytes()], &solsend::id()).1);

    let ev = events::<solsend::CardRegistered>(&t.logs);
    assert_eq!(ev.len(), 1);
    assert_eq!((ev[0].card, ev[0].owner, ev[0].card_id, ev[0].kind, ev[0].delegation), (card, e.owner.pubkey(), card_id, KIND_STORE_LOCKED, delegation));
    assert_eq!(ev[0].label, label("Temu"));

    // ONE_TIME (fixed) and SUBSCRIPTION (recurring) register too
    e.fixed_card(2, KIND_ONE_TIME, 5 * USDC);
    assert_eq!(read_card(&e.svm, &e.card(2)).kind, KIND_ONE_TIME);
    let now = e.now();
    e.create_card(3, KIND_SUBSCRIPTION, Terms::Recurring { amount_per_period: 15_990_000, period_secs: (30 * DAY) as u64, start_ts: now, expiry_ts: 0 });
    assert_eq!(read_card(&e.svm, &e.card(3)).kind, KIND_SUBSCRIPTION);
}

#[test]
fn register_card_rejects_mismatched_real_delegations() {
    let mut e = setup();
    let owner = e.owner.insecure_clone();
    let payer = e.payer.insecure_clone();
    let fixed = Terms::Fixed { amount: 10 * USDC, expiry_ts: 0 };
    let invalid = sol(SolsendError::InvalidDelegation);

    // wrong delegatee: delegation points at card 99, registered as card 10
    let (create, d) = ix_create_delegation(&e.svm, &owner.pubkey(), &e.mint, &e.card(99), 10, &fixed, None);
    ok(e.owner_send(create), "create delegation to another card");
    let reg = ix_register_card(&owner.pubkey(), &payer.pubkey(), &e.mint, 10, KIND_STORE_LOCKED, 10, d, label("x"));
    fails_with(send(&mut e.svm, &[reg], &payer, &[&owner]), invalid, "wrong delegatee");

    // wrong delegator: another user delegates to OUR card PDA; we try to register it
    let other = e.add_user(50 * USDC);
    let (create, d) = ix_create_delegation(&e.svm, &other.pubkey(), &e.mint, &e.card(11), 11, &fixed, None);
    ok(send(&mut e.svm, &[create], &other, &[]), "other user's delegation");
    let reg = ix_register_card(&owner.pubkey(), &payer.pubkey(), &e.mint, 11, KIND_STORE_LOCKED, 11, d, label("x"));
    fails_with(send(&mut e.svm, &[reg], &payer, &[&owner]), invalid, "wrong delegator");

    // wrong kind/type: fixed delegation registered as SUBSCRIPTION
    let r = e.try_create_card(12, KIND_SUBSCRIPTION, Terms::Fixed { amount: USDC, expiry_ts: 0 });
    fails_with(r, invalid, "fixed delegation as SUBSCRIPTION");
    // ... and recurring delegation registered as STORE_LOCKED / ONE_TIME
    let now = e.now();
    let rec = || Terms::Recurring { amount_per_period: USDC, period_secs: DAY as u64, start_ts: now, expiry_ts: 0 };
    fails_with(e.try_create_card(13, KIND_STORE_LOCKED, rec()), invalid, "recurring delegation as STORE_LOCKED");
    fails_with(e.try_create_card(14, KIND_ONE_TIME, rec()), invalid, "recurring delegation as ONE_TIME");

    // invalid kind
    fails_with(e.try_create_card(15, 3, Terms::Fixed { amount: USDC, expiry_ts: 0 }), sol(SolsendError::InvalidKind), "kind 3");

    // wrong nonce: delegation created with nonce 7000 for card 16, registered with nonce 7001
    let (create, d) = ix_create_delegation(&e.svm, &owner.pubkey(), &e.mint, &e.card(16), 7000, &fixed, None);
    ok(e.owner_send(create), "create delegation nonce 7000");
    let reg = ix_register_card(&owner.pubkey(), &payer.pubkey(), &e.mint, 16, KIND_STORE_LOCKED, 7001, d, label("x"));
    fails_with(send(&mut e.svm, &[reg], &payer, &[&owner]), invalid, "wrong nonce");
    // control: the right nonce registers (the program supports any nonce; the app uses nonce = card_id)
    let reg = ix_register_card(&owner.pubkey(), &payer.pubkey(), &e.mint, 16, KIND_STORE_LOCKED, 7000, d, label("x"));
    ok(send(&mut e.svm, &[reg], &payer, &[&owner]), "right nonce");
    assert_eq!(read_card(&e.svm, &e.card(16)).delegation_nonce, 7000);

    // missing delegation (nothing created at the derived address)
    let d = derive_delegation(&derive_subscription_authority(&owner.pubkey(), &e.mint), &owner.pubkey(), &e.card(17), 17);
    let reg = ix_register_card(&owner.pubkey(), &payer.pubkey(), &e.mint, 17, KIND_STORE_LOCKED, 17, d, label("x"));
    fails_with(send(&mut e.svm, &[reg], &payer, &[&owner]), invalid, "no delegation account");

    // someone else cannot register a card on the owner's behalf (owner must sign; the card PDA is owner-seeded)
    let (create, d) = ix_create_delegation(&e.svm, &owner.pubkey(), &e.mint, &e.card(18), 18, &fixed, None);
    ok(e.owner_send(create), "delegation for card 18");
    let mut reg = ix_register_card(&owner.pubkey(), &payer.pubkey(), &e.mint, 18, KIND_STORE_LOCKED, 18, d, label("x"));
    reg.accounts[0].is_signer = false;
    let r = send(&mut e.svm, &[reg], &payer, &[]);
    assert!(r.is_err(), "register_card without the owner's signature must fail");
}

/// Forged accounts at the CORRECT derived address isolate each register_card check.
#[test]
fn register_card_rejects_forged_delegation_accounts() {
    let mut e = setup();
    let owner = e.owner.insecure_clone();
    let payer = e.payer.insecure_clone();
    // a real FixedDelegation to card 60 is the template
    let (create, real) =
        ix_create_delegation(&e.svm, &owner.pubkey(), &e.mint, &e.card(60), 60, &Terms::Fixed { amount: 10 * USDC, expiry_ts: 0 }, None);
    ok(e.owner_send(create), "template delegation");
    let template = e.svm.get_account(&real).unwrap();
    assert_eq!(template.data.len(), 187, "FixedDelegation is 187 bytes");
    assert_eq!(template.data[0], 2, "AccountDiscriminator::FixedDelegation");
    assert_eq!(&template.data[3..35], owner.pubkey().as_ref(), "header.delegator @3");
    assert_eq!(&template.data[35..67], e.card(60).as_ref(), "header.delegatee @35");

    let sa = derive_subscription_authority(&owner.pubkey(), &e.mint);
    let forge = |e: &mut Env, card_id: u64, mutate: &dyn Fn(&mut Account), kind: u8| -> TxResult {
        let card = e.card(card_id);
        let addr = derive_delegation(&sa, &owner.pubkey(), &card, card_id);
        let mut a = template.clone();
        a.data[35..67].copy_from_slice(card.as_ref());
        mutate(&mut a);
        e.svm.set_account(addr, a).unwrap();
        let reg = ix_register_card(&owner.pubkey(), &payer.pubkey(), &e.mint, card_id, kind, card_id, addr, label("forged"));
        send(&mut e.svm, &[reg], &payer, &[&owner])
    };
    let invalid = sol(SolsendError::InvalidDelegation);
    // control: correct bytes, Allowances-owned, correct address → accepted
    ok(forge(&mut e, 61, &|_| {}, KIND_STORE_LOCKED), "forged-but-correct control");
    let other = Pubkey::new_unique();
    fails_with(forge(&mut e, 62, &|a| a.owner = solsend::id(), KIND_STORE_LOCKED), invalid, "owned by SolSend, not Allowances");
    fails_with(forge(&mut e, 63, &|a| a.owner = system_program::ID, KIND_STORE_LOCKED), invalid, "owned by System");
    fails_with(forge(&mut e, 64, &|a| a.data[3..35].copy_from_slice(other.as_ref()), KIND_STORE_LOCKED), invalid, "header.delegator");
    fails_with(forge(&mut e, 65, &|a| a.data[35..67].copy_from_slice(other.as_ref()), KIND_STORE_LOCKED), invalid, "header.delegatee");
    fails_with(forge(&mut e, 66, &|a| a.data[0] = 3, KIND_STORE_LOCKED), invalid, "discriminator says recurring");
    fails_with(forge(&mut e, 67, &|a| a.data[0] = 4, KIND_ONE_TIME), invalid, "discriminator says subscription delegation");
    fails_with(forge(&mut e, 68, &|a| a.data[107..139].copy_from_slice(other.as_ref()), KIND_STORE_LOCKED), invalid, "stored SA");
    fails_with(forge(&mut e, 69, &|a| a.data[139..171].copy_from_slice(other.as_ref()), KIND_STORE_LOCKED), invalid, "stored mint");
    fails_with(forge(&mut e, 70, &|a| a.data.truncate(186), KIND_STORE_LOCKED), invalid, "truncated");
    // fixed-type bytes (187) cannot back a SUBSCRIPTION card even with the recurring discriminator
    fails_with(forge(&mut e, 71, &|a| a.data[0] = 3, KIND_SUBSCRIPTION), invalid, "187-byte account as recurring");
}

// ═══ settle ══════════════════════════════════════════════════════════════════
#[test]
fn settle_fixed_happy_path_exact_deltas_record_and_event() {
    let mut e = setup();
    let card = e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    let del = e.delegation(1);
    let settler_sol = e.svm.get_balance(&e.settler.pubkey()).unwrap();
    e.warp(60);
    let t = ok(e.settle(1, 23_170_000, h(1), MERCHANT_A), "settle 23.17");
    println!("settle (fixed) CU: {}", t.cu);
    assert_eq!(e.balances(), (OWNER_START - 23_170_000, 23_170_000), "owner -23.17, treasury +23.17");
    assert_eq!(fixed_remaining(&e.svm, &del), 40 * USDC - 23_170_000, "delegation cap decremented by Allowances");
    assert!(e.svm.get_balance(&e.settler.pubkey()).unwrap() < settler_sol, "settler pays the record rent");

    let rec = read_record(&e.svm, &record_pda(&h(1)));
    assert_eq!((rec.card, rec.auth_hash, rec.amount, rec.refunded, rec.created_ts), (card, h(1), 23_170_000, 0, START_TS + 60));
    let c = read_card(&e.svm, &card);
    assert_eq!(c.merchant_lock, MERCHANT_A, "merchant locked on first settle");
    assert_eq!((c.total_settled, c.settle_count, c.last_used_ts, c.status), (23_170_000, 1, START_TS + 60, STATUS_ACTIVE));
    assert_eq!(c.created_ts, START_TS);

    let ev = events::<solsend::CardSettled>(&t.logs);
    assert_eq!(ev.len(), 1);
    let ev = &ev[0];
    assert_eq!((ev.card, ev.owner, ev.amount, ev.remaining_allowance), (card, e.owner.pubkey(), 23_170_000, 16_830_000));
    assert_eq!((ev.auth_hash, ev.merchant_hash, ev.total_settled, ev.status_after), (h(1), MERCHANT_A, 23_170_000, STATUS_ACTIVE));

    let t = ok(e.settle(1, 830_000, h(2), MERCHANT_A), "second settle, same merchant");
    let ev = &events::<solsend::CardSettled>(&t.logs)[0];
    assert_eq!((ev.remaining_allowance, ev.total_settled), (16_000_000, 24_000_000));
    assert_eq!(read_card(&e.svm, &card).settle_count, 2);
    assert_eq!(e.balances(), (OWNER_START - 24_000_000, 24_000_000));
}

/// Replay guard (a): the SettlementRecord is permanent, so an auth_hash settles at most once —
/// at any amount, at any later time.
#[test]
fn duplicate_auth_hash_never_settles_twice_even_after_30_days() {
    let mut e = setup();
    let card = e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    let del = e.delegation(1);
    ok(e.settle(1, 5 * USDC, h(9), MERCHANT_A), "first settle");
    let before = (e.balances(), fixed_remaining(&e.svm, &del));
    let rec_before = e.svm.get_account(&record_pda(&h(9))).unwrap();

    fails_with(e.settle(1, 5 * USDC, h(9), MERCHANT_A), SYSTEM_ERR_ALREADY_IN_USE, "same auth, same amount");
    fails_with(e.settle(1, 7 * USDC, h(9), MERCHANT_A), SYSTEM_ERR_ALREADY_IN_USE, "same auth, different amount");
    e.warp(30 * DAY);
    fails_with(e.settle(1, 1, h(9), MERCHANT_A), SYSTEM_ERR_ALREADY_IN_USE, "same auth after +30 days");
    e.warp(365 * DAY);
    fails_with(e.settle(1, 5 * USDC, h(9), MERCHANT_A), SYSTEM_ERR_ALREADY_IN_USE, "same auth after +395 days");

    assert_eq!(before, (e.balances(), fixed_remaining(&e.svm, &del)), "no second pull, cap untouched");
    assert_eq!(rec_before, e.svm.get_account(&record_pda(&h(9))).unwrap(), "record unchanged");
    let c = read_card(&e.svm, &card);
    assert_eq!((c.total_settled, c.settle_count), (5 * USDC, 1));
}

#[test]
fn over_cap_fails_with_allowances_300_and_moves_nothing() {
    let mut e = setup();
    e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    let del = e.delegation(1);
    ok(e.settle(1, 23_170_000, h(1), MERCHANT_A), "settle 23.17");
    let before = (e.balances(), fixed_remaining(&e.svm, &del));
    fails_with(e.settle(1, 16_830_001, h(2), MERCHANT_A), ALLOWANCES_ERR_EXCEEDS_FIXED, "1 base unit over the remaining cap");
    assert_eq!(before, (e.balances(), fixed_remaining(&e.svm, &del)));
    assert!(e.svm.get_account(&record_pda(&h(2))).is_none(), "no record for a declined settle");

    let t = ok(e.settle(1, 16_830_000, h(3), MERCHANT_A), "exactly the remaining cap");
    assert_eq!(events::<solsend::CardSettled>(&t.logs)[0].remaining_allowance, 0);
    assert_eq!(fixed_remaining(&e.svm, &del), 0);
    assert_eq!(e.balances(), (OWNER_START - 40 * USDC, 40 * USDC));
    fails_with(e.settle(1, 1, h(4), MERCHANT_A), ALLOWANCES_ERR_EXCEEDS_FIXED, "spent card");
}

#[test]
fn insufficient_wallet_balance_fails_and_moves_nothing() {
    let mut e = setup();
    e.fixed_card(1, KIND_STORE_LOCKED, 500 * USDC); // cap above the 100 USDC balance
    let r = e.settle(1, OWNER_START + 1, h(1), MERCHANT_A);
    let f = fails_with(r, 1, "SPL Token insufficient funds (Custom 1)");
    assert!(f.logs.iter().any(|l| l.contains("insufficient funds")), "{:?}", f.logs);
    assert_eq!(e.balances(), (OWNER_START, 0));
}

#[test]
fn externally_revoked_delegation_blocks_settle() {
    let mut e = setup();
    e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    let del = e.delegation(1);
    ok(e.settle(1, USDC, h(1), MERCHANT_A), "settle before revoke");
    // The user revokes directly in the Allowances program — SolSend is not involved. The delegation
    // was sponsored by our fee payer, so the rent returns to that payer (receiver account).
    let payer = e.payer.pubkey();
    let payer_sol = e.svm.get_balance(&payer).unwrap();
    let r = e.owner_send(ix_revoke_delegation(&e.owner.pubkey(), &del, Some(&payer)));
    ok(r, "owner revokes sponsored delegation (with receiver)");
    assert!(e.svm.get_account(&del).map(|a| a.lamports == 0).unwrap_or(true), "delegation closed");
    assert!(e.svm.get_balance(&payer).unwrap() > payer_sol, "rent returned to the sponsor");

    let before = e.balances();
    let f = fails_containing(e.settle(1, USDC, h(2), MERCHANT_A), "InvalidAccountOwner", "settle after external revoke");
    println!("settle after revoke: {}", f.err);
    assert_eq!(before, e.balances());
}

/// Documents the devnet Allowances binary's revoke semantics for SPONSORED delegations (CP1 F3
/// sponsors every delegation): the delegator's revoke must name the original payer as receiver.
#[test]
fn revoke_of_sponsored_delegation_requires_receiver_account() {
    let mut e = setup();
    e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    let del = e.delegation(1);
    let r = e.owner_send(ix_revoke_delegation(&e.owner.pubkey(), &del, None));
    let two_accounts_ok = r.is_ok();
    println!("revoke sponsored delegation with [owner, delegation] only: {:?}", r.as_ref().map(|_| "ok").map_err(|f| &f.err));
    if !two_accounts_ok {
        let mallory = e.mallory.pubkey();
        assert!(e.owner_send(ix_revoke_delegation(&e.owner.pubkey(), &del, Some(&mallory))).is_err(), "receiver must be the payer");
        ok(e.owner_send(ix_revoke_delegation(&e.owner.pubkey(), &del, Some(&e.payer.pubkey()))), "revoke with receiver = payer");
    }
    assert!(e.svm.get_account(&del).map(|a| a.lamports == 0).unwrap_or(true), "delegation closed");
    assert!(!two_accounts_ok, "devnet binary: a 2-account revoke of a sponsored delegation must FAIL (else update REQUESTS)");
}

#[test]
fn recurring_period_cap_400_then_resets_after_period() {
    let mut e = setup();
    let now = e.now();
    let card = e.create_card(
        2,
        KIND_SUBSCRIPTION,
        Terms::Recurring { amount_per_period: 15_990_000, period_secs: (30 * DAY) as u64, start_ts: now, expiry_ts: now + 365 * DAY },
    );
    let t = ok(e.settle(2, 10_000_000, h(1), MERCHANT_A), "first charge (partial period)");
    println!("settle (recurring) CU: {}", t.cu);
    assert_eq!(events::<solsend::CardSettled>(&t.logs)[0].remaining_allowance, 5_990_000);
    let t = ok(e.settle(2, 5_990_000, h(2), MERCHANT_A), "rest of the period");
    assert_eq!(events::<solsend::CardSettled>(&t.logs)[0].remaining_allowance, 0);

    let before = e.balances();
    fails_with(e.settle(2, 10_000, h(3), MERCHANT_A), ALLOWANCES_ERR_EXCEEDS_PERIOD, "same-period overcharge");
    assert_eq!(before, e.balances());

    e.warp(30 * DAY + 1);
    fails_with(e.settle(2, 22_990_000, h(4), MERCHANT_A), ALLOWANCES_ERR_EXCEEDS_PERIOD, "price hike above the per-period cap");
    let t = ok(e.settle(2, 15_990_000, h(5), MERCHANT_A), "next period charge after reset");
    let ev = &events::<solsend::CardSettled>(&t.logs)[0];
    assert_eq!((ev.remaining_allowance, ev.total_settled, ev.status_after), (0, 2 * 15_990_000, STATUS_ACTIVE));
    assert_eq!(e.balances(), (OWNER_START - 2 * 15_990_000, 2 * 15_990_000));
    assert_eq!(read_card(&e.svm, &card).settle_count, 3);
}

#[test]
fn frozen_card_cannot_settle_until_owner_unfreezes() {
    let mut e = setup();
    let card = e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    let t = ok(e.owner_send(ix_freeze(&e.owner.pubkey(), card)), "owner freezes");
    let ev = events::<solsend::CardFrozen>(&t.logs);
    assert_eq!((ev[0].card, ev[0].by), (card, e.owner.pubkey()));
    assert_eq!(read_card(&e.svm, &card).status, STATUS_FROZEN);
    fails_with(e.owner_send(ix_freeze(&e.owner.pubkey(), card)), sol(SolsendError::CardNotActive), "freeze twice");
    fails_with(e.settle(1, USDC, h(1), MERCHANT_A), sol(SolsendError::CardNotActive), "settle frozen");
    assert_eq!(e.balances(), (OWNER_START, 0));

    // the settlement authority cannot unfreeze (reduce-only)
    let s = e.settler.insecure_clone();
    let r = send(&mut e.svm, &[ix_unfreeze(&s.pubkey(), card)], &s, &[]);
    fails_with(r, anchor_err(AnchorErrorCode::ConstraintSeeds), "settler unfreezes");
    let t = ok(e.owner_send(ix_unfreeze(&e.owner.pubkey(), card)), "owner unfreezes");
    assert_eq!(events::<solsend::CardUnfrozen>(&t.logs)[0].card, card);
    ok(e.owner_send(ix_unfreeze(&e.owner.pubkey(), card)), "re-activating an active card is allowed (resets the idle timer)");
    ok(e.settle(1, USDC, h(1), MERCHANT_A), "settle after unfreeze");

    // the settlement authority CAN freeze (reduce-only)
    let t = ok(send(&mut e.svm, &[ix_freeze(&s.pubkey(), card)], &s, &[]), "settler freezes");
    assert_eq!(events::<solsend::CardFrozen>(&t.logs)[0].by, s.pubkey());
    fails_with(e.settle(1, USDC, h(2), MERCHANT_A), sol(SolsendError::CardNotActive), "settle after settler freeze");
}

#[test]
fn paused_blocks_settle_but_refunds_still_work() {
    let mut e = setup();
    e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    ok(e.settle(1, 4 * USDC, h(1), MERCHANT_A), "settle");
    ok(e.admin_send(ix_set_paused(&e.admin.pubkey(), true)), "pause");
    fails_with(e.settle(1, USDC, h(2), MERCHANT_A), sol(SolsendError::Paused), "settle while paused");
    ok(e.refund(1, 4 * USDC, h(1)), "refund while paused");
    assert_eq!(e.balances(), (OWNER_START, 0));
    ok(e.admin_send(ix_set_paused(&e.admin.pubkey(), false)), "unpause");
    ok(e.settle(1, USDC, h(2), MERCHANT_A), "settle after unpause");
}

#[test]
fn idle_card_locks_after_idle_secs_without_use() {
    let mut e = setup_with(Opts { per_tx_max: 0, idle_secs: 30 * DAY });
    e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    e.fixed_card(2, KIND_STORE_LOCKED, 40 * USDC);
    e.warp(30 * DAY); // exactly idle_secs since creation: still allowed (strictly greater locks)
    ok(e.settle(1, USDC, h(1), MERCHANT_A), "settle at exactly idle_secs");
    e.warp(1);
    fails_with(e.settle(2, USDC, h(2), MERCHANT_A), sol(SolsendError::CardIdle), "unused card idle-locked");
    ok(e.settle(1, USDC, h(3), MERCHANT_A), "card 1 was used 1s ago");
    e.warp(30 * DAY + 1);
    let before = e.balances();
    fails_with(e.settle(1, USDC, h(4), MERCHANT_A), sol(SolsendError::CardIdle), "idle since last use");
    assert_eq!(before, e.balances());
}

#[test]
fn merchant_lock_set_on_first_settle_then_enforced() {
    let mut e = setup();
    let card = e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    fails_with(e.settle(1, USDC, h(1), [0u8; 32]), sol(SolsendError::MerchantMismatch), "zero merchant hash");
    assert_eq!(read_card(&e.svm, &card).merchant_lock, [0u8; 32]);
    ok(e.settle(1, USDC, h(2), MERCHANT_A), "first settle locks merchant A");
    let before = e.balances();
    fails_with(e.settle(1, USDC, h(3), MERCHANT_B), sol(SolsendError::MerchantMismatch), "merchant B after lock");
    fails_with(e.settle(1, USDC, h(4), [0u8; 32]), sol(SolsendError::MerchantMismatch), "zero hash after lock");
    assert_eq!(before, e.balances());
    ok(e.settle(1, USDC, h(5), MERCHANT_A), "merchant A again");
    assert_eq!(read_card(&e.svm, &card).merchant_lock, MERCHANT_A);

    // a failed first settle does not lock the merchant (whole tx reverts)
    e.fixed_card(2, KIND_STORE_LOCKED, USDC);
    fails_with(e.settle(2, 2 * USDC, h(6), MERCHANT_B), ALLOWANCES_ERR_EXCEEDS_FIXED, "over-cap first settle at B");
    assert_eq!(read_card(&e.svm, &e.card(2)).merchant_lock, [0u8; 32]);
    ok(e.settle(2, USDC, h(7), MERCHANT_A), "card 2 locks to A instead");
}

#[test]
fn per_tx_max_enforced() {
    let mut e = setup_with(Opts { per_tx_max: 10 * USDC, idle_secs: 0 });
    e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    fails_with(e.settle(1, 10 * USDC + 1, h(1), MERCHANT_A), sol(SolsendError::PerTxLimitExceeded), "per-tx max + 1");
    assert_eq!(e.balances(), (OWNER_START, 0));
    ok(e.settle(1, 10 * USDC, h(2), MERCHANT_A), "exactly per-tx max");
}

#[test]
fn one_time_card_is_used_after_first_settle() {
    let mut e = setup();
    let card = e.fixed_card(1, KIND_ONE_TIME, 25 * USDC);
    let t = ok(e.settle(1, 12 * USDC, h(1), MERCHANT_A), "one-time settle");
    let ev = &events::<solsend::CardSettled>(&t.logs)[0];
    assert_eq!((ev.status_after, ev.remaining_allowance), (STATUS_USED, 0), "a Used card reports no spending power (L3)");
    assert_eq!(fixed_remaining(&e.svm, &e.delegation(1)), 13 * USDC, "the unspent delegation remainder is unreachable");
    assert_eq!(read_card(&e.svm, &card).status, STATUS_USED);
    fails_with(e.settle(1, USDC, h(2), MERCHANT_A), sol(SolsendError::CardNotActive), "second settle on a used card");
    fails_with(e.owner_send(ix_freeze(&e.owner.pubkey(), card)), sol(SolsendError::CardNotActive), "freeze a used card");
    fails_with(e.owner_send(ix_unfreeze(&e.owner.pubkey(), card)), sol(SolsendError::NotAuthorized), "unfreeze a used card");
    assert_eq!(e.balances(), (OWNER_START - 12 * USDC, 12 * USDC));
    ok(e.refund(1, 12 * USDC, h(1)), "refund on a used card");
    ok(e.owner_send(ix_close_card(&e.owner.pubkey(), card)), "close a used card");
}

#[test]
fn settle_rejects_wrong_accounts() {
    let mut e = setup();
    e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    let other = e.add_user(10 * USDC);
    let (s, o, m) = (e.settler.pubkey(), e.owner.pubkey(), e.mint);
    let settler = e.settler.insecure_clone();
    let go = |e: &mut Env, f: &dyn Fn(&mut acc::Settle), n: u8| {
        let mut a = settle_accounts(&s, &o, &m, 1, &h(n));
        f(&mut a);
        send(&mut e.svm, &[ix_settle_with(a, USDC, h(n), MERCHANT_A)], &settler, &[])
    };
    let other_sa = derive_subscription_authority(&other.pubkey(), &m);
    let other_ata = get_associated_token_address(&other.pubkey(), &m);
    fails_with(go(&mut e, &|a| a.subscription_authority = other_sa, 1), sol(SolsendError::InvalidAllowancesAccount), "another user's SA");
    fails_with(go(&mut e, &|a| a.event_authority = Pubkey::new_unique(), 2), sol(SolsendError::InvalidAllowancesAccount), "fake event authority");
    fails_with(go(&mut e, &|a| a.delegation = Pubkey::new_unique(), 3), sol(SolsendError::DelegationMismatch), "other delegation");
    fails_with(go(&mut e, &|a| a.source_token_account = other_ata, 4), sol(SolsendError::SourceMismatch), "other source account");
    fails_with(go(&mut e, &|a| a.allowances_program = spl_token::ID, 5), anchor_err(AnchorErrorCode::ConstraintAddress), "fake Allowances program");
    let mal = e.mallory_ata();
    let r = go(&mut e, &|a| a.treasury_ata = mal, 6);
    assert!(r.is_err(), "destination other than the treasury ATA must fail");
    assert_eq!(e.balances(), (OWNER_START, 0));
    assert_eq!(token_amount(&e.svm, &e.mallory_ata()), 0);
    ok(go(&mut e, &|_| {}, 7), "control: correct accounts");
}

#[test]
fn zero_amounts_rejected() {
    let mut e = setup();
    e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    fails_with(e.settle(1, 0, h(1), MERCHANT_A), sol(SolsendError::ZeroAmount), "settle 0");
    ok(e.settle(1, USDC, h(2), MERCHANT_A), "settle");
    fails_with(e.refund(1, 0, h(2)), sol(SolsendError::ZeroAmount), "refund 0");
}

#[test]
fn direct_pull_by_non_delegatee_fails_with_allowances_130() {
    let mut e = setup();
    e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    let del = e.delegation(1);
    let sa = derive_subscription_authority(&e.owner.pubkey(), &e.mint);
    let mut data = vec![4];
    data.extend_from_slice(&USDC.to_le_bytes());
    data.extend_from_slice(e.owner.pubkey().as_ref());
    data.extend_from_slice(e.mint.as_ref());
    let direct = Instruction {
        program_id: ALLOWANCES_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(del, false),
            AccountMeta::new_readonly(sa, false),
            AccountMeta::new(e.owner_ata, false),
            AccountMeta::new(e.mallory_ata(), false),
            AccountMeta::new_readonly(e.mint, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(e.mallory.pubkey(), true),
            AccountMeta::new_readonly(derive_event_authority(), false),
            AccountMeta::new_readonly(ALLOWANCES_PROGRAM_ID, false),
        ],
        data,
    };
    fails_with(e.mallory_send(direct), ALLOWANCES_ERR_UNAUTHORIZED, "mallory pulls directly");
    assert_eq!(token_amount(&e.svm, &e.owner_ata), OWNER_START);
}

// ═══ refund ══════════════════════════════════════════════════════════════════
#[test]
fn refund_bounded_partial_plus_remainder() {
    let mut e = setup();
    let card = e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    let del = e.delegation(1);
    ok(e.settle(1, 5 * USDC, h(1), MERCHANT_A), "settle 5");
    let t = ok(e.refund(1, 2 * USDC, h(1)), "partial refund 2");
    let ev = &events::<solsend::CardRefunded>(&t.logs)[0];
    assert_eq!((ev.card, ev.owner, ev.amount, ev.auth_hash, ev.record_refunded, ev.destination), (card, e.owner.pubkey(), 2 * USDC, h(1), 2 * USDC, e.owner_ata));
    assert_eq!(e.balances(), (OWNER_START - 3 * USDC, 3 * USDC));

    fails_with(e.refund(1, 3 * USDC + 1, h(1)), sol(SolsendError::RefundExceedsSettled), "over-refund by 1");
    fails_with(e.refund(1, u64::MAX, h(1)), sol(SolsendError::Overflow), "u64 overflow");
    let t = ok(e.refund(1, 3 * USDC, h(1)), "refund the remainder");
    assert_eq!(events::<solsend::CardRefunded>(&t.logs)[0].record_refunded, 5 * USDC);
    assert_eq!(e.balances(), (OWNER_START, 0));
    let rec = read_record(&e.svm, &record_pda(&h(1)));
    assert_eq!((rec.amount, rec.refunded), (5 * USDC, 5 * USDC));
    let c = read_card(&e.svm, &card);
    assert_eq!((c.total_settled, c.total_refunded), (5 * USDC, 5 * USDC));
    assert_eq!(fixed_remaining(&e.svm, &del), 35 * USDC, "refunds do NOT restore the consumed allowance (MVP)");

    fails_with(e.refund(1, 1, h(2)), anchor_err(AnchorErrorCode::AccountNotInitialized), "unknown authorization");
}

/// Replay guard (b): a fully refunded record stays (no close instruction) and refuses more refunds;
/// the same auth_hash still cannot be settled again.
#[test]
fn fully_refunded_record_persists_and_blocks_refund_and_resettle() {
    let mut e = setup();
    e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    ok(e.settle(1, 5 * USDC, h(1), MERCHANT_A), "settle 5");
    ok(e.refund(1, 5 * USDC, h(1)), "full refund");
    let rec = record_pda(&h(1));
    let snapshot = e.svm.get_account(&rec).unwrap();
    fails_with(e.refund(1, 1, h(1)), sol(SolsendError::RefundExceedsSettled), "refund a fully refunded record");
    e.warp(30 * DAY);
    fails_with(e.refund(1, 1, h(1)), sol(SolsendError::RefundExceedsSettled), "still after +30 days");
    fails_with(e.settle(1, 5 * USDC, h(1), MERCHANT_A), SYSTEM_ERR_ALREADY_IN_USE, "re-settle a refunded authorization");
    assert_eq!(e.svm.get_account(&rec).unwrap(), snapshot, "record persists unchanged");
    assert_eq!(e.balances(), (OWNER_START, 0));
}

#[test]
fn refund_to_a_different_token_account_is_rejected() {
    let mut e = setup();
    e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    ok(e.settle(1, 5 * USDC, h(1), MERCHANT_A), "settle");
    let mut a = refund_accounts(&e.settler.pubkey(), &e.owner.pubkey(), &e.mint, 1, &h(1));
    a.source_token_account = e.mallory_ata();
    let s = e.settler.insecure_clone();
    fails_with(send(&mut e.svm, &[ix_refund_with(a, 5 * USDC, h(1))], &s, &[]), sol(SolsendError::SourceMismatch), "refund to mallory");
    // another user's ATA (even a real USDC ATA) is rejected too
    let other = e.add_user(0);
    let mut a = refund_accounts(&e.settler.pubkey(), &e.owner.pubkey(), &e.mint, 1, &h(1));
    a.source_token_account = get_associated_token_address(&other.pubkey(), &e.mint);
    fails_with(send(&mut e.svm, &[ix_refund_with(a, 5 * USDC, h(1))], &s, &[]), sol(SolsendError::SourceMismatch), "refund to another user");
    // a record belongs to one card: card 2's refund cannot drain card 1's record
    e.fixed_card(2, KIND_STORE_LOCKED, 40 * USDC);
    let mut a = refund_accounts(&e.settler.pubkey(), &e.owner.pubkey(), &e.mint, 2, &h(1));
    a.settlement_record = record_pda(&h(1));
    let r = send(&mut e.svm, &[ix_refund_with(a, 5 * USDC, h(1))], &s, &[]);
    fails_with(r, anchor_err(AnchorErrorCode::ConstraintHasOne), "card 2 refunding card 1's record");
    assert_eq!(token_amount(&e.svm, &e.mallory_ata()), 0);
    assert_eq!(e.balances(), (OWNER_START - 5 * USDC, 5 * USDC));
}

#[test]
fn close_card_then_late_refund_still_lands() {
    let mut e = setup();
    let card = e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    let del = e.delegation(1);
    ok(e.settle(1, 7 * USDC, h(1), MERCHANT_A), "settle 7");
    // F8: close_card + Allowances revokeDelegation (receiver = sponsoring fee payer) in ONE owner tx
    let o = e.owner.insecure_clone();
    let ixs = [ix_close_card(&o.pubkey(), card), ix_revoke_delegation(&o.pubkey(), &del, Some(&e.payer.pubkey()))];
    let t = ok(send(&mut e.svm, &ixs, &o, &[]), "close_card + revoke");
    assert_eq!(events::<solsend::CardClosed>(&t.logs)[0].card, card);
    let c = read_card(&e.svm, &card);
    assert_eq!(c.status, STATUS_CLOSED, "card account kept");
    fails_with(e.settle(1, USDC, h(2), MERCHANT_A), sol(SolsendError::CardNotActive), "settle closed card");
    fails_with(e.owner_send(ix_close_card(&e.owner.pubkey(), card)), sol(SolsendError::CardNotActive), "close twice");
    fails_with(e.owner_send(ix_freeze(&e.owner.pubkey(), card)), sol(SolsendError::CardNotActive), "freeze closed");
    fails_with(e.owner_send(ix_unfreeze(&e.owner.pubkey(), card)), sol(SolsendError::NotAuthorized), "unfreeze closed");

    ok(e.refund(1, 7 * USDC, h(1)), "late refund after close");
    assert_eq!(e.balances(), (OWNER_START, 0));
    assert_eq!(read_card(&e.svm, &card).total_refunded, 7 * USDC);

    // a frozen card can be closed too
    let c2 = e.fixed_card(2, KIND_STORE_LOCKED, USDC);
    ok(e.owner_send(ix_freeze(&e.owner.pubkey(), c2)), "freeze card 2");
    ok(e.owner_send(ix_close_card(&e.owner.pubkey(), c2)), "close frozen card 2");
}

// ═══ authorization matrix ════════════════════════════════════════════════════
#[test]
fn unauthorized_signers_rejected_on_every_privileged_ix() {
    let mut e = setup();
    let card = e.fixed_card(1, KIND_STORE_LOCKED, 40 * USDC);
    ok(e.settle(1, 5 * USDC, h(1), MERCHANT_A), "settle");
    let m = e.mallory.pubkey();
    let mint = e.mint;
    let owner = e.owner.pubkey();
    let before = (e.balances(), token_amount(&e.svm, &e.mallory_ata()));

    fails_with(e.mallory_send(ix_set_paused(&m, true)), sol(SolsendError::NotAdmin), "set_paused");
    fails_with(e.mallory_send(ix_set_settlement_authority(&m, m)), sol(SolsendError::NotAdmin), "set_settlement_authority");
    let ix = ix_settle_with(settle_accounts(&m, &owner, &mint, 1, &h(2)), USDC, h(2), MERCHANT_A);
    fails_with(e.mallory_send(ix), sol(SolsendError::NotSettlementAuthority), "settle");
    let ix = ix_refund_with(refund_accounts(&m, &owner, &mint, 1, &h(1)), USDC, h(1));
    fails_with(e.mallory_send(ix), sol(SolsendError::NotSettlementAuthority), "refund");
    fails_with(e.mallory_send(ix_freeze(&m, card)), sol(SolsendError::NotAuthorized), "freeze_card");
    fails_with(e.mallory_send(ix_close_card(&m, card)), anchor_err(AnchorErrorCode::ConstraintSeeds), "close_card");
    ok(e.owner_send(ix_freeze(&owner, card)), "owner freezes");
    fails_with(e.mallory_send(ix_unfreeze(&m, card)), anchor_err(AnchorErrorCode::ConstraintSeeds), "unfreeze_card");
    // the admin is not the settlement authority, and the owner is not the admin
    let ix = ix_settle_with(settle_accounts(&e.admin.pubkey(), &owner, &mint, 1, &h(3)), USDC, h(3), MERCHANT_A);
    fails_with(e.admin_send(ix), sol(SolsendError::NotSettlementAuthority), "admin settles");
    // the settlement authority cannot close cards
    let s = e.settler.insecure_clone();
    let r = send(&mut e.svm, &[ix_close_card(&s.pubkey(), card)], &s, &[]);
    fails_with(r, anchor_err(AnchorErrorCode::ConstraintSeeds), "settler close_card");
    // a missing signature is rejected even with the right pubkey
    let mut ix = ix_set_paused(&e.admin.pubkey(), true);
    ix.accounts[0].is_signer = false;
    assert!(e.mallory_send(ix).is_err(), "unsigned admin");

    assert_eq!(before, (e.balances(), token_amount(&e.svm, &e.mallory_ata())), "no funds moved");
    assert!(!read_config(&e.svm).paused);
}

// ═══ derivations ═════════════════════════════════════════════════════════════
#[test]
fn allowances_derivations_match_cp0b() {
    // event authority is a fixed Allowances PDA; the TS builders derive the same seeds.
    let ea = derive_event_authority();
    assert_eq!(ea, Pubkey::find_program_address(&[b"event_authority"], &ALLOWANCES_PROGRAM_ID).0);
    let user = Pubkey::new_unique();
    let mint = Pubkey::new_unique();
    let sa = derive_subscription_authority(&user, &mint);
    assert_eq!(sa, Pubkey::find_program_address(&[b"SubscriptionAuthority", user.as_ref(), mint.as_ref()], &ALLOWANCES_PROGRAM_ID).0);
    let card = card_pda(&user, 42);
    assert_eq!(
        derive_delegation(&sa, &user, &card, 42),
        Pubkey::find_program_address(&[b"delegation", sa.as_ref(), user.as_ref(), card.as_ref(), &42u64.to_le_bytes()], &ALLOWANCES_PROGRAM_ID).0
    );
}
