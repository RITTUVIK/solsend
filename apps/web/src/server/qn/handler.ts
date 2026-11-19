// QuickNode Streams webhook handler (F6). Verify -> replay guard -> parse QnPayload -> idempotent feed rows.
// Streams deliveries are notifications for the live feed only; money correctness never depends on them (TRUST.md).
import "server-only";
import { z } from "zod";
import { api } from "@solsend/shared";
import type { NewFeedEvent, Store } from "../store";
import { timestampFresh, verifyQuickNodeSignature } from "./verify";

// Tolerant of the amended shared QnMatch (no memo): a stray/legacy `memo` is accepted and ignored.
const Payload = z.object({ solsend: z.literal("v1"), matches: z.array(api.QnMatch.extend({ memo: z.string().nullable().optional() })) });
type Payload = z.infer<typeof Payload>;
type AuthLookup = { lithic_token: string; card_pda?: string | null; amount_cents?: number; decision?: string; confirmed_at?: string | null };
type LookupStore = Pick<Store, "getCard"> & { getAuthorizationByAuthHash?: (hex: string) => Promise<AuthLookup | null> };
type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KIND: Record<string, string> = {
  CardSettled: "settled", CardRefunded: "refunded", CardRegistered: "registered",
  CardFrozen: "frozen", CardUnfrozen: "unfrozen", CardClosed: "closed",
};

/** The ASA writes its authorization row just AFTER replying (waitUntil) and a delivery can beat it (CP0b: p50 373 ms after
 *  confirmation), so a miss is retried once after this pause before the event is recorded without its authorization. */
export const AUTH_LOOKUP_RETRY_MS = 1500;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
/** The onchain link to a Lithic authorization is auth_hash = sha256("solsend:auth:v1:" + token); the token itself is never onchain. */
async function authorizationFor(store: LookupStore, authHash: string | null, sleep: Sleep): Promise<AuthLookup | null> {
  if (!authHash || !store.getAuthorizationByAuthHash) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const a = await store.getAuthorizationByAuthHash(authHash); if (a) return a; } catch { return null; }
    if (attempt === 0) await sleep(AUTH_LOOKUP_RETRY_MS);
  }
  return null;
}

/** Cross-check the chain's own CardSettled event (as delivered by the Stream) against the card-network authorization.
 *  Display text only: money decisions never depend on it. `receivedAtMs` = when this delivery reached the webhook. */
export function verifySettlement(e: Record<string, unknown>, auth: AuthLookup | null, receivedAtMs: number): string {
  if (!auth) return "Stream alert: no card-network authorization is recorded for this onchain settlement";
  const amountOk = auth.amount_cents != null && (BigInt(auth.amount_cents) * 10_000n).toString() === str(e.amount);
  if (!amountOk || (auth.card_pda && auth.card_pda !== str(e.card))) return `Stream alert: the onchain ${amountOk ? "card" : "amount"} differs from the card-network authorization`;
  if (auth.decision !== "APPROVED") return "Stream alert: settled onchain for an authorization SolSend did not approve (the reconciler refunds it)";
  const lag = auth.confirmed_at ? receivedAtMs - Date.parse(auth.confirmed_at) : NaN;
  return `Amount and card match the card-network authorization${Number.isFinite(lag) && lag >= 0 ? ` · delivered ${Math.round(lag)} ms after SolSend confirmed the settle` : ""}`;
}

/** Map a decoded payload to feed rows. Failed transactions and ConfigUpdated produce nothing. */
export async function feedRowsFromPayload(payload: Payload, store: LookupStore, opts: { sleep?: Sleep; receivedAtMs?: number } = {}): Promise<NewFeedEvent[]> {
  const rows: NewFeedEvent[] = [];
  const receivedAtMs = opts.receivedAtMs ?? Date.now();
  for (const m of payload.matches) {
    if (!m.success) continue;
    for (const e of m.events) {
      const kind = KIND[e.name];
      const card = str(e.card);
      if (!kind || !card) continue;
      const owner = str(e.owner) ?? (await store.getCard(card))?.owner_wallet ?? null;
      const linked = e.name === "CardSettled" || e.name === "CardRefunded";
      const auth = linked ? await authorizationFor(store, str(e.authHash), opts.sleep ?? realSleep) : null;
      rows.push({
        owner_wallet: owner, card_pda: card, kind, amount_base: str(e.amount), remaining_base: str(e.remainingAllowance),
        signature: m.signature, lithic_token: auth?.lithic_token ?? null, merchant: null,
        reason: e.name === "CardSettled" ? verifySettlement(e, auth, receivedAtMs) : null,
        source: "quicknode", slot: m.slot, at: m.blockTime ? new Date(m.blockTime * 1000).toISOString() : undefined,
      });
    }
  }
  return rows;
}

const text = (status: number, body: string) => new Response(body, { status });

export async function handleQuickNodeWebhook(req: Request, deps: { token: string | undefined; store: Store | (() => Store); nowMs?: number; sleep?: Sleep }): Promise<Response> {
  const receivedAtMs = deps.nowMs ?? Date.now();
  if (!deps.token) return text(503, "not configured");
  const body = await req.text();
  const nonce = req.headers.get("x-qn-nonce") ?? "";
  const ts = req.headers.get("x-qn-timestamp") ?? "";
  const sig = req.headers.get("x-qn-signature") ?? "";
  if (!nonce || !ts || !sig || !verifyQuickNodeSignature(deps.token, nonce, ts, body, sig)) return text(401, "bad signature");
  if (!timestampFresh(ts, deps.nowMs)) return text(401, "stale timestamp");
  // Resolve the store only AFTER authentication, so unauthenticated requests never touch the backend.
  let store: Store;
  try { store = typeof deps.store === "function" ? deps.store() : deps.store; } catch { return text(503, "store not configured"); }
  // A repeated nonce is acknowledged (2xx) but not processed: QuickNode pauses a stream after repeated non-2xx replies,
  // so answering a retry of an already-recorded delivery with an error would pause the stream mid-demo.
  if (!(await store.recordReceipt("quicknode", nonce))) return Response.json({ ok: true, duplicate: true });

  let payload: Payload;
  try { payload = Payload.parse(JSON.parse(body)); } catch { return text(400, "bad payload"); }

  try {
    let inserted = 0;
    for (const row of await feedRowsFromPayload(payload, store, { sleep: deps.sleep, receivedAtMs })) if (await store.insertFeedEvent(row)) inserted++;
    return Response.json({ ok: true, matches: payload.matches.length, inserted });
  } catch (e) {
    console.error("[qn] feed insert failed:", e instanceof Error ? e.message : "unknown");
    return text(500, "store error");
  }
}
