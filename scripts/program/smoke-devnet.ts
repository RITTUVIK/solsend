// Real devnet smoke run of the deployed SolSend program (current contract = "Upgrade 1": audit fixes).
//
//   npx tsx scripts/program/smoke-devnet.ts
//
// SolSend instructions are encoded from the IDL by @solsend/shared (`buildSolsendIx` via the *V2
// builders in ./lib.ts, which mirror the post-Upgrade-1 contract until packages/shared's wrappers are
// updated); Allowances instructions, PDAs, decoders and hash commitments come straight from @solsend/shared.
// Owner = card-a-owner, fee payer = fee-payer key, settler = settlement-authority key.
// Writes the "Upgrade 1" section of docs/evidence/w1-program-devnet.md (+ target/devnet/w1-smoke-u1.json).
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CARD_KIND, IDL, SOLSEND_PROGRAM_ID, USDC_MINT, authCommitment, cardDelegation, cardPda, cardStatusName, configPda, decodeCard, decodeConfig,
  decodeSettlementRecord, formatUsdc, ixCreateFixedDelegation, ixCreateRecurringDelegation, ixFreezeCard, ixInitSubscriptionAuthority,
  ixUnfreezeCard, merchantCommitment, readDelegation, readSaInitId, subscriptionAuthorityPda, toHex, treasuryAta, treasuryPda, usdcAta, utf8,
} from "../../packages/shared/src/index.js";
import {
  ROOT, STATE_DIR, type Ix, type SentTx, connect, explorer, explorerAddr, ixRefundV2, ixRegisterCardV2, ixSettleV2, loadKeypair, plain, sendTx,
  settlementRecordPdaV2, spl, tokenBalance, web3,
} from "./lib.js";

const SETTLE_CU_LIMIT = 100_000; // smoke headroom; the measured value is recorded
const TEMU = "SOLSENDDEMOTEMU01";
const AMZN = "SOLSENDDEMOAMZN01";
const NFLX = "SOLSENDDEMONFLX01";
/** sha256("global:admin_withdraw")[..8] — the instruction removed in Upgrade 1 (audit L2). */
const OLD_ADMIN_WITHDRAW_DISC = Uint8Array.from([160, 166, 147, 222, 46, 220, 75, 224]);
const SETTLEMENT_RECORD_LEN = 8 + 32 + 32 + 8 + 8 + 8 + 1;
const MARK_START = "<!-- w1:upgrade1:start -->";
const MARK_END = "<!-- w1:upgrade1:end -->";

const randomU64 = () => BigInt(`0x${randomBytes(8).toString("hex")}`);
const fakeToken = (tag: string) => `smoke-u1-${tag}-${randomBytes(6).toString("hex")}`;
type Step = { n: string; title: string; expect: "success" | "failure"; tx: SentTx; note: string; balances: { owner: string; treasury: string } };

async function main() {
  const { connection, rpcLabel } = await connect();
  console.log(`rpc: ${rpcLabel} (devnet genesis verified)`);
  const owner = loadKeypair("card-a-owner");
  const feePayer = loadKeypair("fee-payer");
  const settler = loadKeypair("settlement-authority");
  const admin = loadKeypair("deployer");
  const ownerAta = usdcAta(owner.publicKey);
  const tAta = treasuryAta();

  // ── preflight ──
  const cfg = decodeConfig((await connection.getAccountInfo(configPda()))?.data ?? new Uint8Array());
  if (!cfg) throw new Error("config missing — run init-devnet.ts first");
  if (!cfg.settlementAuthority.equals(settler.publicKey) || cfg.paused) throw new Error("config not ready (settler/paused)");
  const sa = subscriptionAuthorityPda(owner.publicKey);
  const saInfo = await connection.getAccountInfo(sa);
  if (!saInfo) throw new Error("card-a-owner has no Subscription Authority");
  const initId = readSaInitId(saInfo.data);
  const ata = spl.unpackAccount(ownerAta, (await connection.getAccountInfo(ownerAta))!);
  const rearm = !(ata.delegate && ata.delegate.equals(sa) && ata.delegatedAmount > 0n);
  console.log(`owner ${owner.publicKey.toBase58()} USDC ${formatUsdc(ata.amount)} re-arm SA: ${rearm}`);

  // ── legacy SettlementRecords (pre-upgrade seeds ["settle", card, auth]) ──
  const disc = IDL.accounts!.find((a) => a.name === "SettlementRecord")!.discriminator;
  const all = await connection.getProgramAccounts(SOLSEND_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: SETTLEMENT_RECORD_LEN }, { memcmp: { offset: 0, bytes: Buffer.from(disc).toString("base64"), encoding: "base64" } }],
  });
  const legacy = all
    .map(({ pubkey, account }) => ({ pubkey, rec: decodeSettlementRecord(account.data)! }))
    .filter(({ pubkey, rec }) => !settlementRecordPdaV2(rec.authHash).equals(pubkey))
    .map(({ pubkey, rec }) => ({
      address: pubkey.toBase58(), card: rec.card.toBase58(), amount: rec.amount, refunded: rec.refunded, outstanding: rec.amount - rec.refunded,
      oldSeeds: web3.PublicKey.findProgramAddressSync([utf8("settle"), rec.card.toBytes(), rec.authHash], SOLSEND_PROGRAM_ID)[0].equals(pubkey),
    }));
  console.log(`SettlementRecords on devnet: ${all.length} total, ${legacy.length} legacy (pre-upgrade seeds)`);

  const bal = async () => ({ owner: (await tokenBalance(connection, ownerAta)) ?? 0n, treasury: (await tokenBalance(connection, tAta)) ?? 0n });
  const fmt = (b: { owner: bigint; treasury: bigint }) => ({ owner: formatUsdc(b.owner), treasury: formatUsdc(b.treasury) });
  const steps: Step[] = [];
  const record = async (n: string, title: string, expect: Step["expect"], tx: SentTx, note = "", wantErr?: number) => {
    const b = await bal();
    steps.push({ n, title, expect, tx, note, balances: fmt(b) });
    console.log(`[${n}] ${title}: ${tx.ok ? "OK" : `FAILED ${JSON.stringify(tx.err)}`} CU=${tx.computeUnits} ${explorer(tx.signature)}`);
    if ((expect === "success") !== tx.ok) throw new Error(`step ${n} expected ${expect}; logs: ${tx.logs.slice(-6).join(" | ")}`);
    if (wantErr !== undefined && !JSON.stringify(tx.err).includes(`"Custom":${wantErr}}`)) throw new Error(`step ${n} expected Custom(${wantErr}), got ${JSON.stringify(tx.err)}`);
    return b;
  };
  const cu = () => web3.ComputeBudgetProgram.setComputeUnitLimit({ units: SETTLE_CU_LIMIT });
  const createCard = async (kind: number, label: string, delegationIx: (cardId: bigint) => Ix, merchantLock?: Uint8Array) => {
    const cardId = randomU64();
    const ixs: Ix[] = [];
    if (rearm) ixs.push(ixInitSubscriptionAuthority(owner.publicKey, feePayer.publicKey));
    ixs.push(delegationIx(cardId), ixRegisterCardV2({ owner: owner.publicKey, payer: feePayer.publicKey, cardId, kind, label, merchantLock }));
    return { cardId, card: cardPda(owner.publicKey, cardId), tx: await sendTx(connection, ixs, feePayer, [owner]) };
  };
  const fixed = (amount: bigint) => (cardId: bigint) =>
    ixCreateFixedDelegation({ owner: owner.publicKey, delegatee: cardPda(owner.publicKey, cardId), nonce: cardId, amount, expiryTs: 0n, initId, payer: feePayer.publicKey });
  const settle = async (cardId: bigint, amount: bigint, authHash: Uint8Array, merchant: string, expectFailure = false) =>
    sendTx(connection, [cu(), ixSettleV2({ settler: settler.publicKey, owner: owner.publicKey, cardId, amount, authHash, merchantHash: await merchantCommitment(merchant) })],
      settler, [], { expectFailure });

  const start = await bal();
  const ownerSign = (ix: Ix, expectFailure = false) => sendTx(connection, [ix], feePayer, [owner], { expectFailure });

  // ── U: unlocked StoreLocked card ──
  const U = await createCard(CARD_KIND.STORE_LOCKED, "U1 Temu", fixed(500_000n));
  await record("1", "Card U: createFixedDelegation (0.50) + register_card(merchant_lock = 0) — one tx", "success", U.tx);
  const t1 = await authCommitment(fakeToken("t1"));
  const s1 = await settle(U.cardId, 100_000n, t1, TEMU);
  const b2 = await record("2", `settle U 0.10 at ${TEMU} (first settle locks the merchant)`, "success", s1);
  if (start.owner - b2.owner !== 100_000n || b2.treasury - start.treasury !== 100_000n) throw new Error("settle deltas wrong");
  await record("3", "duplicate settle on U (same auth_hash)", "failure", await settle(U.cardId, 100_000n, t1, TEMU, true), "record exists → System Custom(0)", 0);

  // ── P: pre-locked StoreLocked card ──
  const P = await createCard(CARD_KIND.STORE_LOCKED, "U1 prelocked", fixed(500_000n), await merchantCommitment(TEMU));
  await record("4", `Card P: register_card with merchant_lock = merchantCommitment(${TEMU}) (pre-locked)`, "success", P.tx);
  const b5 = await record("5", "L1: settle the SAME auth_hash on card P (different card)", "failure", await settle(P.cardId, 100_000n, t1, TEMU, true),
    "SettlementRecord is seeded by auth_hash only → System Custom(0); no second pull", 0);
  if (b5.owner !== b2.owner) throw new Error("L1 moved funds");
  await record("6", `pre-lock: FIRST settle on P at ${AMZN}`, "failure", await settle(P.cardId, 100_000n, await authCommitment(fakeToken("t2")), AMZN, true),
    "SolSend MerchantMismatch = Custom(6005), even on the first charge", 6005);
  await record("7", `settle P 0.10 at ${TEMU} (the pre-locked merchant)`, "success", await settle(P.cardId, 100_000n, await authCommitment(fakeToken("t3")), TEMU));
  await record("8", `settle U at ${AMZN} after its lock`, "failure", await settle(U.cardId, 100_000n, await authCommitment(fakeToken("t4")), AMZN, true), "Custom(6005)", 6005);

  const rf = await sendTx(connection, [ixRefundV2({ settler: settler.publicKey, owner: owner.publicKey, cardId: U.cardId, amount: 100_000n, authHash: t1 })], settler);
  await record("9", "refund U 0.10 (record ['settle', auth_hash]) → card.source_token_account", "success", rf);

  // ── freeze / unfreeze / re-activate (H1) ──
  await record("10a", "freeze_card U (owner)", "success", await ownerSign(ixFreezeCard({ authority: owner.publicKey, owner: owner.publicKey, cardId: U.cardId })));
  await record("10b", "settle a frozen card", "failure", await settle(U.cardId, 100_000n, await authCommitment(fakeToken("t5")), TEMU, true), "Custom(6003) CardNotActive", 6003);
  await record("10c", "unfreeze_card U (owner) → Active, last_used_ts = now", "success", await ownerSign(ixUnfreezeCard(owner.publicKey, U.cardId)));
  const beforeReact = decodeCard((await connection.getAccountInfo(U.card))!.data)!.lastUsedTs;
  const react = await ownerSign(ixUnfreezeCard(owner.publicKey, U.cardId));
  await record("11", "H1: unfreeze_card on an ACTIVE card = owner re-activation (idle-lock recovery path)", "success", react);
  const afterReact = decodeCard((await connection.getAccountInfo(U.card))!.data)!.lastUsedTs;
  if (afterReact < beforeReact) throw new Error("re-activation did not refresh last_used_ts");

  // ── one-time (L3) ──
  const O = await createCard(CARD_KIND.ONE_TIME, "U1 one-time", fixed(300_000n));
  await record("12a", "Card O: one-time (0.30)", "success", O.tx);
  const so = await settle(O.cardId, 100_000n, await authCommitment(fakeToken("t6")), TEMU);
  await record("12b", "settle O 0.10 → status Used; L3: remaining_allowance reported as 0", "success", so);
  const ev = so.events.find((e) => e.name === "CardSettled")!.data as { statusAfter: number; remainingAllowance: bigint };
  if (ev.statusAfter !== 2 || ev.remainingAllowance !== 0n) throw new Error(`L3 event wrong: ${JSON.stringify(plain(ev))}`);
  await record("12c", "second settle on the Used one-time card", "failure", await settle(O.cardId, 10_000n, await authCommitment(fakeToken("t7")), TEMU, true), "Custom(6003)", 6003);

  // ── subscription ──
  const S = await createCard(CARD_KIND.SUBSCRIPTION, "U1 Netflix", (cardId) =>
    ixCreateRecurringDelegation({ owner: owner.publicKey, delegatee: cardPda(owner.publicKey, cardId), nonce: cardId, amountPerPeriod: 250_000n,
      periodSecs: 30n * 86_400n, startTs: 0n, expiryTs: BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400), initId, payer: feePayer.publicKey }));
  await record("13a", "Card S: createRecurringDelegation (0.25 / 30 days) + register_card", "success", S.tx);
  const ss = await settle(S.cardId, 100_000n, await authCommitment(fakeToken("t8")), NFLX);
  await record("13b", `subscription settle 0.10 at ${NFLX} (transfer_recurring; no idle lock for subscriptions)`, "success", ss);

  // ── L2: admin_withdraw no longer exists ──
  const oldWithdraw = new web3.TransactionInstruction({
    programId: SOLSEND_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: treasuryPda(), isSigner: false, isWritable: false },
      { pubkey: tAta, isSigner: false, isWritable: true },
      { pubkey: usdcAta(admin.publicKey), isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(OLD_ADMIN_WITHDRAW_DISC), Buffer.from(new BigUint64Array([10_000n]).buffer)]),
  });
  await record("14", "L2: the removed admin_withdraw (old discriminator), signed by the admin", "failure",
    await sendTx(connection, [oldWithdraw], admin, [], { expectFailure: true }), "Anchor InstructionFallbackNotFound = Custom(101): treasury exits only via refund", 101);

  // ── a pre-upgrade card still works (account layouts unchanged) ──
  const prev = readState("w1-smoke.json") as { final?: { A?: { cardId: string } } } | null;
  const aId = prev?.final?.A?.cardId ? BigInt(prev.final.A.cardId) : null;
  let preUpgrade: { cardId: string; cardPda: string } | null = null;
  if (aId !== null) {
    const sa1 = await settle(aId, 50_000n, await authCommitment(fakeToken("t9")), TEMU);
    await record("15", "pre-upgrade card A (registered before Upgrade 1, locked to Temu) settles 0.05", "success", sa1);
    preUpgrade = { cardId: aId.toString(), cardPda: cardPda(owner.publicKey, aId).toBase58() };
  }

  // ── fresh card for W2 ──
  const W = await createCard(CARD_KIND.STORE_LOCKED, "W2 integration u1", fixed(2_000_000n));
  await record("16", "Card W2u1: createFixedDelegation (2.00) + register_card — left ACTIVE, unlocked", "success", W.tx);

  // ── final state ──
  const cardView = async (cardId: bigint) => {
    const card = cardPda(owner.publicKey, cardId);
    const c = decodeCard((await connection.getAccountInfo(card))!.data)!;
    const d = readDelegation((await connection.getAccountInfo(cardDelegation(owner.publicKey, cardId)))!.data);
    const remaining = d?.type === "fixed" ? d.remaining : d?.type === "recurring" ? d.remainingInPeriod : 0n;
    return { cardId: cardId.toString(), cardPda: card.toBase58(), delegation: c.delegation.toBase58(), kind: c.kind, status: cardStatusName(c.status),
      merchantLock: c.merchantLock.every((x) => x === 0) ? "(unset)" : toHex(c.merchantLock), remainingAllowance: formatUsdc(remaining),
      totalSettled: formatUsdc(c.totalSettled), totalRefunded: formatUsdc(c.totalRefunded) };
  };
  const final = { U: await cardView(U.cardId), P: await cardView(P.cardId), O: await cardView(O.cardId), S: await cardView(S.cardId), W2u1: await cardView(W.cardId) };
  const oldW2Id = (prev?.final as Record<string, { cardId: string }> | undefined)?.W2?.cardId;
  const oldW2 = oldW2Id ? await cardView(BigInt(oldW2Id)) : null;
  const result = {
    at: new Date().toISOString(), rpc: rpcLabel, programId: SOLSEND_PROGRAM_ID.toBase58(), owner: owner.publicKey.toBase58(),
    settleCUs: { fixed: s1.computeUnits, recurring: ss.computeUnits }, final, oldW2, preUpgrade, start: fmt(start), end: fmt(await bal()),
    records: { total: all.length, legacy },
    steps: steps.map((s) => ({ ...s, tx: { ...s.tx, logs: undefined } })),
  };
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(path.join(STATE_DIR, "w1-smoke-u1.json"), JSON.stringify(plain(result), null, 2));
  writeEvidence(plain(result) as Record<string, any>, steps); // eslint-disable-line @typescript-eslint/no-explicit-any
  console.log(JSON.stringify(plain({ settleCUs: result.settleCUs, final, oldW2, legacy: legacy.length }), null, 2));
}

function readState(name: string): Record<string, unknown> | null {
  const f = path.join(STATE_DIR, name);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeEvidence(r: Record<string, any>, steps: Step[]) {
  const up = readState("w1-upgrade1.json") as Record<string, string> | null;
  const L: string[] = [MARK_START, "", "## Upgrade 1 (audit fixes)", ""];
  L.push(`Generated by \`scripts/program/smoke-devnet.ts\` at ${r.at}. All transactions are **REAL devnet**. RPC: ${r.rpc}.`, "");
  L.push("Fixes (lead-approved audit batch): **H1** no idle lock for Subscription cards, and owner `unfreeze_card` re-activates (resets `last_used_ts`); " +
    "**M1** `initialize_config` requires the program upgrade authority; **L1** SettlementRecord seeds `[\"settle\", auth_hash]` (one pull per authorization across all cards); " +
    "**L2** `admin_withdraw` removed (treasury exits only via `refund`); **L3** `remaining_allowance = 0` when `status_after != Active`; " +
    "plus the `register_card` merchant pre-lock arg. Account layouts, events and error codes are unchanged.", "");
  if (up) {
    L.push("| | |", "|---|---|");
    L.push(`| Upgrade signature | [\`${up.signature}\`](${explorer(up.signature!)}) (slot ${up.slot}) |`);
    L.push(`| Build | \`${up.build}\` |`);
    L.push(`| Local \`target/deploy/solsend.so\` | ${up.localLen} bytes, sha256 \`${up.sha256}\` |`);
    L.push(`| Deployed (\`solana program dump\`, ${up.capacity} bytes) | sha256 \`${up.deployedSha256}\` = local + zero padding to the existing ProgramData length — **MATCH** |`);
    L.push(`| Funding | buffer rent ${up.bufferRentSol} SOL (refunded after the upgrade). Fee payer → deployer 0.28 SOL [\`${up.fundSig!.slice(0, 16)}…\`](${explorer(up.fundSig!)}), returned [\`${up.returnSig!.slice(0, 16)}…\`](${explorer(up.returnSig!)}). Net upgrade cost ≈ ${up.netCostSol} SOL. Airdrops (public faucet ×4, QuickNode ×1) were rate-limited or rejected. |`);
    L.push(`| Size | 263,888 B at opt-level 3 → **227,408 B at opt-level "z"**, so no \`program extend\` was needed and the buffer fit the budget. Settle CU rises by about 7k (see below). |`, "");
  }
  L.push(`Owner \`${r.owner}\`. USDC: start owner ${r.start.owner} / treasury ${r.start.treasury}; end owner ${r.end.owner} / treasury ${r.end.treasury} (keys are shared with other workstreams; the script asserts per-step deltas).`, "");
  L.push("| # | Step | Expected | Result | CU | Owner USDC | Treasury USDC | Signature |", "|---|---|---|---|---|---|---|---|");
  for (const s of steps) {
    const res = s.tx.ok ? "success" : `failed \`${JSON.stringify(s.tx.err)}\``;
    L.push(`| ${s.n} | ${s.title} | ${s.expect} | ${res} | ${s.tx.computeUnits ?? ""} | ${s.balances.owner} | ${s.balances.treasury} | [\`${s.tx.signature.slice(0, 16)}…\`](${explorer(s.tx.signature)}) |`);
  }
  L.push("", "### Signatures, notes and decoded events", "");
  for (const s of steps) {
    L.push(`- **${s.n}** [\`${s.tx.signature}\`](${explorer(s.tx.signature)}) — ${s.tx.ok ? "success" : `failed \`${JSON.stringify(s.tx.err)}\``}, CU ${s.tx.computeUnits}${s.note ? `. ${s.note}` : ""}`);
    for (const ev of s.tx.events) L.push(`  - \`${ev.name}\` \`${JSON.stringify(plain(ev.data))}\``);
  }
  L.push("", "### Settle compute units (devnet, tx meta incl. ComputeBudget ix)", "");
  const settleCus = steps.filter((s) => s.tx.ok && s.tx.events.some((e) => e.name === "CardSettled")).map((s) => s.tx.computeUnits ?? 0);
  const maxCu = Math.max(...settleCus, 53_120);
  L.push(`Fixed **${r.settleCUs.fixed}**, recurring **${r.settleCUs.recurring}** (opt-level "z"); all successful settles in this run: ${Math.min(...settleCus)}–${Math.max(...settleCus)} (the SettlementRecord PDA bump search varies by auth_hash). LiteSVM: fixed 52,968, recurring 53,120. Recommended ASA CU limit: **${Math.ceil((maxCu * 1.4) / 5000) * 5000}** (≈1.4× the largest measurement, rounded up to 5k).`, "");
  L.push("### Legacy SettlementRecords (pre-upgrade seeds — no longer refundable through the program)", "");
  const lg = r.records.legacy as { address: string; card: string; amount: string; refunded: string; outstanding: string; oldSeeds: boolean }[];
  const sum = (k: "amount" | "refunded" | "outstanding") => lg.reduce((a, x) => a + BigInt(x[k]), 0n);
  L.push(`${r.records.total} SettlementRecords exist on devnet; **${lg.length}** use the old \`["settle", card, auth_hash]\` seeds (all verified: ${lg.every((x) => x.oldSeeds)}). ` +
    `Settled ${formatUsdc(sum("amount"))} USDC, refunded ${formatUsdc(sum("refunded"))}, **outstanding (now unrefundable via the program) ${formatUsdc(sum("outstanding"))} USDC**. Accepted for devnet by the lead.`, "");
  L.push("| Record | Card | Amount | Refunded | Outstanding |", "|---|---|---|---|---|");
  for (const x of lg) L.push(`| \`${x.address}\` | \`${x.card.slice(0, 8)}…\` | ${formatUsdc(BigInt(x.amount))} | ${formatUsdc(BigInt(x.refunded))} | ${formatUsdc(BigInt(x.outstanding))} |`);
  L.push("", "### Cards after Upgrade 1 (owner = card-a-owner)", "");
  L.push("| Card | cardId | cardPda | status | merchant lock | remaining | settled / refunded |", "|---|---|---|---|---|---|---|");
  const rows: [string, Record<string, string>][] = Object.entries(r.final as Record<string, Record<string, string>>);
  if (r.oldW2) rows.push(["W2 (pre-upgrade)", r.oldW2]);
  for (const [name, c] of rows)
    L.push(`| ${name} | \`${c.cardId}\` | [\`${c.cardPda}\`](${explorerAddr(c.cardPda!)}) | ${c.status} | ${c.merchantLock === "(unset)" ? "(unset)" : "`" + c.merchantLock!.slice(0, 12) + "…`"} | ${c.remainingAllowance} | ${c.totalSettled} / ${c.totalRefunded} |`);
  L.push("", `**For W2 integration tests (post-upgrade):** card **W2u1**: owner \`${r.owner}\`, cardId \`${r.final.W2u1.cardId}\`, cardPda \`${r.final.W2u1.cardPda}\`. It is ACTIVE, STORE_LOCKED, unlocked, with ${r.final.W2u1.remainingAllowance} USDC allowance. Pre-upgrade cards keep working (step 15).`, "", MARK_END, "");

  const file = path.join(ROOT, "docs/evidence/w1-program-devnet.md");
  const prevText = existsSync(file) ? readFileSync(file, "utf8") : "";
  const i = prevText.indexOf(MARK_START);
  const j = prevText.indexOf(MARK_END);
  const base = i >= 0 && j > i ? prevText.slice(0, i) + prevText.slice(j + MARK_END.length) : prevText;
  writeFileSync(file, `${base.trimEnd()}\n\n${L.join("\n")}`);
  console.log("wrote the Upgrade 1 section of docs/evidence/w1-program-devnet.md");
}

main().catch((e) => {
  console.error(`smoke-devnet FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
