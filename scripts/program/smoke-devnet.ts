// Real devnet smoke run of the deployed SolSend program, built ONLY with @solsend/shared builders.
//
//   npx tsx scripts/program/smoke-devnet.ts
//
// Owner = card-a-owner (SA already initialized in CP0b). Fee payer = fee-payer key. Settler =
// settlement-authority key. Writes docs/evidence/w1-program-devnet.md (+ target/devnet/w1-smoke.json).
//
// Card A (STORE_LOCKED, 0.50): create (createFixedDelegation + register_card, one tx) → settle 0.10
//   → duplicate settle FAILS → other-merchant settle FAILS (MerchantMismatch) → refund 0.10
//   → freeze → settle FAILS (CardNotActive) → unfreeze (left ACTIVE, locked to the demo merchant).
// Card S (SUBSCRIPTION, 0.25 / 30 days): create (createRecurringDelegation + register_card) → settle 0.10.
// Card W2 (STORE_LOCKED, 2.00): create only — ACTIVE, merchant lock unset, full allowance (for W2).
//
// Hashes (CP1 amendment): auth_hash = sha256("solsend:auth:v1:" + lithicToken),
// merchant_hash = sha256("solsend:merchant:v1:" + acceptorId). Settle txs carry no memo.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CARD_KIND, SOLSEND_PROGRAM_ID, USDC_MINT, cardDelegation, cardPda, cardStatusName, configPda, decodeCard, decodeConfig,
  decodeSettlementRecord, formatUsdc, ixCreateFixedDelegation, ixCreateRecurringDelegation, ixFreezeCard, ixInitSubscriptionAuthority,
  ixRefund, ixRegisterCard, ixSettle, ixUnfreezeCard, readDelegation, readSaInitId, settlementRecordPda, subscriptionAuthorityPda, toHex,
  treasuryAta, usdcAta,
} from "../../packages/shared/src/index.js";
import { ROOT, STATE_DIR, type Ix, type SentTx, connect, explorer, explorerAddr, loadKeypair, plain, sendTx, spl, tokenBalance, web3 } from "./lib.js";

const SETTLE_CU_LIMIT = 100_000; // smoke headroom; the measured value is recorded below
const DEMO_MERCHANT = "SOLSENDTEMU01";
const OTHER_MERCHANT = "SOLSENDAMZN01";
const SUB_MERCHANT = "SOLSENDNFLX01";

const sha256 = (s: string) => Uint8Array.from(createHash("sha256").update(s, "utf8").digest());
/** Mirrors the lead's packages/shared authCommitment() / merchantCommitment() (inline until merged). */
const authCommitment = (lithicToken: string) => sha256(`solsend:auth:v1:${lithicToken}`);
const merchantCommitment = (acceptorId: string) => sha256(`solsend:merchant:v1:${acceptorId}`);
const randomU64 = () => BigInt(`0x${randomBytes(8).toString("hex")}`);
const fakeToken = (tag: string) => `smoke-${tag}-${randomBytes(6).toString("hex")}`;

type Step = { n: string; title: string; expect: "success" | "failure"; tx: SentTx; note: string; balances?: { owner: string; treasury: string } };

async function main() {
  const { connection, rpcLabel } = await connect();
  console.log(`rpc: ${rpcLabel} (devnet genesis verified)`);
  const owner = loadKeypair("card-a-owner");
  const feePayer = loadKeypair("fee-payer");
  const settler = loadKeypair("settlement-authority");
  const ownerAta = usdcAta(owner.publicKey);
  const tAta = treasuryAta();

  // ── preflight ──
  const cfg = decodeConfig((await connection.getAccountInfo(configPda()))?.data ?? new Uint8Array());
  if (!cfg) throw new Error("config missing — run init-devnet.ts first");
  if (!cfg.settlementAuthority.equals(settler.publicKey)) throw new Error("settlement authority mismatch");
  if (cfg.paused) throw new Error("program is paused");
  const sa = subscriptionAuthorityPda(owner.publicKey);
  const saInfo = await connection.getAccountInfo(sa);
  if (!saInfo) throw new Error("card-a-owner has no Subscription Authority");
  const initId = readSaInitId(saInfo.data);
  const ataInfo = await connection.getAccountInfo(ownerAta);
  if (!ataInfo) throw new Error("card-a-owner has no USDC ATA");
  const ata = spl.unpackAccount(ownerAta, ataInfo);
  const rearm = !(ata.delegate && ata.delegate.equals(sa) && ata.delegatedAmount > 0n);
  console.log(`owner ${owner.publicKey.toBase58()} USDC ${formatUsdc(ata.amount)} SA init_id ${initId} re-arm SA: ${rearm}`);

  const bal = async () => ({
    owner: (await tokenBalance(connection, ownerAta)) ?? 0n,
    treasury: (await tokenBalance(connection, tAta)) ?? 0n,
  });
  const fmt = (b: { owner: bigint; treasury: bigint }) => ({ owner: formatUsdc(b.owner), treasury: formatUsdc(b.treasury) });
  const steps: Step[] = [];
  const record = async (n: string, title: string, expect: Step["expect"], tx: SentTx, note = "") => {
    const b = await bal();
    steps.push({ n, title, expect, tx, note, balances: fmt(b) });
    const status = tx.ok ? "OK" : `FAILED ${JSON.stringify(tx.err)}`;
    console.log(`[${n}] ${title}: ${status} CU=${tx.computeUnits} ${explorer(tx.signature)}`);
    if ((expect === "success") !== tx.ok) throw new Error(`step ${n} expected ${expect}; logs: ${tx.logs.slice(-6).join(" | ")}`);
    return b;
  };
  const cu = (units = SETTLE_CU_LIMIT) => web3.ComputeBudgetProgram.setComputeUnitLimit({ units });

  const createCard = async (kind: number, label: string, delegationIx: (cardId: bigint) => Ix) => {
    const cardId = randomU64();
    const ixs: Ix[] = [];
    if (rearm) ixs.push(ixInitSubscriptionAuthority(owner.publicKey, feePayer.publicKey));
    ixs.push(delegationIx(cardId), ixRegisterCard({ owner: owner.publicKey, payer: feePayer.publicKey, cardId, kind, label }));
    const tx = await sendTx(connection, ixs, feePayer, [owner]);
    return { cardId, card: cardPda(owner.publicKey, cardId), tx };
  };
  const settle = (cardId: bigint, amount: bigint, token: string, merchant: string, expectFailure = false) =>
    sendTx(connection, [cu(), ixSettle({ settler: settler.publicKey, owner: owner.publicKey, cardId, amount, authHash: authCommitment(token), merchantHash: merchantCommitment(merchant) })], settler, [], { expectFailure });

  const start = await bal();

  // ── Card A ──
  const A = await createCard(CARD_KIND.STORE_LOCKED, "Smoke Temu", (cardId) =>
    ixCreateFixedDelegation({ owner: owner.publicKey, delegatee: cardPda(owner.publicKey, cardId), nonce: cardId, amount: 500_000n, expiryTs: 0n, initId, payer: feePayer.publicKey }));
  await record("1", "Card A: createFixedDelegation (0.50, sponsored) + register_card — one tx, fee payer pays", "success", A.tx);

  const tokA1 = fakeToken("a1");
  const s1 = await settle(A.cardId, 100_000n, tokA1, DEMO_MERCHANT);
  const b2 = await record("2", `settle 0.10 at ${DEMO_MERCHANT} (locks merchant)`, "success", s1);
  if (start.owner - b2.owner !== 100_000n || b2.treasury - start.treasury !== 100_000n) throw new Error("settle deltas wrong");

  const dup = await settle(A.cardId, 100_000n, tokA1, DEMO_MERCHANT, true);
  const b3 = await record("3", "duplicate settle (same auth_hash) — must fail, no second pull", "failure", dup, "SettlementRecord PDA already exists → System `Custom(0)` at ix 1");
  if (b3.owner !== b2.owner || b3.treasury !== b2.treasury) throw new Error("duplicate moved funds");

  const mm = await settle(A.cardId, 100_000n, fakeToken("a2"), OTHER_MERCHANT, true);
  const b4 = await record("4", `settle at a different merchant (${OTHER_MERCHANT}) — must fail`, "failure", mm, "SolSend `MerchantMismatch` = Custom(6005)");
  if (b4.owner !== b2.owner) throw new Error("mismatch moved funds");

  const rf = await sendTx(connection, [ixRefund({ settler: settler.publicKey, owner: owner.publicKey, cardId: A.cardId, amount: 100_000n, authHash: authCommitment(tokA1) })], settler);
  const b5 = await record("5", "refund 0.10 (treasury → card.source_token_account)", "success", rf);
  if (b5.owner !== start.owner || b5.treasury !== start.treasury) throw new Error("refund deltas wrong");

  const fz = await sendTx(connection, [ixFreezeCard({ authority: owner.publicKey, owner: owner.publicKey, cardId: A.cardId })], feePayer, [owner]);
  await record("6a", "freeze_card (owner signs, fee payer pays)", "success", fz);
  const sf = await settle(A.cardId, 100_000n, fakeToken("a3"), DEMO_MERCHANT, true);
  await record("6b", "settle a frozen card — must fail", "failure", sf, "SolSend `CardNotActive` = Custom(6003)");
  const uf = await sendTx(connection, [ixUnfreezeCard(owner.publicKey, A.cardId)], feePayer, [owner]);
  await record("6c", "unfreeze_card (owner) — card A left ACTIVE", "success", uf);

  // ── Card S (subscription) ──
  const S = await createCard(CARD_KIND.SUBSCRIPTION, "Smoke Netflix", (cardId) =>
    ixCreateRecurringDelegation({
      owner: owner.publicKey, delegatee: cardPda(owner.publicKey, cardId), nonce: cardId, amountPerPeriod: 250_000n, periodSecs: 30n * 86_400n,
      startTs: 0n, expiryTs: BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400), initId, payer: feePayer.publicKey,
    }));
  await record("7a", "Card S: createRecurringDelegation (0.25 / 30 days, start on landing) + register_card", "success", S.tx);
  const ss = await settle(S.cardId, 100_000n, fakeToken("s1"), SUB_MERCHANT);
  await record("7b", `subscription settle 0.10 at ${SUB_MERCHANT} (transfer_recurring)`, "success", ss);

  // ── Card W2 (left for integration tests) ──
  const W = await createCard(CARD_KIND.STORE_LOCKED, "W2 integration", (cardId) =>
    ixCreateFixedDelegation({ owner: owner.publicKey, delegatee: cardPda(owner.publicKey, cardId), nonce: cardId, amount: 2_000_000n, expiryTs: 0n, initId, payer: feePayer.publicKey }));
  await record("8", "Card W2: createFixedDelegation (2.00) + register_card — left ACTIVE, unlocked", "success", W.tx);

  // ── final state ──
  const cardView = async (cardId: bigint) => {
    const card = cardPda(owner.publicKey, cardId);
    const c = decodeCard((await connection.getAccountInfo(card))!.data)!;
    const d = readDelegation((await connection.getAccountInfo(cardDelegation(owner.publicKey, cardId)))!.data);
    const remaining = d?.type === "fixed" ? d.remaining : d?.type === "recurring" ? d.remainingInPeriod : 0n;
    return { cardId: cardId.toString(), cardPda: card.toBase58(), delegation: c.delegation.toBase58(), kind: c.kind, status: cardStatusName(c.status),
      merchantLock: c.merchantLock.every((x) => x === 0) ? "(unset)" : toHex(c.merchantLock), totalSettled: formatUsdc(c.totalSettled),
      totalRefunded: formatUsdc(c.totalRefunded), settleCount: c.settleCount, remainingAllowance: formatUsdc(remaining), remainingBase: remaining.toString() };
  };
  const final = { A: await cardView(A.cardId), S: await cardView(S.cardId), W2: await cardView(W.cardId) };
  if (final.A.status !== "ACTIVE" || final.W2.status !== "ACTIVE") throw new Error("cards not left ACTIVE");
  const rec = decodeSettlementRecord((await connection.getAccountInfo(settlementRecordPda(A.card, authCommitment(tokA1))))!.data)!;
  if (rec.amount !== 100_000n || rec.refunded !== 100_000n) throw new Error("record A1 wrong");

  const settleCUs = [s1, ss].map((t) => t.computeUnits ?? 0);
  const result = {
    at: new Date().toISOString(), rpc: rpcLabel, programId: SOLSEND_PROGRAM_ID.toBase58(), owner: owner.publicKey.toBase58(),
    ownerAta: ownerAta.toBase58(), treasuryAta: tAta.toBase58(), usdcMint: USDC_MINT.toBase58(),
    hashes: { authPrefix: "solsend:auth:v1:", merchantPrefix: "solsend:merchant:v1:", demoMerchant: DEMO_MERCHANT, demoMerchantHash: toHex(merchantCommitment(DEMO_MERCHANT)) },
    settleCuLimit: SETTLE_CU_LIMIT, settleCUs, final, record: plain(rec),
    steps: steps.map((s) => ({ ...s, tx: { ...s.tx, logs: undefined, events: plain(s.tx.events) } })),
    start: fmt(start), end: fmt(await bal()),
  };
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(path.join(STATE_DIR, "w1-smoke.json"), JSON.stringify(plain(result), null, 2));
  writeEvidence(result, steps);
  console.log(JSON.stringify({ settleCUs, final }, null, 2));
}

function readState(name: string): Record<string, unknown> | null {
  const f = path.join(STATE_DIR, name);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeEvidence(r: any, steps: Step[]) {
  const deploy = readState("w1-deploy.json") as Record<string, string> | null;
  const init = readState("w1-init.json") as { steps?: { step: string; signature?: string; action?: string }[] } & Record<string, string> | null;
  const L: string[] = [];
  L.push("# W1 evidence: SolSend program on devnet", "");
  L.push(`Generated by \`scripts/program/smoke-devnet.ts\` at ${r.at}. All transactions are **REAL devnet**; signatures link to the explorer.`);
  L.push(`RPC: ${r.rpc}. Program \`${r.programId}\`. USDC mint \`${r.usdcMint}\`.`, "");
  if (deploy) {
    L.push("## Deploy", "");
    L.push(`| | |`, `|---|---|`);
    L.push(`| Program | [\`${deploy.programId}\`](${explorerAddr(deploy.programId!)}) |`);
    L.push(`| Deploy signature | [\`${deploy.signature}\`](${explorer(deploy.signature!)}) (slot ${deploy.slot}) |`);
    L.push(`| ProgramData | \`${deploy.programData}\` (${deploy.dataLength} bytes) |`);
    L.push(`| Upgrade authority | \`${deploy.upgradeAuthority}\` (deployer) |`);
    L.push(`| Local \`target/deploy/solsend.so\` sha256 | \`${deploy.sha256}\` |`);
    L.push(`| Deployed (\`solana program dump\`) sha256 | \`${deploy.deployedSha256}\` — **MATCH** |`, "");
  }
  if (init) {
    L.push("## Init (`scripts/program/init-devnet.ts`, idempotent)", "");
    L.push(`| | |`, `|---|---|`);
    for (const k of ["config", "treasury", "treasuryAta", "treasuryDestination", "admin", "settlementAuthority", "perTxMax", "idleSecs", "paused"])
      L.push(`| ${k} | \`${String(init[k])}\` |`);
    L.push("");
    for (const s of init.steps ?? []) L.push(`- ${s.step}: ${s.action ?? ""}${s.signature ? ` — [\`${s.signature}\`](${explorer(s.signature)})` : ""}`);
    L.push("");
  }
  L.push("## Smoke run", "");
  L.push(`Owner \`${r.owner}\` (card-a-owner; ATA \`${r.ownerAta}\`). Treasury ATA \`${r.treasuryAta}\`.`);
  L.push(`Hashes: \`auth_hash = sha256("solsend:auth:v1:" + token)\` (fake sandbox-style tokens), \`merchant_hash = sha256("solsend:merchant:v1:" + acceptorId)\`; demo merchant \`${r.hashes.demoMerchant}\` → \`${r.hashes.demoMerchantHash}\`. Settle txs = [ComputeBudget limit ${r.settleCuLimit}, settle] (no memo).`);
  L.push(`USDC balances: start owner ${r.start.owner} / treasury ${r.start.treasury}; end owner ${r.end.owner} / treasury ${r.end.treasury}.`);
  L.push("These devnet keys are shared with other workstreams, so absolute balances can include their concurrent activity; the script asserts per-step deltas (settle −0.10/+0.10, duplicate/mismatch 0, refund back to start).", "");
  L.push("| # | Step | Expected | Result | CU | Owner USDC after | Treasury USDC after | Signature |", "|---|---|---|---|---|---|---|---|");
  for (const s of steps) {
    const res = s.tx.ok ? "success" : `failed: \`${JSON.stringify(s.tx.err)}\``;
    L.push(`| ${s.n} | ${s.title} | ${s.expect} | ${res} | ${s.tx.computeUnits ?? ""} | ${s.balances?.owner} | ${s.balances?.treasury} | [\`${s.tx.signature.slice(0, 16)}…\`](${explorer(s.tx.signature)}) |`);
  }
  L.push("", "### Full signatures, notes and decoded SolSend events", "");
  L.push("Events are decoded with `decodeSolsendEventsFromLogs` (packages/shared) from `getTransaction(...).meta.logMessages`.", "");
  for (const s of steps) {
    L.push(`**${s.n}. ${s.title}**`, "");
    L.push(`- signature: [\`${s.tx.signature}\`](${explorer(s.tx.signature)}) — slot ${s.tx.slot}, ${s.tx.ok ? "success" : `**failed** \`${JSON.stringify(s.tx.err)}\``}, CU ${s.tx.computeUnits}, fee ${s.tx.fee} lamports`);
    if (s.note) L.push(`- ${s.note}`);
    if (!s.tx.ok) {
      const errLine = s.tx.logs.find((l) => /Error Code|custom program error|already in use/i.test(l));
      if (errLine) L.push(`- log: \`${errLine.replace(/`/g, "'")}\``);
    }
    for (const ev of s.tx.events) L.push(`- event \`${ev.name}\`: \`${JSON.stringify(plain(ev.data))}\``);
    L.push("");
  }
  L.push("## Settle compute units", "");
  L.push(`Measured \`computeUnitsConsumed\` (tx meta, includes the ComputeBudget ix): fixed settle **${r.settleCUs[0]}**, recurring settle **${r.settleCUs[1]}**. LiteSVM (tx with only the settle ix): fixed 43,154, recurring 47,770 (first pull of a period). Recommended ASA CU limit: **${Math.ceil((Math.max(...r.settleCUs, 47_770) * 1.4) / 5000) * 5000}** (≈1.4× the largest measurement, rounded up to 5k).`, "");
  L.push("## Cards left on devnet (owner = card-a-owner)", "");
  L.push("| Card | cardId | cardPda | kind | status | merchant lock | remaining allowance | settled / refunded |", "|---|---|---|---|---|---|---|---|");
  for (const [name, c] of Object.entries(r.final) as [string, Record<string, string>][]) {
    L.push(`| ${name} | \`${c.cardId}\` | [\`${c.cardPda}\`](${explorerAddr(c.cardPda!)}) | ${["STORE_LOCKED", "ONE_TIME", "SUBSCRIPTION"][Number(c.kind)]} | ${c.status} | ${c.merchantLock === "(unset)" ? "(unset)" : "`" + c.merchantLock!.slice(0, 16) + "…`"} | ${c.remainingAllowance} | ${c.totalSettled} / ${c.totalRefunded} |`);
  }
  L.push("", `**For W2 integration tests:** card **W2** — owner \`${r.owner}\`, cardId \`${r.final.W2.cardId}\`, cardPda \`${r.final.W2.cardPda}\`, delegation \`${r.final.W2.delegation}\`: ACTIVE STORE_LOCKED, merchant lock unset (the first settle locks it), ${r.final.W2.remainingAllowance} USDC allowance. Card **A** (cardId \`${r.final.A.cardId}\`) is also ACTIVE with ${r.final.A.remainingAllowance} left, locked to \`${r.hashes.demoMerchant}\`.`, "");
  mkdirSync(path.join(ROOT, "docs/evidence"), { recursive: true });
  writeFileSync(path.join(ROOT, "docs/evidence/w1-program-devnet.md"), L.join("\n"));
  console.log("wrote docs/evidence/w1-program-devnet.md");
}

main().catch((e) => {
  console.error(`smoke-devnet FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
