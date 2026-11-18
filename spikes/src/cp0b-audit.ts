// CP0b audit — (1) reconstruct the T1/T4 approval timelines from handler logs + chain and verify
// the APPROVED reply followed `confirmed` commitment; (2) verify refund destinations from token
// balance deltas; (3) verify idempotency onchain (record PDAs, tx counts) and via SIMULATION ONLY
// (duplicate settle / over-refund — nothing lands). No Lithic calls.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { SPIKES_DIR } from "./lib/env.js";
import { record } from "./lib/evidence.js";
import { MINT, describeUsdcTx, devnet, loadKeypair } from "./lib/solana.js";
import { POLICY, authHash, cardPda, ixRefund, ixSettle, settleRecordPda, treasuryAta } from "./lib/allowances.js";

const conn = await devnet();
const owner = loadKeypair("card-a-owner");
const settler = loadKeypair("settlement-authority");
const ownerAta = getAssociatedTokenAddressSync(MINT, owner.publicKey).toBase58();
const treasury = treasuryAta().toBase58();
const jsonl = (f: string) => readFileSync(join(SPIKES_DIR, "evidence", f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Public devnet RPC rate-limits bursts (429): retry with exponential backoff. */
async function rpc<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= 6 || !/429|Too Many/i.test(String((e as Error).message))) throw e;
      await sleep(1000 * 2 ** i);
    }
  }
}

const S2_CARD_ID = 1794973227631011n;
const T1 = "934ca60c-f410-47e7-ac06-41f9994d9e4b";
const T2 = "0b03af07-2a90-447d-adf0-c7df3c493f07";
const T4 = "275bb4c5-270e-4087-91e0-5f25ab9fec23";

// ── (1) timelines ───────────────────────────────────────────────────────────
const lithicDecisions = jsonl("s2-lithic.jsonl").filter((d) => d.event === "asa_decision" && d.source === "lithic-sandbox");
const handlerSrc = readFileSync(join(SPIKES_DIR, "src", "asa", "handler.ts"), "utf8");
const approvedPaths = [...handlerSrc.matchAll(/result: "APPROVED", reason: "([a-z_]+)"/g)].map((m) => m[1]);
for (const [name, token] of (process.env.AUDIT_SKIP_TIMELINE === "1" ? [] : [["T1", T1], ["T4", T4]]) as [string, string][]) {
  const d = lithicDecisions.find((x) => x.token === token && !String(x.reason).includes("inflight_dedupe"));
  const confirmedAt = Date.parse(d.confirmedAt);
  const replyAt = Date.parse(d.reply_at);
  const arrival = confirmedAt - d.timings.total_ms;
  const submitted = arrival + d.timings.recv_to_sent_ms;
  const confirmedObserved = submitted + d.timings.sent_to_confirmed_ms;
  const tx = await conn.getTransaction(d.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const blockTimeMs = (tx?.blockTime ?? 0) * 1000;
  record("audit", `timeline_${name}`, {
    lithic_transaction: token, reason: d.reason, settle_signature: d.signature, slot: tx?.slot ?? null,
    timeline_utc: {
      asa_request_received: new Date(arrival).toISOString(),
      settle_tx_submitted: new Date(submitted).toISOString(),
      settle_block_time_1s_granularity: new Date(blockTimeMs).toISOString(),
      confirmed_commitment_observed: d.confirmedAt,
      approved_reply_written: d.reply_at,
    },
    measurement_points: {
      recv_to_sent_ms: `${d.timings.recv_to_sent_ms} = ASA request received → settle TRANSACTION submitted to RPC (not the approval)`,
      sent_to_confirmed_ms: `${d.timings.sent_to_confirmed_ms} = settle submitted → RPC reports 'confirmed' commitment`,
      total_ms: `${d.timings.total_ms} = ASA request received → decision made (after confirmation)`,
      reply_after_confirmation_ms: replyAt - confirmedAt,
    },
    checks: {
      arithmetic_consistent: Math.abs(confirmedObserved - confirmedAt) <= 2,
      reply_after_confirmed: replyAt >= confirmedAt,
      block_time_not_after_confirmation: blockTimeMs <= confirmedAt,
      decision_via_confirmed_path: d.reason === "settled_confirmed",
      tx_succeeded_onchain: tx?.meta?.err === null,
    },
  });
}
if (process.env.AUDIT_SKIP_TIMELINE !== "1") record("audit", "approval_code_paths", {
  file: "spikes/src/asa/handler.ts", approved_reasons: approvedPaths,
  meaning: {
    settled_confirmed: "returned only after confirmFast() resolved from onSignature(sig, 'confirmed') or getSignatureStatuses confirmationStatus ∈ {confirmed, finalized} with err === null",
    duplicate_already_settled: "duplicate delivery: SettlementRecord account read at 'confirmed' commitment exists → the settle that created it is confirmed",
    duplicate_already_settled_onchain: "our tx failed with Custom(0) (record already exists); approve only if the record is readable at 'confirmed'",
    zero_amount_verification: "$0 verification auth: approves no spend; no funds move",
  },
});

// ── (2) refund destinations ─────────────────────────────────────────────────
const refundSigs = {
  T3_void_refund: "52VT6frYekNhFqNFSpnuxncw8kuse2sJR4YTFrQvFxWVHHGaW8EcHmmqz13Uyu7HDPZuFADaxPsZzKwo3DRBhBts",
  T4_timeout_refund: "BF3DfuUThqDP7oJ35dJbDgEY4pYA2nqZcQyTGRGB6vuX7aYAksnU8RAsZuawRm8vUtuakYnzVYU7qqpQ5Y7HSpQ",
  S4_timeout_refund: "5KgRdKvRfHbPr5LEaFDqJUsLUUfbVrxEJRBLMHQ68jZj61LefyfTyEnioynRMTHrrbgEgCBqrfKTerPeiyhs5XW2",
};
const cardAcc = await rpc(() => conn.getAccountInfo(cardPda(owner.publicKey, S2_CARD_ID), "confirmed"));
const storedSource = cardAcc ? new PublicKey(cardAcc.data.subarray(90, 122)).toBase58() : null; // disc8 owner32 id8 kind1 status1 delegation32 nonce8
const refunds: Record<string, unknown> = {};
for (const [k, sig] of Object.entries(refundSigs)) {
  const t = await rpc(() => describeUsdcTx(conn, sig));
  const changed = t.usdcDeltas.filter((x) => x.delta !== "0");
  refunds[k] = {
    signature: sig, success: t.success, usdc_deltas: changed,
    only_treasury_to_owner: changed.length === 2 && changed.some((x) => x.tokenAccount === treasury && BigInt(x.delta) < 0n)
      && changed.some((x) => x.tokenAccount === ownerAta && BigInt(x.delta) > 0n) && changed.reduce((a, x) => a + BigInt(x.delta), 0n) === 0n,
  };
  await sleep(300);
}
record("audit", "refund_destinations", {
  owner_usdc_ata: ownerAta, treasury_ata: treasury, s2_card_stored_source_token_account: storedSource,
  stored_source_is_owner_ata: storedSource === ownerAta, refunds,
});

// ── (3) idempotency ─────────────────────────────────────────────────────────
async function recordHistory(card: PublicKey, token: string) {
  const pda = settleRecordPda(card, authHash(token));
  const acc = await rpc(() => conn.getAccountInfo(pda, "confirmed"));
  const sigs = await rpc(() => conn.getSignaturesForAddress(pda, { limit: 50 }, "confirmed"));
  const kinds: string[] = [];
  for (const s of sigs) {
    const tx = await rpc(() => conn.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }));
    const logs = tx?.meta?.logMessages ?? [];
    kinds.push(`${s.err ? "FAILED" : "ok"}:${logs.some((l) => l.includes("Instruction: Settle")) ? "settle" : logs.some((l) => l.includes("Instruction: Refund")) ? "refund" : "other"}`);
    await sleep(500);
  }
  return {
    record_pda: pda.toBase58(), exists: !!acc,
    amount: acc ? acc.data.readBigUInt64LE(72).toString() : null, refunded: acc ? acc.data.readBigUInt64LE(80).toString() : null,
    successful_settles: kinds.filter((k) => k === "ok:settle").length, successful_refunds: kinds.filter((k) => k === "ok:refund").length,
    failed_txs: kinds.filter((k) => k.startsWith("FAILED")).length, history: kinds,
  };
}
const s2Card = cardPda(owner.publicKey, S2_CARD_ID);
const idem: Record<string, unknown> = {
  T1_approved_then_voided: await recordHistory(s2Card, T1),
  T2_declined_and_replayed: await recordHistory(s2Card, T2),
  T4_timeout_refunded: await recordHistory(s2Card, T4),
};
// S4 duplicate pairs (mock callbacks): locate each token's card from its settle transaction
const s4 = jsonl("s4.jsonl").filter((e) => e.event === "duplicates_consistent_PASS").at(-1);
const mockDecisions = jsonl("s3-mock.jsonl").filter((d) => d.event === "asa_decision");
for (const pair of s4?.pairs ?? []) {
  const sig = mockDecisions.find((d) => d.token === pair.token && d.signature)?.signature;
  if (!sig) { idem[`S4_${pair.path}_${pair.token.slice(0, 8)}`] = { note: "no settle signature logged" }; continue; }
  const tx = await rpc(() => conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }));
  const keys = tx!.transaction.message.getAccountKeys().staticAccountKeys;
  const ix = tx!.transaction.message.compiledInstructions.find((i) => keys[i.programIdIndex]!.equals(POLICY))!;
  const card = keys[ix.accountKeyIndexes[2]!]!;
  idem[`S4_${pair.path}_${pair.token.slice(0, 8)}`] = { replies: pair.replies, ...(await recordHistory(card, pair.token)) };
}
// Simulation-only re-checks on T1 (nothing lands): duplicate settle and over-refund must fail.
async function simulate(label: string, ix: ReturnType<typeof ixSettle>) {
  const { blockhash } = await rpc(() => conn.getLatestBlockhash("confirmed"));
  const tx = new Transaction({ feePayer: settler.publicKey, recentBlockhash: blockhash }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 90_000 }), ix);
  tx.sign(settler);
  const r = await rpc(() => conn.simulateTransaction(tx));
  return { label, err: r.value.err, decisive_log: (r.value.logs ?? []).filter((l) => /already in use|Error Code|failed/.test(l)).slice(-2) };
}
const sims = [
  await simulate("duplicate settle of T1", ixSettle(settler.publicKey, owner.publicKey, S2_CARD_ID, S2_CARD_ID, 1_140_000n, authHash(T1))),
  await simulate("over-refund of T1 (+1 base unit)", ixRefund(settler.publicKey, owner.publicKey, S2_CARD_ID, 1n, authHash(T1))),
];
record("audit", "idempotency", { records: idem, simulation_only_rechecks: sims });
process.exit(0);
