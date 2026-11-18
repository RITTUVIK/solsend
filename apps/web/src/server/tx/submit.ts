// POST /api/tx/submit core: verify (byte-identical + owner sig) → consume → cosign → send → CONFIRMED,
// then the intent-kind side effects (F3 step 3–4: card state + Lithic issuance; F8 feed rows).
import bs58 from "bs58";
import { explorerTx, type api } from "@solsend/shared";
import type { z } from "zod";
import { HttpError } from "../auth";
import { safeErr } from "../lib/safe";
import { confirmSignature, rebroadcast } from "../solana/rpc";
import { issueLithicCard, type CardDeps } from "../cards/service";
import { cosign, takeIntent } from "./intents";

const FEED_KIND: Record<string, string> = { create_card: "registered", card_freeze: "frozen", card_unfreeze: "unfrozen", card_close: "closed" };

const BLOCKHASH_ERR = /blockhash not found|BlockhashNotFound|block height exceeded|TransactionExpired/i;
/** Send with preflight. "Blockhash not found" has two causes: (a) the RPC node serving the send lags the one that issued
 *  the blockhash → a short retry succeeds; (b) the user took longer to sign than the blockhash lives (~60–90 s; e.g. the
 *  first wallet setup right after login, user-reported) → 409 `tx_expired`; the client re-prepares and asks to sign once
 *  more. Other preflight failures stay 400 `tx_rejected`. The intent is already consumed, so a re-prepare is required. */
export async function sendWithBlockhashRetry(rpc: Pick<CardDeps["rpc"], "sendRawTransaction">, wire: Uint8Array | Buffer, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)), attempts = 3): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await rpc.sendRawTransaction(wire, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 2 });
      return;
    } catch (e) {
      const msg = safeErr(e, 160);
      if (BLOCKHASH_ERR.test(msg)) {
        if (i < attempts) { await sleep(500); continue; }
        throw new HttpError(409, "this transaction expired before it reached the network (signing took a little long). Please sign again.", "tx_expired");
      }
      const logs = ((e as { logs?: string[] }).logs ?? []).filter((l) => /failed|error/i.test(l)).slice(-2).join(" | ");
      throw new HttpError(400, `transaction rejected by devnet: ${safeErr(e, 120)}${logs ? ` (${logs.slice(0, 200)})` : ""}`, "tx_rejected");
    }
  }
}

export async function submitTx(deps: CardDeps, owner: string, req: z.infer<typeof api.SubmitTxRequest>): Promise<z.infer<typeof api.SubmitTxResponse>> {
  const { intent, verified } = await takeIntent(deps.store, req.intentId, req.signedTxBase64, { owner, feePayer: deps.feePayer.publicKey, nowMs: deps.clock.now() });
  const { wire, signatureBytes } = cosign(verified, deps.feePayer);
  const signature = bs58.encode(signatureBytes);
  await sendWithBlockhashRetry(deps.rpc, wire);
  await deps.store.setIntentSignature(intent.id, signature);
  const until = deps.clock.now() + 45_000;
  const stop = rebroadcast(deps.rpc, wire, until, deps.clock, 2000);
  let st;
  try { st = await confirmSignature(deps.rpc, signature, until, deps.clock); } finally { stop(); }
  if (!st) throw new HttpError(504, `not confirmed yet: ${signature}`, "not_confirmed");
  if (st.err) throw new HttpError(400, `transaction failed onchain: ${signature} ${JSON.stringify(st.err).slice(0, 80)}`, "tx_failed");

  // ── confirmed: side effects (best effort; GET /api/cards recovery re-drives anything missed) ──
  try {
    if (intent.kind === "create_card" && intent.card_pda) {
      await deps.store.updateCard(intent.card_pda, { issue_state: "onchain_confirmed", register_signature: signature }, "onchain_pending")
        || await deps.store.updateCard(intent.card_pda, { issue_state: "onchain_confirmed", register_signature: signature }, "failed");
      const row = await deps.store.getCard(intent.card_pda);
      if (row) await issueLithicCard(deps, row);
    }
    if (intent.kind === "card_close" && intent.card_pda) {
      const row = await deps.store.getCard(intent.card_pda);
      if (row?.lithic_card_token) await deps.lithic.setCardState(row.lithic_card_token, "CLOSED").catch(() => {});
    }
    const kind = FEED_KIND[intent.kind];
    if (kind) {
      await deps.store.insertFeedEvent({ owner_wallet: owner, card_pda: intent.card_pda, kind, amount_base: null, remaining_base: null, signature, lithic_token: null, merchant: null, reason: null, source: "app", slot: null });
    }
  } catch (e) {
    console.error(`[tx/submit] post-confirm side effect failed (${intent.kind}): ${safeErr(e)}`);
  }
  return { signature, explorer: explorerTx(signature), confirmed: true };
}
