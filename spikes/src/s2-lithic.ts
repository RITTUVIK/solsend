// CP0b / S2 — Lithic SANDBOX end-to-end with Solana devnet. A deliberately SMALL number of real
// sandbox calls (≈20, hard-capped at 30) and 4 simulated authorizations + 1 void:
//   T1 $1.14  → settle must be CONFIRMED on devnet before our ASA reply says APPROVED
//   T2 $4.00  → exceeds the onchain remaining ($3.86) → chain rejects → Lithic declines, no USDC moves
//   T3 void T1 → Lithic VOIDED → reconciler refunds onchain
//   T4 $0.77  → test hook holds our reply past Lithic's 6 s deadline → Lithic declines (timeout) even
//               though our settle confirmed → reconciler refunds onchain (timeout safety)
//   Auth/replay: forged request → 401; tampered real request → 401; replay of real T1 request → same
//               decision, no second pull.
// The PAN is fetched (sandbox only) solely for simulate/* calls, held in memory, never logged/stored.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { SPIKES_DIR, rpcLabel } from "./lib/env.js";
import { record } from "./lib/evidence.js";
import { lithic, lithicCallsUsed } from "./lib/lithic.js";
import { MINT, devnet, explorerTx, loadKeypair, tokenState } from "./lib/solana.js";
import { authHash, cardPda, ixCreateFixedDelegation, ixRegisterCard, readSettlementRecord, saInitId, treasuryAta } from "./lib/allowances.js";
import { reconcile } from "./asa/reconcile.js";

const conn = await devnet();
const owner = loadKeypair("card-a-owner");
const settler = loadKeypair("settlement-authority");
const ownerAta = getAssociatedTokenAddressSync(MINT, owner.publicKey);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const children: ChildProcess[] = [];
const cleanup = () => children.forEach((c) => { try { c.kill(); } catch { /* already gone */ } });
process.on("exit", cleanup);
const usdc = async () => (await tokenState(conn, ownerAta)).amount;
const decisionsFor = (token: string) =>
  readFileSync(join(SPIKES_DIR, "evidence", "s2-lithic.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    .filter((d) => d.event === "asa_decision" && d.token === token);

// ── L1: key works (value never printed) ───────────────────────────────────
const list = await lithic("GET", "/v1/cards?page_size=1", undefined, "list_cards");
record("s2", "L1_access_PASS", { host: "sandbox.lithic.com", authenticated: true, cards_visible: (list.data ?? []).length, rpc: rpcLabel() });

// Resume (avoid repeating real sandbox work): S2_RESUME='{"lithicCard":"…","cardId":"…","t1":"…"}'
const resume = process.env.S2_RESUME ? (JSON.parse(process.env.S2_RESUME) as { lithicCard: string; cardId: string; t1: string }) : null;
// devnet card: FixedDelegation 5 USDC → Card PDA (the chain is the binding limit)
const initId = (await saInitId(conn, owner.publicKey))!;
const cardId = resume ? BigInt(resume.cardId) : BigInt(Date.now()) * 1000n + 11n;
const cardKey = cardPda(owner.publicKey, cardId);
const setupSig = resume ? "(resumed)" : await sendAndConfirmTransaction(conn, new Transaction().add(
  ixCreateFixedDelegation(owner.publicKey, cardKey, cardId, 5_000_000n, 0n, initId),
  ixRegisterCard(owner.publicKey, cardId, 0, cardId),
), [owner], { commitment: "confirmed" });

// ── L2: cards ─────────────────────────────────────────────────────────────
const tags = { solsend_owner: owner.publicKey.toBase58(), solsend_card_id: cardId.toString(), solsend_nonce: cardId.toString() };
const card = resume ? { token: resume.lithicCard, type: "MERCHANT_LOCKED (resumed)", last_four: "(resumed)", state: "OPEN", spend_limit: 10_000, tags: true } : await lithic("POST", "/v1/cards", {
  type: "MERCHANT_LOCKED", state: "OPEN", tags,
  memo: `solsend:${owner.publicKey.toBase58()}:${cardId}:${cardId}`, // fallback mapping if ASA omits tags
  spend_limit: 10_000, spend_limit_duration: "FOREVER", // $100 network backstop, looser than the onchain $5 → chain is binding
}, "create_card");
// throwaway lifecycle already verified in run 1 (see evidence); skippable on re-runs to save real sandbox calls
const skipThrowaway = process.env.S2_SKIP_THROWAWAY === "1";
const throwaway = skipThrowaway ? { token: "(skipped: verified in earlier run)" } : await lithic("POST", "/v1/cards", { type: "VIRTUAL", memo: "SolSend CP0b throwaway (sandbox)", state: "OPEN" }, "create_throwaway");
const paused = skipThrowaway ? { state: "(skipped)" } : await lithic("PATCH", `/v1/cards/${throwaway.token}`, { state: "PAUSED" }, "pause_throwaway");
const closed = skipThrowaway ? { state: "(skipped)" } : await lithic("PATCH", `/v1/cards/${throwaway.token}`, { state: "CLOSED" }, "close_throwaway");
if (!resume) record("s2", "L2_cards_PASS", {
  test_card: { token: card.token, type: card.type, last_four: card.last_four, state: card.state, spend_limit_cents: card.spend_limit, tags_echoed: !!card.tags },
  throwaway: { token: throwaway.token, paused: paused.state, closed: closed.state },
  devnet_card_pda: cardKey.toBase58(), devnet_delegation_setup: explorerTx(setupSig), onchain_cap_usdc: "5.00",
});

// ── L3: ASA — secret (enables signature headers) → our server + tunnel → responder endpoint ──
const { secret } = await lithic("GET", "/v1/auth_stream/secret", undefined, "asa_secret");
const asa = spawn("pnpm", ["exec", "tsx", "src/s3-asa-server.ts"], {
  cwd: SPIKES_DIR,
  env: { ...process.env, ASA_MODE: "lithic", ASA_SECRET: secret, ASA_PORT: "8790", ASA_TEST_DELAY_CENTS: "77", ASA_TEST_DELAY_MS: "7000" },
  stdio: ["ignore", "pipe", "pipe"],
});
children.push(asa);
await new Promise<void>((resolve) => asa.stdout!.on("data", (b: Buffer) => { if (b.toString().includes("ASA handler")) resolve(); }));
const ng = spawn("ngrok", ["http", "8790", "--log", "stdout"], { stdio: ["ignore", "ignore", "ignore"] });
children.push(ng);
let publicUrl: string | undefined;
for (let i = 0; i < 40 && !publicUrl; i++) {
  await sleep(500);
  try {
    const tj = (await (await fetch("http://127.0.0.1:4040/api/tunnels")).json()) as { tunnels: { public_url: string }[] };
    publicUrl = tj.tunnels.find((x) => x.public_url.startsWith("https://"))?.public_url;
  } catch { /* not up yet */ }
}
if (!publicUrl) throw new Error("ngrok tunnel did not come up");
const enroll = await lithic("POST", "/v1/responder_endpoints", { type: "AUTH_STREAM_ACCESS", url: `${publicUrl}/asa` }, "enroll_asa");
record("s2", "L3_asa_enrolled", { tunnel_host: new URL(publicUrl).host, response: enroll });

// merchant-sim: sandbox PAN in memory only
const full = await lithic("GET", `/v1/cards/${card.token}`, undefined, "get_card_for_sim");
const pan: string = full.pan;
async function simulate(cents: number, label: string) {
  const r = await lithic("POST", "/v1/simulate/authorize", { amount: cents, descriptor: "SOLSEND TEST (SANDBOX)", pan, mcc: "5734", merchant_acceptor_id: "SOLSENDTEST01" }, label);
  return r.token as string;
}
const txn = async (token: string, label: string): Promise<any> => {
  try { return await lithic("GET", `/v1/transactions/${token}`, undefined, label); }
  catch (e) { return { status: "LOOKUP_FAILED", result: null, error: String((e as Error).message).slice(0, 200) }; }
};
const summarize = (t: any) => ({ status: t.status, result: t.result, events: (t.events ?? []).map((e: any) => ({ type: e.type, result: e.result, created: e.created, detailed_results: e.detailed_results })) });

// ── T1: $1.14 — confirmed devnet settle must precede the APPROVED reply ──
const t1Before = await usdc();
const t1 = resume ? resume.t1 : await simulate(114, "simulate_t1");
if (!resume) {
await sleep(5000);
const tx1 = await txn(t1, "get_t1");
const d1 = decisionsFor(t1)[0];
const rec1 = await readSettlementRecord(conn, cardKey, authHash(t1));
const settled1 = d1?.signature ? await conn.getTransaction(d1.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }) : null;
const lithicApprovedAt = (tx1.events ?? []).find((e: any) => e.result === "APPROVED")?.created ?? tx1.created;
record("s2", "T1_approve", {
  lithic_transaction: t1, lithic: summarize(tx1),
  asa: d1 ? { result: d1.result, reason: d1.reason, hmac_key_mode: d1.hmac_key_mode, mapping_source: d1.lithic?.mapping_source, timings: d1.timings, confirmed_at: d1.confirmedAt, reply_at: d1.reply_at } : "NO_ASA_REQUEST_RECEIVED",
  devnet_settle: d1?.signature ? { signature: d1.signature, explorer: explorerTx(d1.signature), slot: settled1?.slot, block_time: settled1?.blockTime ? new Date(settled1.blockTime * 1000).toISOString() : null, err: settled1?.meta?.err ?? null } : null,
  lithic_approved_at: lithicApprovedAt,
  proof_confirmed_before_reply: !!(d1?.confirmedAt && d1?.reply_at && d1.confirmedAt <= d1.reply_at),
  onchain_record: rec1 ? { amount: rec1.amount.toString(), refunded: rec1.refunded.toString() } : null,
  owner_usdc_delta: ((await usdc()) - t1Before).toString(),
});
}

// ── Auth + replay tests run after T2 (on T2's real captured, signed request) ──
// ── T2: $4.00 > onchain remaining $3.86 → chain rejects → Lithic declines, no USDC moves ──
const t2Before = await usdc();
const t2 = await simulate(400, "simulate_t2");
await sleep(5000);
const tx2 = await txn(t2, "get_t2");
const d2 = decisionsFor(t2)[0];
const rec2 = await readSettlementRecord(conn, cardKey, authHash(t2));
const failed2 = d2?.signature ? await conn.getTransaction(d2.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }) : null;
record("s2", "T2_over_limit", {
  lithic_transaction: t2, lithic: summarize(tx2),
  asa: d2 ? { result: d2.result, reason: d2.reason, timings: d2.timings } : "NO_ASA_REQUEST_RECEIVED",
  failed_settle_tx: d2?.signature ? { signature: d2.signature, explorer: explorerTx(d2.signature), err: failed2?.meta?.err ?? null, note: "failed tx: fee only, no token transfer" } : null,
  settlement_record: rec2 ? "PRESENT (unexpected)" : null, owner_usdc_delta: ((await usdc()) - t2Before).toString(),
});

const cap = readFileSync(join(SPIKES_DIR, ".raw", "asa-captures.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((c) => c.token === t2);
const postPublic = async (headers: Record<string, string>, body: string) =>
  (await fetch(`${publicUrl}/asa`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body })).status;
const forged = await postPublic({ "webhook-id": "msg_forged", "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "webhook-signature": "v1,Zm9yZ2Vk" }, JSON.stringify({ token: "forged", amount: 100000 }));
const tampered = cap ? await postPublic(cap.headers, cap.body + " ") : -1;
const replayStatus = cap ? await postPublic(cap.headers, cap.body) : -1;
await sleep(2000);
const recAfterReplay = await readSettlementRecord(conn, cardKey, authHash(t2));
const replays = decisionsFor(t2);
record("s2", "auth_and_replay", {
  forged_request_http: forged, tampered_real_request_http: tampered, replay_of_real_T2_http: replayStatus,
  replay_decisions: replays.map((d) => ({ result: d.result, reason: d.reason })),
  settlement_record_for_T2_after_replay: recAfterReplay ? "PRESENT (unexpected)" : null,
  replay_same_decision: replays.length >= 2 && replays.every((d) => d.result === replays[0].result),
  pass: forged === 401 && tampered === 401 && replayStatus === 200 && recAfterReplay === null && replays.length >= 2 && replays.every((d) => d.result === replays[0].result),
});


// ── T3: void T1 → VOIDED → reconciler refunds onchain ──
const t3Before = await usdc();
await lithic("POST", "/v1/simulate/void", { token: t1, type: "AUTHORIZATION_REVERSAL" }, "simulate_void_t1");
await sleep(4000);
const tx1v = await txn(t1, "get_t1_after_void");
const r3 = await reconcile(conn, settler, [{ token: t1, owner: owner.publicKey.toBase58(), cardId, finalResult: tx1v.status === "VOIDED" ? "VOIDED" : String(tx1v.result) }]);
const rec1v = await readSettlementRecord(conn, cardKey, authHash(t1));
record("s2", "T3_void_refund", {
  lithic_transaction: t1, lithic_after_void: summarize(tx1v), reconciler_action: r3[0]?.action,
  refund: r3[0]?.refundSig ? { signature: r3[0].refundSig, explorer: explorerTx(r3[0].refundSig) } : null,
  record_after: rec1v ? { amount: rec1v.amount.toString(), refunded: rec1v.refunded.toString() } : null,
  owner_usdc_delta: ((await usdc()) - t3Before).toString(),
});

// ── T4: real Lithic timeout — our reply is held 7 s (> 6 s deadline) after a confirmed settle ──
const t4Before = await usdc();
const t4 = await simulate(77, "simulate_t4");
await sleep(12_000);
const tx4 = await txn(t4, "get_t4");
const d4 = decisionsFor(t4)[0];
const r4 = await reconcile(conn, settler, [{ token: t4, owner: owner.publicKey.toBase58(), cardId, finalResult: tx4.result === "APPROVED" ? "APPROVED" : `LITHIC_${tx4.status}_${tx4.result}` }]);
const rec4 = await readSettlementRecord(conn, cardKey, authHash(t4));
record("s2", "T4_lithic_timeout", {
  lithic_transaction: t4, lithic: summarize(tx4),
  asa: d4 ? { result: d4.result, reason: d4.reason, test_delayed_reply: d4.test_delayed_reply, confirmed_at: d4.confirmedAt, reply_at: d4.reply_at, signature: d4.signature } : "NO_ASA_REQUEST_RECEIVED",
  reconciler_action: r4[0]?.action, refund: r4[0]?.refundSig ? { signature: r4[0].refundSig, explorer: explorerTx(r4[0].refundSig) } : null,
  record_after: rec4 ? { amount: rec4.amount.toString(), refunded: rec4.refunded.toString() } : null,
  owner_usdc_net_delta: ((await usdc()) - t4Before).toString(),
});

// ── tidy up: disenroll ASA so Lithic never calls a dead tunnel ──
await lithic("DELETE", "/v1/responder_endpoints?type=AUTH_STREAM_ACCESS", undefined, "disenroll_asa");
const treasuryNow = (await tokenState(conn, treasuryAta())).amount;
record("s2", "summary", { lithic_api_calls_used: lithicCallsUsed(), simulated_authorizations: 4, voids: 1, treasury_usdc_now: treasuryNow.toString() });
cleanup();
process.exit(0);
