// GET /api/feed core: owner-scoped rows → api.FeedRow (sandbox-labeled, explorer links).
import { api, explorerTx, type FeedEventRow } from "@solsend/shared";
type TFeedRow = api.TFeedRow;
import type { Store } from "./store";

const KINDS = new Set<string>(api.FeedKindZ.options);

export function toFeedRow(r: FeedEventRow): TFeedRow | null {
  if (!KINDS.has(r.kind)) return null;
  return {
    id: r.id, cardPda: r.card_pda, kind: r.kind as TFeedRow["kind"], at: new Date(r.at).toISOString(), source: r.source,
    amountBase: r.amount_base, remainingBase: r.remaining_base, signature: r.signature, explorer: r.signature ? explorerTx(r.signature) : null,
    lithicToken: r.lithic_token, merchant: r.merchant, reason: r.reason, sandbox: true,
  };
}

export async function listFeed(store: Store, wallet: string, q: { cardPda?: string | null; since?: string | null }) {
  const since = q.since && !Number.isNaN(Date.parse(q.since)) ? new Date(q.since).toISOString() : undefined;
  const rows = (await store.listFeed({ ownerWallet: wallet, cardPda: q.cardPda ?? undefined, since, limit: 50 })).map(toFeedRow).filter((r): r is TFeedRow => !!r);
  return { rows, cursor: rows[0]?.at ?? since ?? null };
}
