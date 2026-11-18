// Lithic SANDBOX client (server). Guards ported from CP0b spikes/src/lib/lithic.ts:
//  - sandbox host only (refuses anything else, including api.lithic.com)
//  - write pacing (sandbox ≈ 2 RPS card writes, ≈ 1 RPS simulate)
//  - responses are reduced to the fields we need: PAN/CVV from sandbox card responses are dropped
//    immediately and never logged, stored, returned or put into an error message.
import "server-only";
import { createHmac } from "node:crypto";
import { LithicTransactionZ, type LithicTransaction } from "@solsend/shared";
import { LITHIC_BASE } from "../env";

export class LithicError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) { super(message); }
}

export type CardKindName = "STORE_LOCKED" | "ONE_TIME" | "SUBSCRIPTION";

/** MIRROR of the lead's `lithicCardConfig(kind, limitCents)` (shared lithic.ts, amendment 4): outer circuit
 *  breaker = 2× the onchain limit. The chain stays authoritative. Never MERCHANT_LOCKED. */
export function lithicCardConfig(kind: CardKindName, limitCents: number) {
  const spend_limit = 2 * limitCents;
  switch (kind) {
    case "STORE_LOCKED": return { type: "VIRTUAL", spend_limit, spend_limit_duration: "FOREVER" } as const;
    case "ONE_TIME": return { type: "SINGLE_USE", spend_limit, spend_limit_duration: "TRANSACTION" } as const;
    case "SUBSCRIPTION": return { type: "VIRTUAL", spend_limit, spend_limit_duration: "MONTHLY" } as const;
  }
}

export type IssuedCard = { token: string; lastFour: string | null; state: string | null };
/** `session` (modern flow only) is the raw single-use embed session for the browser SDK — a bearer capability: never log it. */
export type EmbedSession = { iframeUrl: string; iframes: { pan: string; cvv: string; expMonth: string; expYear: string }; expiresAt: string; flow: "session" | "legacy_hmac"; session?: string };

export interface LithicApi {
  createCard(p: { kind: CardKindName; limitCents: number; memo: string; tags: Record<string, string> }): Promise<IssuedCard>;
  setCardState(cardToken: string, state: "OPEN" | "PAUSED" | "CLOSED"): Promise<void>;
  /** null when Lithic has no such transaction (404). */
  getTransaction(token: string): Promise<LithicTransaction | null>;
  createEmbed(cardToken: string, opts: { targetOrigin: string | null; ttlSecs: number; nowMs: number }): Promise<EmbedSession>;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class LithicClient implements LithicApi {
  private lastWrite = 0;
  constructor(private apiKey: string, private opts: { base?: string; fetch?: FetchLike; writeGapMs?: number } = {}) {
    if ((opts.base ?? LITHIC_BASE) !== "https://sandbox.lithic.com") throw new Error("refusing non-sandbox Lithic host");
  }
  private get base() { return this.opts.base ?? LITHIC_BASE; }

  private async call(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    if (method !== "GET") {
      const wait = this.lastWrite + (this.opts.writeGapMs ?? 550) - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastWrite = Date.now();
    }
    const res = await (this.opts.fetch ?? fetch)(`${this.base}${path}`, {
      method, cache: "no-store",
      headers: { Authorization: this.apiKey, "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { /* non-JSON error page */ }
    return { status: res.status, json };
  }

  private fail(what: string, r: { status: number; json: Record<string, unknown> }): never {
    // Only Lithic's short error message is kept (never the body: sandbox card bodies contain the PAN).
    const msg = typeof r.json.message === "string" ? r.json.message.slice(0, 160) : "";
    throw new LithicError(r.status, typeof r.json.code === "string" ? r.json.code : null, `lithic ${what} HTTP ${r.status}${msg ? `: ${msg}` : ""}`);
  }

  async createCard(p: { kind: CardKindName; limitCents: number; memo: string; tags: Record<string, string> }): Promise<IssuedCard> {
    const r = await this.call("POST", "/v1/cards", { ...lithicCardConfig(p.kind, p.limitCents), memo: p.memo.slice(0, 120), tags: p.tags });
    if (r.status >= 300) this.fail("create card", r);
    const token = r.json.token;
    if (typeof token !== "string") this.fail("create card (no token)", r);
    return { token, lastFour: typeof r.json.last_four === "string" ? r.json.last_four : null, state: typeof r.json.state === "string" ? r.json.state : null };
  }

  async setCardState(cardToken: string, state: "OPEN" | "PAUSED" | "CLOSED") {
    const r = await this.call("PATCH", `/v1/cards/${encodeURIComponent(cardToken)}`, { state });
    if (r.status >= 300) this.fail("update card", r);
  }

  async getTransaction(token: string): Promise<LithicTransaction | null> {
    const r = await this.call("GET", `/v1/transactions/${encodeURIComponent(token)}`);
    if (r.status === 404) return null;
    if (r.status >= 300) this.fail("get transaction", r);
    const p = LithicTransactionZ.safeParse(r.json);
    if (!p.success) throw new LithicError(r.status, null, "lithic transaction: unexpected shape");
    return p.data;
  }

  /** Hosted card iframe. PAN/CVV are rendered by Lithic in the browser and never touch our server:
   *  modern flow `POST /v1/cards/{t}/embed` → session → `GET /v1/embed?session=&type=PAN|CVV|EXP_MONTH|EXP_YEAR`.
   *  Falls back to the deprecated (still supported) `GET /v1/embed/card?embed_request=&hmac=` only if the
   *  session endpoint is unavailable in sandbox. */
  async createEmbed(cardToken: string, opts: { targetOrigin: string | null; ttlSecs: number; nowMs: number }): Promise<EmbedSession> {
    const ttl = Math.min(Math.max(opts.ttlSecs, 30), 600);
    const expSecs = Math.floor(opts.nowMs / 1000) + ttl;
    const expiresAt = new Date(expSecs * 1000).toISOString();
    const r = await this.call("POST", `/v1/cards/${encodeURIComponent(cardToken)}/embed`, {
      type: "CARD_EMBED", expiration: expSecs, ...(opts.targetOrigin ? { target_origin: opts.targetOrigin } : {}),
    });
    if (r.status < 300 && typeof r.json.session === "string") {
      const u = (type: string) => `${this.base}/v1/embed?session=${encodeURIComponent(r.json.session as string)}&type=${type}`;
      const iframes = { pan: u("PAN"), cvv: u("CVV"), expMonth: u("EXP_MONTH"), expYear: u("EXP_YEAR") };
      return { iframeUrl: iframes.pan, iframes, expiresAt, flow: "session", session: r.json.session as string };
    }
    if (r.status !== 404 && r.status !== 405) this.fail("create embed session", r);
    const legacy = legacyEmbedUrl(this.base, this.apiKey, { token: cardToken, expiration: expiresAt, targetOrigin: opts.targetOrigin });
    return { iframeUrl: legacy, iframes: { pan: legacy, cvv: legacy, expMonth: legacy, expYear: legacy }, expiresAt, flow: "legacy_hmac" };
  }
}

/** Deprecated Lithic embed: base64(JSON with sorted keys, no whitespace) + base64 HMAC-SHA256(apiKey, JSON). */
export function legacyEmbedUrl(base: string, apiKey: string, p: { token: string; expiration: string; targetOrigin: string | null }): string {
  const obj: Record<string, string> = { expiration: p.expiration, ...(p.targetOrigin ? { target_origin: p.targetOrigin } : {}), token: p.token };
  const json = JSON.stringify(Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))));
  const embedRequest = Buffer.from(json, "utf8").toString("base64");
  const hmac = createHmac("sha256", apiKey).update(json).digest("base64");
  return `${base}/v1/embed/card?embed_request=${encodeURIComponent(embedRequest)}&hmac=${encodeURIComponent(hmac)}`;
}
