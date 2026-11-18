// LEAD-OWNED CONTRACT. Persistence interface used by every API route (W2 + W4).
// SupabaseStore in production; MemoryStore ONLY for local dev/tests when SUPABASE_URL is unset
// (refused on Vercel). Correctness invariants never depend on this store (see docs/TRUST.md).
import "server-only";
import type { AuthorizationRow, CardRow, FeedEventRow, TxIntentRow, UserRow, WebhookReceiptRow } from "@solsend/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type Patch<T> = Partial<Omit<T, "created_at">>;
export type FeedQuery = { ownerWallet?: string; cardPda?: string; since?: string; limit?: number };
export type NewFeedEvent = Omit<FeedEventRow, "id" | "at"> & { at?: string };

export interface Store {
  readonly kind: "supabase" | "memory";
  upsertUser(privyUserId: string, wallet: string): Promise<UserRow>;
  getUserByPrivyId(privyUserId: string): Promise<UserRow | null>;

  insertCard(row: Omit<CardRow, "created_at" | "updated_at">): Promise<void>;
  getCard(cardPda: string): Promise<CardRow | null>;
  getCardByLithicToken(lithicCardToken: string): Promise<CardRow | null>;
  listCards(ownerWallet: string): Promise<CardRow[]>;
  /** Conditional update (compare-and-set on issue_state when `expectState` given). Returns true if a row changed. */
  updateCard(cardPda: string, patch: Patch<CardRow>, expectState?: CardRow["issue_state"]): Promise<boolean>;

  insertIntent(row: Omit<TxIntentRow, "id" | "created_at" | "consumed_at" | "signature">): Promise<TxIntentRow>;
  getIntent(id: string): Promise<TxIntentRow | null>;
  /** Atomically marks an unexpired, unconsumed intent consumed. Returns false if already consumed/expired. */
  consumeIntent(id: string): Promise<boolean>;
  setIntentSignature(id: string, signature: string): Promise<void>;

  upsertAuthorization(row: Partial<AuthorizationRow> & Pick<AuthorizationRow, "lithic_token">): Promise<void>;
  getAuthorization(lithicToken: string): Promise<AuthorizationRow | null>;
  /** Lookup by onchain commitment (hex of authCommitment(token)) — joins QuickNode events to Lithic authorizations. */
  getAuthorizationByAuthHash(authHashHex: string): Promise<AuthorizationRow | null>;
  listUnreconciled(olderThanSecs: number, limit: number): Promise<AuthorizationRow[]>;

  /** Idempotent: returns false if an identical (signature, kind, card_pda, lithic_token) row exists. */
  insertFeedEvent(ev: NewFeedEvent): Promise<boolean>;
  listFeed(q: FeedQuery): Promise<FeedEventRow[]>;

  /** Replay guard: true if this receipt id is new for the provider. */
  recordReceipt(provider: WebhookReceiptRow["provider"], receiptId: string): Promise<boolean>;
  getSetting(key: "issuer_outage"): Promise<string | null>;
  setSetting(key: "issuer_outage", value: string): Promise<void>;
  /** Fixed-window limiter. Fails CLOSED (false) on backend error. */
  rateLimit(bucket: string, windowSecs: number, max: number): Promise<boolean>;
}

const now = () => new Date().toISOString();

// ── Memory (local dev / unit tests only) ─────────────────────────────────────
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  users = new Map<string, UserRow>(); cards = new Map<string, CardRow>(); intents = new Map<string, TxIntentRow>();
  auths = new Map<string, AuthorizationRow>(); feed: FeedEventRow[] = []; receipts = new Set<string>();
  settings = new Map<string, string>(); limits = new Map<string, number>();

  async upsertUser(privyUserId: string, wallet: string) {
    const existing = this.users.get(privyUserId);
    const row: UserRow = { id: existing?.id ?? crypto.randomUUID(), privy_user_id: privyUserId, wallet, bound_at: existing?.bound_at ?? now() };
    this.users.set(privyUserId, row); return row;
  }
  async getUserByPrivyId(id: string) { return this.users.get(id) ?? null; }
  async insertCard(row: Omit<CardRow, "created_at" | "updated_at">) {
    if (this.cards.has(row.card_pda)) throw new Error("duplicate card");
    this.cards.set(row.card_pda, { ...row, created_at: now(), updated_at: now() });
  }
  async getCard(pda: string) { return this.cards.get(pda) ?? null; }
  async getCardByLithicToken(t: string) { return [...this.cards.values()].find((c) => c.lithic_card_token === t) ?? null; }
  async listCards(owner: string) { return [...this.cards.values()].filter((c) => c.owner_wallet === owner).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async updateCard(pda: string, patch: Patch<CardRow>, expect?: CardRow["issue_state"]) {
    const c = this.cards.get(pda);
    if (!c || (expect && c.issue_state !== expect)) return false;
    this.cards.set(pda, { ...c, ...patch, updated_at: now() }); return true;
  }
  async insertIntent(row: Omit<TxIntentRow, "id" | "created_at" | "consumed_at" | "signature">) {
    const r: TxIntentRow = { ...row, id: crypto.randomUUID(), created_at: now(), consumed_at: null, signature: null };
    this.intents.set(r.id, r); return r;
  }
  async getIntent(id: string) { return this.intents.get(id) ?? null; }
  async consumeIntent(id: string) {
    const r = this.intents.get(id);
    if (!r || r.consumed_at || r.expires_at < now()) return false;
    r.consumed_at = now(); return true;
  }
  async setIntentSignature(id: string, sig: string) { const r = this.intents.get(id); if (r) r.signature = sig; }
  async upsertAuthorization(row: Partial<AuthorizationRow> & Pick<AuthorizationRow, "lithic_token">) {
    const prev = this.auths.get(row.lithic_token);
    const base: AuthorizationRow = prev ?? { lithic_token: row.lithic_token, card_pda: null, amount_cents: 0, merchant_descriptor: null, acceptor_id: null, decision: "PENDING", reason: "",
      settle_signature: null, confirmed_at: null, replied_at: null, timings: {}, lithic_final_status: null, reconcile_action: null, refund_signature: null, created_at: now(), updated_at: now(), auth_hash: "" };
    this.auths.set(row.lithic_token, { ...base, ...row, updated_at: now() });
  }
  async getAuthorization(t: string) { return this.auths.get(t) ?? null; }
  async getAuthorizationByAuthHash(h: string) { return [...this.auths.values()].find((a) => a.auth_hash === h) ?? null; }
  async listUnreconciled(olderThanSecs: number, limit: number) {
    const cutoff = new Date(Date.now() - olderThanSecs * 1000).toISOString();
    return [...this.auths.values()].filter((a) => a.reconcile_action === null && a.created_at <= cutoff).slice(0, limit);
  }
  async insertFeedEvent(ev: NewFeedEvent) {
    const key = (e: Pick<FeedEventRow, "signature" | "kind" | "card_pda" | "lithic_token">) => [e.signature ?? "", e.kind, e.card_pda ?? "", e.lithic_token ?? ""].join("|");
    if (this.feed.some((f) => key(f) === key(ev))) return false;
    this.feed.push({ ...ev, id: crypto.randomUUID(), at: ev.at ?? now() }); return true;
  }
  async listFeed(q: FeedQuery) {
    return this.feed.filter((f) => (!q.ownerWallet || f.owner_wallet === q.ownerWallet) && (!q.cardPda || f.card_pda === q.cardPda) && (!q.since || f.at > q.since))
      .sort((a, b) => b.at.localeCompare(a.at)).slice(0, q.limit ?? 50);
  }
  async recordReceipt(p: string, id: string) { const k = `${p}:${id}`; if (this.receipts.has(k)) return false; this.receipts.add(k); return true; }
  async getSetting(k: string) { return this.settings.get(k) ?? null; }
  async setSetting(k: string, v: string) { this.settings.set(k, v); }
  async rateLimit(bucket: string, windowSecs: number, max: number) {
    const k = `${bucket}:${Math.floor(Date.now() / 1000 / windowSecs)}`;
    const n = (this.limits.get(k) ?? 0) + 1; this.limits.set(k, n); return n <= max;
  }
}

// ── Supabase (production) ────────────────────────────────────────────────────
const UNIQUE_VIOLATION = "23505";
export class SupabaseStore implements Store {
  readonly kind = "supabase" as const;
  constructor(private sb: SupabaseClient) {}
  private ok<T>(r: { data: T; error: { message: string; code?: string } | null }, what: string): T {
    if (r.error) throw new Error(`db ${what}: ${r.error.code ?? ""} ${r.error.message}`);
    return r.data;
  }
  async upsertUser(privyUserId: string, wallet: string) {
    return this.ok(await this.sb.from("users").upsert({ privy_user_id: privyUserId, wallet }, { onConflict: "privy_user_id" }).select().single(), "upsertUser") as UserRow;
  }
  async getUserByPrivyId(id: string) { return this.ok(await this.sb.from("users").select().eq("privy_user_id", id).maybeSingle(), "getUser") as UserRow | null; }
  async insertCard(row: Omit<CardRow, "created_at" | "updated_at">) { this.ok(await this.sb.from("cards").insert(row), "insertCard"); }
  async getCard(pda: string) { return this.ok(await this.sb.from("cards").select().eq("card_pda", pda).maybeSingle(), "getCard") as CardRow | null; }
  async getCardByLithicToken(t: string) { return this.ok(await this.sb.from("cards").select().eq("lithic_card_token", t).maybeSingle(), "getCardByLithic") as CardRow | null; }
  async listCards(owner: string) { return this.ok(await this.sb.from("cards").select().eq("owner_wallet", owner).order("created_at", { ascending: false }), "listCards") as CardRow[]; }
  async updateCard(pda: string, patch: Patch<CardRow>, expect?: CardRow["issue_state"]) {
    let q = this.sb.from("cards").update({ ...patch, updated_at: now() }).eq("card_pda", pda);
    if (expect) q = q.eq("issue_state", expect);
    return (this.ok(await q.select("card_pda"), "updateCard") as unknown[]).length > 0;
  }
  async insertIntent(row: Omit<TxIntentRow, "id" | "created_at" | "consumed_at" | "signature">) {
    return this.ok(await this.sb.from("tx_intents").insert(row).select().single(), "insertIntent") as TxIntentRow;
  }
  async getIntent(id: string) { return this.ok(await this.sb.from("tx_intents").select().eq("id", id).maybeSingle(), "getIntent") as TxIntentRow | null; }
  async consumeIntent(id: string) {
    const r = await this.sb.from("tx_intents").update({ consumed_at: now() }).eq("id", id).is("consumed_at", null).gt("expires_at", now()).select("id");
    return (this.ok(r, "consumeIntent") as unknown[]).length === 1;
  }
  async setIntentSignature(id: string, signature: string) { this.ok(await this.sb.from("tx_intents").update({ signature }).eq("id", id), "setIntentSignature"); }
  async upsertAuthorization(row: Partial<AuthorizationRow> & Pick<AuthorizationRow, "lithic_token">) {
    this.ok(await this.sb.from("authorizations").upsert({ ...row, updated_at: now() }, { onConflict: "lithic_token" }), "upsertAuthorization");
  }
  async getAuthorization(t: string) { return this.ok(await this.sb.from("authorizations").select().eq("lithic_token", t).maybeSingle(), "getAuthorization") as AuthorizationRow | null; }
  async getAuthorizationByAuthHash(h: string) { return this.ok(await this.sb.from("authorizations").select().eq("auth_hash", h).maybeSingle(), "getAuthorizationByAuthHash") as AuthorizationRow | null; }
  async listUnreconciled(olderThanSecs: number, limit: number) {
    const cutoff = new Date(Date.now() - olderThanSecs * 1000).toISOString();
    return this.ok(await this.sb.from("authorizations").select().is("reconcile_action", null).lte("created_at", cutoff).order("created_at").limit(limit), "listUnreconciled") as AuthorizationRow[];
  }
  async insertFeedEvent(ev: NewFeedEvent) {
    const r = await this.sb.from("feed_events").insert(ev);
    if (r.error?.code === UNIQUE_VIOLATION) return false;
    this.ok(r, "insertFeedEvent"); return true;
  }
  async listFeed(q: FeedQuery) {
    let s = this.sb.from("feed_events").select().order("at", { ascending: false }).limit(q.limit ?? 50);
    if (q.ownerWallet) s = s.eq("owner_wallet", q.ownerWallet);
    if (q.cardPda) s = s.eq("card_pda", q.cardPda);
    if (q.since) s = s.gt("at", q.since);
    return this.ok(await s, "listFeed") as FeedEventRow[];
  }
  async recordReceipt(provider: WebhookReceiptRow["provider"], receiptId: string) {
    const r = await this.sb.from("webhook_receipts").insert({ provider, receipt_id: receiptId });
    if (r.error?.code === UNIQUE_VIOLATION) return false;
    this.ok(r, "recordReceipt"); return true;
  }
  async getSetting(key: "issuer_outage") {
    const r = this.ok(await this.sb.from("app_settings").select("value").eq("key", key).maybeSingle(), "getSetting") as { value: string } | null;
    return r?.value ?? null;
  }
  async setSetting(key: "issuer_outage", value: string) { this.ok(await this.sb.from("app_settings").upsert({ key, value, updated_at: now() }), "setSetting"); }
  async rateLimit(bucket: string, windowSecs: number, max: number) {
    const { data, error } = await this.sb.rpc("rate_limit_hit", { p_bucket: bucket, p_window_secs: windowSecs, p_max: max });
    return !error && data === true;
  }
}

let store: Store | null = null;
/** Process-wide store. Supabase when configured; MemoryStore only outside Vercel. */
export function getStore(): Store {
  if (store) return store;
  // Prefer the new secret API key (sb_secret_…); fall back to the legacy service_role JWT.
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    store = new SupabaseStore(createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (i, init) => fetch(i, { ...init, cache: "no-store" }) } }));
  } else {
    if (process.env.VERCEL) throw new Error("Supabase not configured: set SUPABASE_URL + SUPABASE_SECRET_KEY (MemoryStore is local-only)");
    store = new MemoryStore();
  }
  return store;
}
/** Tests only. */
export const __setStoreForTests = (s: Store | null) => { store = s; };
