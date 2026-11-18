// QuickNode Streams webhook handler (F6). Verify -> replay guard -> parse QnPayload -> idempotent feed rows.
// Streams deliveries are notifications for the live feed only; money correctness never depends on them (TRUST.md).
import { z } from "zod";
import { api } from "@solsend/shared";
import type { NewFeedEvent, Store } from "../store";
import { timestampFresh, verifyQuickNodeSignature } from "./verify";

// Tolerant of the amended shared QnMatch (no memo): a stray/legacy `memo` is accepted and ignored.
const Payload = z.object({ solsend: z.literal("v1"), matches: z.array(api.QnMatch.extend({ memo: z.string().nullable().optional() })) });
type Payload = z.infer<typeof Payload>;
type LookupStore = Pick<Store, "getCard"> & { getAuthorizationByAuthHash?: (hex: string) => Promise<{ lithic_token: string } | null> };

const KIND: Record<string, string> = {
  CardSettled: "settled", CardRefunded: "refunded", CardRegistered: "registered",
  CardFrozen: "frozen", CardUnfrozen: "unfrozen", CardClosed: "closed",
};

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
/** The onchain link to a Lithic authorization is auth_hash = sha256("solsend:auth:v1:" + token); the token itself is never onchain. */
async function lithicTokenFor(store: LookupStore, authHash: string | null): Promise<string | null> {
  if (!authHash || !store.getAuthorizationByAuthHash) return null;
  try { return (await store.getAuthorizationByAuthHash(authHash))?.lithic_token ?? null; } catch { return null; }
}

/** Map a decoded payload to feed rows. Failed transactions and ConfigUpdated produce nothing. */
export async function feedRowsFromPayload(payload: Payload, store: LookupStore): Promise<NewFeedEvent[]> {
  const rows: NewFeedEvent[] = [];
  for (const m of payload.matches) {
    if (!m.success) continue;
    for (const e of m.events) {
      const kind = KIND[e.name];
      const card = str(e.card);
      if (!kind || !card) continue;
      const owner = str(e.owner) ?? (await store.getCard(card))?.owner_wallet ?? null;
      rows.push({
        owner_wallet: owner, card_pda: card, kind, amount_base: str(e.amount), remaining_base: str(e.remainingAllowance),
        signature: m.signature, lithic_token: e.name === "CardSettled" || e.name === "CardRefunded" ? await lithicTokenFor(store, str(e.authHash)) : null, merchant: null, reason: null,
        source: "quicknode", slot: m.slot, at: m.blockTime ? new Date(m.blockTime * 1000).toISOString() : undefined,
      });
    }
  }
  return rows;
}

const text = (status: number, body: string) => new Response(body, { status });

export async function handleQuickNodeWebhook(req: Request, deps: { token: string | undefined; store: Store | (() => Store); nowMs?: number }): Promise<Response> {
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
  if (!(await store.recordReceipt("quicknode", nonce))) return text(409, "replay");

  let payload: Payload;
  try { payload = Payload.parse(JSON.parse(body)); } catch { return text(400, "bad payload"); }

  try {
    let inserted = 0;
    for (const row of await feedRowsFromPayload(payload, store)) if (await store.insertFeedEvent(row)) inserted++;
    return Response.json({ ok: true, matches: payload.matches.length, inserted });
  } catch (e) {
    console.error("[qn] feed insert failed:", e instanceof Error ? e.message : "unknown");
    return text(500, "store error");
  }
}
