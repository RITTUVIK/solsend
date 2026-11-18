// CP0b — S3 latency + S4 safety, driven by a LOCAL MOCK of Lithic's ASA callbacks.
// Label: callbacks = "mock-lithic-local" (Lithic-shaped payload, Lithic-style HMAC signing);
//        settles  = REAL Solana devnet transactions through the Allowances program.
// Per Lithic's sandbox policy, scale tests never hit Lithic; only a handful of real sandbox
// authorizations are used separately for end-to-end verification (S2).
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Transaction, sendAndConfirmTransaction, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { SPIKES_DIR, optEnv, rpcLabel } from "./lib/env.js";
import { record } from "./lib/evidence.js";
import { MINT, devnet, explorerTx, loadKeypair, tokenState } from "./lib/solana.js";
import {
  readSettlementRecords, authHash, cardPda, delegationPda, ixCreateFixedDelegation, ixFreeze, ixRefund, ixRegisterCard, ixRevokeDelegation,
  readSettlementRecord, saInitId, subscriptionAuthority, treasuryAta,
} from "./lib/allowances.js";
import { signLikeLithic } from "./asa/handler.js";
import { reconcile, type FinalDecision } from "./asa/reconcile.js";

const conn = await devnet();
const owner = loadKeypair("card-a-owner");
const settler = loadKeypair("settlement-authority");
const ownerAta = getAssociatedTokenAddressSync(MINT, owner.publicKey);
const secret = "whsec_" + randomBytes(24).toString("base64");
const N = Number(optEnv("S3_N") ?? 50);
const CENT = 10_000n; // 1 US cent in USDC base units (6 decimals)

function startServer(port: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const p = spawn("pnpm", ["exec", "tsx", "src/s3-asa-server.ts"], {
      cwd: SPIKES_DIR, env: { ...process.env, ASA_MODE: "mock", ASA_SECRET: secret, ASA_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => reject(new Error("server start timeout")), 20_000);
    p.stdout!.on("data", (b: Buffer) => { if (b.toString().includes("ASA handler")) { clearTimeout(timer); resolve(p); } });
  });
}

const tx = (ixs: TransactionInstruction[]) => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [owner], { commitment: "confirmed" });

async function newCard(capBase: bigint) {
  const initId = (await saInitId(conn, owner.publicKey))!;
  const cardId = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  const card = cardPda(owner.publicKey, cardId);
  const sig = await tx([ixCreateFixedDelegation(owner.publicKey, card, cardId, capBase, 0n, initId), ixRegisterCard(owner.publicKey, cardId, 0, cardId)]);
  return { cardId, nonce: cardId, card, setupSig: sig };
}

function payload(c: { cardId: bigint; nonce: bigint }, cents: number) {
  return {
    token: randomUUID(), status: "AUTHORIZATION", created: new Date().toISOString(), amount: cents,
    card: { token: randomUUID(), last_four: "0000", state: "OPEN", type: "MERCHANT_LOCKED",
      tags: { solsend_owner: owner.publicKey.toBase58(), solsend_card_id: c.cardId.toString(), solsend_nonce: c.nonce.toString() } },
    merchant: { descriptor: "SOLSEND MOCK MERCHANT (sandbox)", mcc: "5734", acceptor_id: "MOCK-ACCEPTOR-1", city: "Halifax", state: "NS", country: "CAN" },
    amounts: { cardholder: { amount: cents, currency: "USD" }, hold: { amount: cents, currency: "USD" }, merchant: { amount: cents, currency: "USD" }, settlement: { amount: cents, currency: "USD" } },
  };
}

async function post(port: number, p: unknown, extra: Record<string, string> = {}, badSig = false) {
  const body = JSON.stringify(p);
  const id = `msg_${randomUUID()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = badSig ? "v1,AAAA" : signLikeLithic(secret, id, ts, body);
  const t0 = performance.now();
  const res = await fetch(`http://127.0.0.1:${port}/asa`, { method: "POST", headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": sig, ...extra }, body });
  const ms = Math.round(performance.now() - t0);
  const result = res.status === 200 ? ((await res.json()) as { result: string }).result : `HTTP_${res.status}`;
  return { result, ms };
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const usdc = async () => (await tokenState(conn, ownerAta)).amount;
const treas = async () => (await tokenState(conn, treasuryAta())).amount;

const PACE_MS = Number(optEnv("S3_PACE_MS") ?? 400); // swipes aren't back-to-back; also keeps the public RPC under its rate limit
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const finals: FinalDecision[] = [];
const fd = (c: { cardId: bigint }, token: string, finalResult: string): FinalDecision => ({ token, owner: owner.publicKey.toBase58(), cardId: c.cardId, finalResult });

const A = await startServer(8791);
const B = await startServer(8792);
try {
  const main = await newCard(2_000_000n); // 2 USDC cap
  const bad = await post(8791, payload(main, 1), {}, true);
  record("s4", bad.result === "HTTP_401" ? "bad_signature_rejected_PASS" : "bad_signature_FAIL", { http: bad.result });

  // ── S3 latency: N sequential 1-cent authorizations (mock callbacks → real devnet settles) ──
  const lat: number[] = [];
  const results: Record<string, number> = {};
  const s3Tokens: string[] = [];
  const runLatency = process.env.S3_SKIP_LATENCY !== "1";
  for (let i = 0; runLatency && i < N; i++) {
    const p = payload(main, 1);
    const r = await post(8791, p);
    lat.push(r.ms);
    results[r.result] = (results[r.result] ?? 0) + 1;
    s3Tokens.push(p.token);
    finals.push(fd(main, p.token, r.result));
    await sleep(PACE_MS);
  }
  if (runLatency) {
  const s3 = { p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: Math.max(...lat), min: Math.min(...lat) };
  record("s3", (s3.p95 ?? 1e9) <= 2500 && (s3.p99 ?? 1e9) <= 4000 && (results.APPROVED ?? 0) === N ? "latency_PASS" : "latency_FAIL", {
    label: "mock-lithic-local callbacks → REAL devnet confirmed settles", rpc: rpcLabel(),
    n: N, pace_ms: PACE_MS, budget_ms: 2500, decisions: results, request_to_reply_ms: s3, thresholds: { p95_ms: 2500, p99_ms: 4000 },
  });
  }

  // ── S4 duplicates: same token delivered twice concurrently (same process / across two processes) ──
  const dupPairs: { token: string; replies: string[]; path: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const p = payload(main, 1);
    const [r1, r2] = await Promise.all([post(8791, p), post(i % 2 === 0 ? 8791 : 8792, p)]);
    dupPairs.push({ token: p.token, replies: [r1.result, r2.result], path: i % 2 === 0 ? "same-process" : "cross-process" });
    finals.push(fd(main, p.token, r2.result)); // Lithic acts on the final delivery attempt
    await sleep(PACE_MS);
  }

  // ── S4 timeout: budget forced to 1 ms → fail-closed decline; settle may still land → reconciler refunds ──
  const tp = payload(main, 1);
  const tr = await post(8791, tp, { "x-mock-budget-ms": "1" });
  finals.push(fd(main, tp.token, tr.result));

  // ── S4 declines: over-cap, frozen, externally revoked ──
  const small = await newCard(50_000n); // 5 cents
  const op = payload(small, 6);
  const over = await post(8791, op);
  finals.push(fd(small, op.token, over.result));
  const frozen = await newCard(1_000_000n);
  await tx([ixFreeze(owner.publicKey, frozen.cardId)]);
  const fp = payload(frozen, 1);
  const fr = await post(8791, fp);
  finals.push(fd(frozen, fp.token, fr.result));
  const revoked = await newCard(1_000_000n);
  await tx([ixRevokeDelegation(owner.publicKey, delegationPda(subscriptionAuthority(owner.publicKey), owner.publicKey, revoked.card, revoked.nonce))]);
  const rp = payload(revoked, 1);
  const rv = await post(8791, rp);
  finals.push(fd(revoked, rp.token, rv.result));

  // ── quiesce, then reconcile every authorization against its onchain record ──
  await sleep(15_000);
  const rec = await reconcile(conn, settler, finals);
  const byToken = new Map(rec.map((r) => [r.token, r]));
  const anomalies = rec.filter((r) => r.action.startsWith("ANOMALY"));
  const refunded = rec.filter((r) => r.action === "refunded");
  // invariant per authorization: net moved (amount - refunded, after reconciliation) == (final APPROVED ? amount : 0)
  const afterRecs = await readSettlementRecords(conn, finals.map((f) => ({ card: cardPda(owner.publicKey, f.cardId), hash: authHash(f.token) })));
  const after = finals.map((f, i) => ({ f, r: afterRecs[i] ?? null }));
  const violations = after.filter(({ f, r }) => {
    const net = r ? r.amount - r.refunded : 0n;
    return f.finalResult === "APPROVED" ? net !== CENT && net !== 6n * CENT : net !== 0n;
  });
  record("s4", violations.length === 0 && anomalies.length === 0 ? "reconciliation_invariant_PASS" : "reconciliation_invariant_FAIL", {
    authorizations: finals.length, approved: finals.filter((f) => f.finalResult === "APPROVED").length,
    late_settles_refunded: refunded.length, refund_signatures: refunded.map((r) => r.refundSig), anomalies: anomalies.length,
    violations: violations.map(({ f, r }) => ({ token: f.token, final: f.finalResult, record: r ? { amount: r.amount.toString(), refunded: r.refunded.toString() } : null })),
  });
  record("s4", dupPairs.every((d) => d.replies[0] === d.replies[1]) ? "duplicates_consistent_PASS" : "duplicates_consistent_FAIL", {
    pairs: dupPairs.map((d) => ({ ...d, onchain: byToken.get(d.token)?.record ?? null })),
    note: "one SettlementRecord per token; a declined final decision with a landed settle is refunded by the reconciler",
  });
  const tRec = byToken.get(tp.token);
  record("s4", tr.result !== "APPROVED" ? "timeout_failclosed_PASS" : "timeout_failclosed_FAIL", {
    reply: tr.result, settle_landed_late: tRec?.record !== null, reconciler_action: tRec?.action, refund_signature: tRec?.refundSig ?? null,
  });
  const noRecord = (t: string) => byToken.get(t)?.record === null;
  record("s4", over.result === "INSUFFICIENT_FUNDS" && fr.result === "CARD_PAUSED" && rv.result === "CARD_PAUSED" && noRecord(op.token) && noRecord(fp.token) && noRecord(rp.token) ? "declines_PASS" : "declines_FAIL", {
    over_cap: over.result, frozen: fr.result, externally_revoked: rv.result, no_settlement_records: [noRecord(op.token), noRecord(fp.token), noRecord(rp.token)],
  });
} finally {
  A.kill();
  B.kill();
}
