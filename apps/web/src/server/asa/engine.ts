// Lithic ASA hot path (CP1 F4 + lead amendments 1/3). Port of the CP0b-proven spikes/src/asa/handler.ts.
//
// The ONLY approval paths (docs/TRUST.md invariant 1):
//   1. our `settle` tx is CONFIRMED on devnet with err === null            → "settled_confirmed"
//   2. duplicate delivery and the SettlementRecord for this exact auth is
//      readable at `confirmed` with record.amount == requested amount      → "duplicate_already_settled"
//   3. $0 AUTHORIZATION (card verification), no settle                     → "zero_amount_verification"
// Everything else declines: program errors (mapped), unknown errors, the hard deadline, exceptions.
// The engine never throws and never approves after the deadline. Pure: rpc/keys/clock injected.
import "server-only";
import bs58 from "bs58";
import { ComputeBudgetProgram, Transaction, type Keypair } from "@solana/web3.js";
import { AsaRequestZ, centsToBase, ixSettle, toHex, type AsaRequest, type AsaResult } from "@solsend/shared";
import { authCommitment, merchantCommitment, merchantIdentity } from "../lib/commitments";
import { confirmSignature, rebroadcast, type Clock, type Rpc } from "../solana/rpc";
import { cardFromTags, readSettlementRecord, type CardRef } from "../solana/records";
import { verifyLithicWebhook } from "../lithic/webhook";
import { mapSettleError } from "./errors";
import { safeErr } from "../lib/safe";

/** Statuses we settle (amendment 3a). Everything else declines without a settle. */
export const SETTLE_STATUSES = new Set(["AUTHORIZATION", "FINANCIAL_AUTHORIZATION"]);
/** Measured on devnet (see docs/evidence/w2-backend.md); override with SETTLE_CU_LIMIT. */
export const DEFAULT_SETTLE_CU_LIMIT = 80_000; // Upgrade 1 (opt-level z) settle measured 53.2k–56.2k CU on devnet (w1-program-devnet.md)

export type AsaDeps = {
  rpc: Rpc;
  settler: Keypair;
  secret: string; // whsec_… (ASA)
  budgetMs: number; // hard deadline from request receipt (ASA_BUDGET_MS, < Lithic's 6 s)
  cuLimit: number;
  clock: Clock;
  blockhash: () => Promise<string>;
  /** Issuer-outage flag (cached; a DB failure is treated as OFF by the caller). */
  outage: () => Promise<boolean>;
  rebroadcastMs?: number;
  pollMs?: number;
};

export type AsaDecision = {
  result: AsaResult;
  reason: string;
  token: string;
  card: CardRef | null;
  lithicCardToken: string | null;
  amountCents: number;
  amountBase: bigint;
  authHashHex: string | null;
  merchant: { descriptor: string | null; acceptorId: string | null };
  /** Devnet signature of the settle we sent (also for declines: evidence of the failed tx). */
  signature: string | null;
  /** Wall-clock ISO time the settle was observed CONFIRMED (precedes the reply). */
  confirmedAt: string | null;
  settleSent: boolean;
  timings: { recv_to_sent_ms?: number; sent_to_confirmed_ms?: number; total_ms: number };
};

export type AsaOutcome =
  | { status: 401; body: { error: string }; reason: string; decision: null }
  | { status: 200; body: { result: AsaResult }; decision: AsaDecision; deduped: boolean; webhookId: string };

/** Replay guard (audit L2): webhook-ids seen in the last 10 min, bounded LRU. */
export const REPLAY_WINDOW_MS = 10 * 60_000;
export const REPLAY_MAX_IDS = 5_000;

/** In-flight fingerprint (audit H1): a same-token request must match EVERY field that changes the decision. */
export function requestFingerprint(req: AsaRequest): string {
  return JSON.stringify([req.status, amountCents(req), req.amounts?.cardholder?.currency ?? "", req.card.token, req.card.state ?? "", merchantIdentity(req.merchant) ?? ""]);
}

type Ctx = { signature: string | null; settleSent: boolean; card: CardRef | null; sentAt?: number; /** set synchronously when the deadline reply is taken: nothing may be SENT after it */ closed: boolean };

export function createAsaEngine(deps: AsaDeps) {
  const { clock } = deps;
  type Inflight = { p: Promise<AsaDecision>; fp: string; done: boolean };
  const inflight = new Map<string, Inflight>();
  const seenIds = new Map<string, { token: string; at: number }>(); // insertion order = LRU order

  /** true if this webhook-id was already seen in the window (and records it otherwise). */
  function seen(id: string, token: string): { token: string } | null {
    const now = clock.now();
    const hit = seenIds.get(id);
    if (hit && now - hit.at < REPLAY_WINDOW_MS) return hit;
    seenIds.delete(id);
    seenIds.set(id, { token, at: now });
    while (seenIds.size > REPLAY_MAX_IDS) seenIds.delete(seenIds.keys().next().value!);
    return null;
  }

  function base(req: Partial<AsaRequest> | null, token: string): Omit<AsaDecision, "result" | "reason" | "timings"> {
    const cents = amountCents(req);
    return {
      token, card: null, lithicCardToken: req?.card?.token ?? null, amountCents: Number.isInteger(cents) && cents >= 0 ? cents : 0, amountBase: 0n,
      authHashHex: token ? toHex(authCommitment(token)) : null,
      merchant: { descriptor: req?.merchant?.descriptor ?? null, acceptorId: req?.merchant?.acceptor_id ?? null },
      signature: null, confirmedAt: null, settleSent: false,
    };
  }

  async function decide(req: AsaRequest, t0: number, deadlineAt: number, ctx: Ctx): Promise<AsaDecision> {
    const elapsed = () => Math.round(clock.now() - t0);
    const b = base(req, req.token);
    const out = (result: AsaResult, reason: string, extra: Partial<AsaDecision> = {}): AsaDecision =>
      ({ ...b, card: ctx.card, signature: ctx.signature, settleSent: ctx.settleSent, ...extra, result, reason, timings: { total_ms: elapsed(), ...extra.timings } });

    // 2. card → Card PDA by tags, with the derivation check
    const card = cardFromTags(req.card.tags);
    if (!card) return out("UNAUTHORIZED_MERCHANT", "unmapped_card");
    ctx.card = card;
    // amendment 3d: Lithic card state present and not OPEN → decline
    if (req.card.state !== undefined && req.card.state !== "OPEN") return out("CARD_PAUSED", `lithic_card_not_open:${req.card.state.slice(0, 20)}`);
    // amendment 3a: settle only AUTHORIZATION / FINANCIAL_AUTHORIZATION
    if (!SETTLE_STATUSES.has(req.status)) return out("SUSPECTED_FRAUD", `unsupported_status:${req.status.slice(0, 40)}`);
    // amendment 3b: USD only
    const currency = req.amounts?.cardholder?.currency;
    if (currency !== undefined && currency !== "USD") return out("SUSPECTED_FRAUD", `non_usd:${currency.slice(0, 8)}`);
    const cents = amountCents(req);
    if (!Number.isInteger(cents) || cents < 0) return out("SUSPECTED_FRAUD", "invalid_amount");
    // 3. $0 card verification → approve, no settle
    if (cents === 0) return out("APPROVED", "zero_amount_verification");
    if (await deps.outage()) return out("CARD_PAUSED", "issuer_outage");
    const identity = merchantIdentity(req.merchant);
    if (!identity) return out("UNAUTHORIZED_MERCHANT", "no_merchant_identity");

    // 4. amounts + commitments
    const amountBase = centsToBase(cents);
    const authHash = authCommitment(req.token);
    b.amountBase = amountBase;

    // 5. ComputeBudget + settle; fee payer + signer = settlement authority; cached blockhash
    const tx = new Transaction({ feePayer: deps.settler.publicKey, recentBlockhash: await deps.blockhash() }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: deps.cuLimit }),
      ixSettle({ settler: deps.settler.publicKey, owner: card.owner, cardId: card.cardId, amount: amountBase, authHash, merchantHash: merchantCommitment(identity) }),
    );
    tx.sign(deps.settler);
    const raw = tx.serialize();
    const signature = bs58.encode(tx.signature!);
    const tSend = elapsed();
    // The deadline reply may already have been taken while we awaited above (cold blockhash, outage read,
    // …). Its decision says "no settle sent", so sending now would create a settle nobody watches →
    // abort. This check and the ctx assignment below run with no await in between (atomic vs the timer).
    if (ctx.closed || clock.now() >= deadlineAt) return out("INSUFFICIENT_FUNDS", "deadline_exceeded");
    ctx.signature = signature;
    ctx.settleSent = true;
    ctx.sentAt = clock.now();
    try {
      await deps.rpc.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    } catch { /* transport error: the rebroadcast loop retries the same bytes until the deadline */ }
    const tSent = elapsed();
    const stop = rebroadcast(deps.rpc, raw, deadlineAt, clock, deps.rebroadcastMs ?? 800);
    try {
      const st = await confirmSignature(deps.rpc, signature, deadlineAt, clock, deps.pollMs ?? 1000);
      const timings = { recv_to_sent_ms: tSent, sent_to_confirmed_ms: elapsed() - tSent, total_ms: elapsed() };
      if (!st) return out("INSUFFICIENT_FUNDS", "no_confirmation", { timings });
      if (st.err === null) return out("APPROVED", "settled_confirmed", { amountBase, confirmedAt: new Date(clock.now()).toISOString(), timings });
      const m = mapSettleError(st.err);
      if (!m.duplicate) return out(m.result, m.reason, { amountBase, timings });
      // 6. duplicate: approve ONLY if the record for this exact authorization is readable at confirmed
      //    AND covers exactly this amount (amendment 3c — incremental auths decline).
      while (clock.now() < deadlineAt) {
        let rec = null;
        try { rec = await readSettlementRecord(deps.rpc, card.pda, authHash); } catch { /* retry */ }
        if (rec) {
          // audit M1: approve ONLY an exact, unrefunded redelivery (a refunded record means the USDC went back).
          if (rec.amount === amountBase && rec.refunded === 0n) return out("APPROVED", "duplicate_already_settled", { amountBase, timings: { ...timings, total_ms: elapsed() } });
          return out("SUSPECTED_FRAUD", rec.amount !== amountBase ? "duplicate_amount_mismatch" : "duplicate_refunded", { amountBase, timings: { ...timings, total_ms: elapsed() } });
        }
        await clock.sleep(150);
      }
      return out("INSUFFICIENT_FUNDS", "duplicate_unconfirmed", { amountBase, timings });
    } finally {
      stop();
    }
  }

  /** Hard deadline: reply by `deadlineAt` no matter what; never approve after it; never throw. */
  async function decideWithDeadline(req: AsaRequest, t0: number): Promise<AsaDecision> {
    const ctx: Ctx = { signature: null, settleSent: false, card: null, closed: false };
    const deadlineAt = t0 + deps.budgetMs;
    const fallback = (reason: string): AsaDecision => ({
      ...base(req, req.token), card: ctx.card, signature: ctx.signature, settleSent: ctx.settleSent,
      result: "INSUFFICIENT_FUNDS", reason, timings: { total_ms: Math.round(clock.now() - t0) },
    });
    const work = decide(req, t0, deadlineAt, ctx).catch((e: unknown) => fallback(`handler_error:${safeErr(e, 80)}`));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<AsaDecision>((resolve) => {
      timer = setTimeout(() => { ctx.closed = true; resolve(fallback("deadline_exceeded")); }, Math.max(0, deadlineAt - clock.now()));
    });
    const d = await Promise.race([work, deadline]);
    clearTimeout(timer);
    ctx.closed = true; // the reply is decided: no later send, whichever side won
    // Belt and braces: an APPROVED decision that somehow resolved after the deadline is declined.
    if (d.result === "APPROVED" && clock.now() > deadlineAt + 50) return { ...fallback("deadline_exceeded"), amountBase: d.amountBase };
    return d;
  }

  return {
    /** Verify, parse, decide. `receivedAt` = clock time the request arrived (deadline origin). */
    async handle(rawBody: string, headers: Headers, receivedAt = clock.now()): Promise<AsaOutcome> {
      try {
        const v = verifyLithicWebhook(deps.secret, headers, rawBody, clock.now());
        if (!v.ok) return { status: 401, body: { error: "unauthorized" }, reason: v.reason, decision: null };
        let parsed: AsaRequest | null = null;
        try {
          const r = AsaRequestZ.safeParse(JSON.parse(rawBody));
          if (r.success) parsed = r.data;
        } catch { /* fallthrough */ }
        if (!parsed) {
          const tok = (() => { try { const t = (JSON.parse(rawBody) as { token?: unknown }).token; return typeof t === "string" ? t : ""; } catch { return ""; } })();
          const d: AsaDecision = { ...base(null, tok), result: "SUSPECTED_FRAUD", reason: "bad_request", timings: { total_ms: Math.round(clock.now() - receivedAt) } };
          return { status: 200, body: { result: d.result }, decision: d, deduped: false, webhookId: v.id };
        }
        const quick = (reason: string): AsaDecision => ({ ...base(parsed, parsed!.token), result: "SUSPECTED_FRAUD", reason, timings: { total_ms: Math.round(clock.now() - receivedAt) } });
        // audit L2: a repeated webhook-id gets the in-flight decision if the first delivery is still deciding,
        // otherwise it declines `replay` (never a second settle attempt from a replayed request).
        const replayOf = seen(v.id, parsed.token);
        if (replayOf) {
          const cur = inflight.get(replayOf.token);
          if (cur && !cur.done && replayOf.token === parsed.token) {
            const d = await cur.p;
            return { status: 200, body: { result: d.result }, decision: d, deduped: true, webhookId: v.id };
          }
          const d = quick("replay");
          return { status: 200, body: { result: d.result }, decision: d, deduped: true, webhookId: v.id };
        }
        // Same token on this instance → same decision promise, but ONLY for an identical request (audit H1):
        // a different amount/status/card/merchant under the same token declines `inflight_mismatch` and never
        // inherits a cached APPROVED. Cross-instance duplicates are still single-settled by the onchain
        // SettlementRecord + the exact-amount/unrefunded duplicate rule (invariant 2).
        const fp = requestFingerprint(parsed);
        const cur = inflight.get(parsed.token);
        if (cur) {
          if (cur.fp !== fp) {
            const d = quick("inflight_mismatch");
            return { status: 200, body: { result: d.result }, decision: d, deduped: true, webhookId: v.id };
          }
          const d = await cur.p;
          return { status: 200, body: { result: d.result }, decision: d, deduped: true, webhookId: v.id };
        }
        const entry: Inflight = { p: decideWithDeadline(parsed, receivedAt), fp, done: false };
        inflight.set(parsed.token, entry);
        const tok = parsed.token;
        void entry.p.finally(() => { entry.done = true; setTimeout(() => { if (inflight.get(tok) === entry) inflight.delete(tok); }, 60_000).unref?.(); });
        const d = await entry.p;
        return { status: 200, body: { result: d.result }, decision: d, deduped: false, webhookId: v.id };
      } catch {
        // Never throw: an unexpected failure declines (fail-closed).
        const d: AsaDecision = { ...base(null, ""), result: "SUSPECTED_FRAUD", reason: "handler_error", timings: { total_ms: Math.round(clock.now() - receivedAt) } };
        return { status: 200, body: { result: d.result }, decision: d, deduped: false, webhookId: headers.get("webhook-id") ?? "" };
      }
    },
  };
}

function amountCents(req: Partial<AsaRequest> | null): number {
  return req?.amounts?.cardholder?.amount ?? req?.amount ?? 0;
}
