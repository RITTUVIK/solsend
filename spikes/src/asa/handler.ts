// CP0b — Lithic Auth Stream Access (ASA) handler, spike version of the production hot path.
//
// Decision rule (requirement 4/6): reply APPROVED **only** after our policy program's `settle`
// transaction is CONFIRMED on devnet. The reply is derived solely from that onchain result:
//   confirmed ok            → APPROVED
//   program/simulation error → mapped decline (no funds moved)
//   not confirmed in budget  → decline (fail closed) + queued for reconciliation (refund if it lands)
// Duplicates (Lithic retries, concurrent deliveries) → one onchain pull, consistent reply.
import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { join } from "node:path";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, type Connection } from "@solana/web3.js";
import { SPIKES_DIR } from "../lib/env.js";
import { authHash, cardPda, ixSettle, readSettlementRecord } from "../lib/allowances.js";

export type AsaMode = "mock" | "lithic";
export type Decision = {
  result: string; // Lithic ASA `result`
  reason: string; // internal reason (logged, never sent)
  token: string;
  signature?: string;
  confirmedAt?: string; // wall-clock time the settle was observed CONFIRMED (proof: confirmation precedes the reply)
  timings: { recv_to_sent_ms?: number; sent_to_confirmed_ms?: number; total_ms: number };
};

const RECONCILE_FILE = join(SPIKES_DIR, ".raw", "reconcile-queue.jsonl");

function mapError(text: string): { result: string; reason: string } {
  // settle is instruction index 1 (index 0 = compute budget). Matches simulation logs AND confirmed-status JSON.
  if (/already in use/i.test(text) || /"Custom":0\}/.test(text)) return { result: "DUPLICATE", reason: "settlement_record_exists" };
  if (/0x12c\b|"Custom":300\}/.test(text)) return { result: "INSUFFICIENT_FUNDS", reason: "card_limit_exceeded" };
  if (/0x190\b|"Custom":400\}/.test(text)) return { result: "VELOCITY_EXCEEDED", reason: "period_limit_exceeded" };
  if (/CardNotActive|0x1772\b|"Custom":6002\}/.test(text)) return { result: "CARD_PAUSED", reason: "card_frozen" };
  if (/Invalid account owner|InvalidAccountOwner|AccountNotInitialized|"Custom":3012\}/i.test(text)) return { result: "CARD_PAUSED", reason: "delegation_revoked_or_missing" };
  if (/insufficient funds|"Custom":1\}/i.test(text)) return { result: "INSUFFICIENT_FUNDS", reason: "wallet_balance_insufficient" };
  return { result: "INSUFFICIENT_FUNDS", reason: `settle_rejected:${text.slice(0, 120)}` };
}

/** Lithic signs ASA like Events: HMAC-SHA256 over `${id}.${ts}.${rawBody}`; header `v1,<b64> v1,<b64>`.
 *  Docs say to use "the Base64 part after whsec_" as the key — we try decoded and raw and report which matched. */
export function verifyLithicSignature(secret: string, id: string, ts: string, body: string, header: string): "decoded" | "raw" | null {
  const part = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const content = `${id}.${ts}.${body}`;
  const given = header.split(" ").map((s) => s.split(",")[1]).filter(Boolean).map((b) => Buffer.from(b!, "base64"));
  for (const [label, key] of [["decoded", Buffer.from(part, "base64")], ["raw", Buffer.from(part, "utf8")]] as const) {
    const mac = createHmac("sha256", key).update(content).digest();
    if (given.some((g) => g.length === mac.length && timingSafeEqual(g, mac))) return label;
  }
  return null;
}

export function signLikeLithic(secret: string, id: string, ts: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;
}

export function createAsaHandler(opts: { conn: Connection; settler: Keypair; mode: AsaMode; secret: string; budgetMs: number; log: (d: Decision & { source: string }) => void }) {
  const { conn, settler } = opts;
  let blockhash: { value: string; at: number } | null = null;
  async function freshBlockhash() {
    if (!blockhash || Date.now() - blockhash.at > 15_000) {
      blockhash = { value: (await conn.getLatestBlockhash("confirmed")).blockhash, at: Date.now() };
    }
    return blockhash.value;
  }
  setInterval(() => { blockhash = null; void freshBlockhash().catch(() => {}); }, 15_000).unref();

  const inflight = new Map<string, Promise<Decision>>();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  type Ctx = { signature?: string; owner?: string; cardId?: string; hash?: string };
  function confirmFast(signature: string, stopAfterMs = 25_000): Promise<{ err: unknown } | null> {
    const until = Date.now() + stopAfterMs;
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: { err: unknown } | null) => { if (!done) { done = true; resolve(v); } };
      let subId: number | null = null;
      try { subId = conn.onSignature(signature, (r) => finish({ err: r.err }), "confirmed"); } catch { /* ws unavailable → polling only */ }
      const poll = async () => {
        await sleep(1000); // websocket is primary; polling is a sparse fallback (avoid RPC 429s)
        while (!done && Date.now() < until) {
          try {
            const st = (await conn.getSignatureStatuses([signature])).value[0];
            if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) finish({ err: st.err });
          } catch { /* transient RPC error: keep trying until the deadline race ends us */ }
          await sleep(1000);
        }
        finish(null);
      };
      void poll();
      const stop = setInterval(() => { if (done) { clearInterval(stop); if (subId !== null) void conn.removeSignatureListener(subId).catch(() => {}); } }, 200);
    });
  }

  async function decide(payload: any, budgetMs: number, ctx: Ctx = {}): Promise<Decision> {
    const t0 = performance.now();
    const elapsed = () => Math.round(performance.now() - t0);
    const token: string = payload.token;
    const memoParts = typeof payload.card?.memo === "string" && payload.card.memo.startsWith("solsend:") ? payload.card.memo.split(":") : [];
    const tags = payload.card?.tags && payload.card.tags.solsend_owner ? payload.card.tags
      : memoParts.length === 4 ? { solsend_owner: memoParts[1], solsend_card_id: memoParts[2], solsend_nonce: memoParts[3] } : {};
    const cents: number = payload.amounts?.cardholder?.amount ?? payload.amount ?? 0;
    if (!tags.solsend_owner || !tags.solsend_card_id || !tags.solsend_nonce) return { result: "CARD_PAUSED", reason: "unknown_card", token, timings: { total_ms: elapsed() } };
    const owner = new PublicKey(tags.solsend_owner);
    const cardId = BigInt(tags.solsend_card_id);
    const nonce = BigInt(tags.solsend_nonce);
    const hash = authHash(token);
    Object.assign(ctx, { owner: owner.toBase58(), cardId: cardId.toString(), hash: hash.toString("hex") });
    if (cents === 0) return { result: "APPROVED", reason: "zero_amount_verification", token, timings: { total_ms: elapsed() } };

    const tx = new Transaction({ feePayer: settler.publicKey, recentBlockhash: await freshBlockhash() }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 90_000 }),
      ixSettle(settler.publicKey, owner, cardId, nonce, BigInt(cents) * 10_000n, hash),
    );
    tx.sign(settler);
    const raw = tx.serialize();
    let signature: string;
    const tSend = elapsed();
    try {
      signature = await conn.sendRawTransaction(raw, { skipPreflight: process.env.ASA_PREFLIGHT !== "1", preflightCommitment: "confirmed", maxRetries: 0 });
    } catch (e) {
      const logs = ((e as { logs?: string[] }).logs ?? []).join(" ");
      const m = mapError(`${(e as Error).message} ${logs}`);
      if (m.result !== "DUPLICATE") return { ...m, token, timings: { recv_to_sent_ms: tSend, total_ms: elapsed() } };
      // Duplicate: another delivery already settled (or is settling). Approve only if the record is confirmed.
      while (elapsed() < budgetMs) {
        const rec = await readSettlementRecord(conn, cardPda(owner, cardId), hash);
        if (rec) return { result: "APPROVED", reason: "duplicate_already_settled", token, timings: { total_ms: elapsed() } };
        await sleep(150);
      }
      return { result: "INSUFFICIENT_FUNDS", reason: "duplicate_unconfirmed_within_budget", token, timings: { total_ms: elapsed() } };
    }
    const tSent = elapsed();
    ctx.signature = signature;
    const rebroadcast = setInterval(() => { if (elapsed() < budgetMs) void conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {}); }, 800);

    try {
      const st = await confirmFast(signature);
      const timings = { recv_to_sent_ms: tSent, sent_to_confirmed_ms: elapsed() - tSent, total_ms: elapsed() };
      if (!st) return { result: "INSUFFICIENT_FUNDS", reason: "no_confirmation", token, signature, timings };
      if (st.err) {
        const m = mapError(JSON.stringify(st.err));
        if (m.result === "DUPLICATE") {
          const rec = await readSettlementRecord(conn, cardPda(owner, cardId), hash);
          return rec ? { result: "APPROVED", reason: "duplicate_already_settled_onchain", token, signature, timings } : { result: "INSUFFICIENT_FUNDS", reason: "duplicate_record_missing", token, signature, timings };
        }
        return { ...m, token, signature, timings };
      }
      return { result: "APPROVED", reason: "settled_confirmed", token, signature, confirmedAt: new Date().toISOString(), timings };
    } finally {
      clearInterval(rebroadcast);
    }
  }

  /** Hard deadline: reply by `budgetMs` no matter what; never approve after it; never throw. */
  async function decideWithDeadline(payload: any, budgetMs: number): Promise<Decision> {
    const ctx: Ctx = {};
    const started = performance.now();
    const work = decide(payload, budgetMs, ctx).catch((e: Error): Decision => ({
      result: "INSUFFICIENT_FUNDS", reason: `handler_error:${e.message.slice(0, 120)}`, token: payload?.token, signature: ctx.signature,
      timings: { total_ms: Math.round(performance.now() - started) },
    }));
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<Decision>((resolve) => {
      timer = setTimeout(() => resolve({ result: "INSUFFICIENT_FUNDS", reason: "deadline_exceeded", token: payload?.token, signature: ctx.signature, timings: { total_ms: budgetMs } }), budgetMs);
    });
    const d = await Promise.race([work, deadline]);
    clearTimeout(timer);
    if (d.reason === "deadline_exceeded" || d.reason.startsWith("handler_error") || d.reason === "no_confirmation") {
      // Fail closed. If the settle lands anyway, the reconciler refunds it (S4).
      appendFileSync(RECONCILE_FILE, JSON.stringify({ at: new Date().toISOString(), token: d.token, ...ctx, decision: d.reason }) + "\n");
      void work.then((late) => { if (late.result === "APPROVED") opts.log({ ...late, reason: `LATE_${late.reason}_after_decline_needs_refund`, source: "late" }); });
    }
    return d;
  }

  async function readBody(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }

  const CAPTURE_FILE = join(SPIKES_DIR, ".raw", "asa-captures.jsonl");
  return createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/asa")) { res.writeHead(404).end(); return; }
    const body = await readBody(req);
    const id = String(req.headers["webhook-id"] ?? "");
    const ts = String(req.headers["webhook-timestamp"] ?? "");
    const sig = String(req.headers["webhook-signature"] ?? "");
    const keyMode = id && ts && sig ? verifyLithicSignature(opts.secret, id, ts, body, sig) : null;
    const stale = Math.abs(Date.now() / 1000 - Number(ts)) > 300;
    if (!keyMode || stale) {
      opts.log({ result: "HTTP_401", reason: !id || !ts || !sig ? "missing_signature_headers" : stale ? "stale_timestamp" : "bad_signature", token: "", timings: { total_ms: 0 }, source: opts.mode } as Decision & { source: string });
      res.writeHead(401).end();
      return;
    }
    const payload = JSON.parse(body);
    if (opts.mode === "lithic" && !/"pan"\s*:\s*"\d{12,19}"/.test(body)) { // ASA `pos.entry_mode.pan` is an entry-mode enum, not a card number
      // gitignored; used only to replay a real signed request in the S2 duplicate/replay test
      appendFileSync(CAPTURE_FILE, JSON.stringify({ token: payload.token, headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": sig }, body }) + "\n");
    }
    const budget = opts.mode === "mock" && req.headers["x-mock-budget-ms"] ? Number(req.headers["x-mock-budget-ms"]) : opts.budgetMs;
    // Same transaction token → same decision promise (in-process); cross-process duplicates are
    // still single-settled by the onchain SettlementRecord.
    let p = inflight.get(payload.token);
    const deduped = !!p;
    if (!p) { p = decideWithDeadline(payload, budget); inflight.set(payload.token, p); }
    const d = await p;
    const cents = payload.amounts?.cardholder?.amount ?? payload.amount ?? 0;
    // TEST-ONLY hook (off unless ASA_TEST_DELAY_CENTS is set): hold the reply past Lithic's 6 s deadline
    // for one specific amount, to verify that a settle confirmed onchain but never acknowledged is refunded.
    const delayCents = process.env.ASA_TEST_DELAY_CENTS ? Number(process.env.ASA_TEST_DELAY_CENTS) : null;
    const testDelayed = delayCents !== null && cents === delayCents && !deduped;
    if (testDelayed) await new Promise((r) => setTimeout(r, Number(process.env.ASA_TEST_DELAY_MS ?? 7000)));
    const replyAt = new Date().toISOString();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ result: d.result === "DUPLICATE" ? "INSUFFICIENT_FUNDS" : d.result }));
    opts.log({
      ...d, source: opts.mode === "mock" ? "mock-lithic-local" : "lithic-sandbox",
      ...(deduped ? { reason: `${d.reason}+inflight_dedupe` } : {}),
      ...({ hmac_key_mode: keyMode, reply_at: replyAt, test_delayed_reply: testDelayed,
        lithic: { card_token: payload.card?.token, card_type: payload.card?.type, amount_cents: cents, status: payload.status,
          merchant: { descriptor: payload.merchant?.descriptor, acceptor_id: payload.merchant?.acceptor_id, mcc: payload.merchant?.mcc },
          mapping_source: payload.card?.tags?.solsend_owner ? "tags" : "memo" } } as object),
    });
  });
}
