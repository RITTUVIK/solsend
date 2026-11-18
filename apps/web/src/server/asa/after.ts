// Work done AFTER the ASA reply (Vercel `waitUntil`, CP1 F4 step 7). Never affects the reply.
//  1. persist the authorizations row + a feed row (source "lithic")
//  2. not APPROVED but a settle was sent → keep watching that signature (~30 s) and reconcile:
//     a late-landing settle is refunded (invariant 4; the rule still checks Lithic status)
//  3. ONE_TIME card + confirmed settle → close the Lithic card (Lithic SINGLE_USE also auto-closes)
import type { Store } from "../store";
import type { LithicApi } from "../lithic/client";
import { safeErr } from "../lib/safe";
import { confirmSignature, type Clock, type Rpc } from "../solana/rpc";
import { reconcileAuthorization, type ReconcileDeps } from "../reconcile/reconciler";
import { reasonForRow, reasonText } from "./errors";
import type { AsaDecision } from "./engine";

export type AfterDeps = ReconcileDeps & { rpc: Rpc; store: Store; lithic: Pick<LithicApi, "getTransaction" | "setCardState">; clock: Clock; lateWatchMs?: number };

export async function afterAsaReply(deps: AfterDeps, d: AsaDecision, repliedAt: string, opts: { deduped: boolean }): Promise<void> {
  if (!d.token) return; // unparseable request: nothing to key a row on
  try {
    await persist(deps, d, repliedAt, opts.deduped);
  } catch (e) {
    console.error(`[asa:after] persist failed token=${d.token}: ${safeErr(e)}`);
  }
  if (opts.deduped) return; // the first delivery's hook owns the follow-up work

  if (d.result !== "APPROVED" && d.settleSent && d.signature) {
    const until = deps.clock.now() + (deps.lateWatchMs ?? 30_000);
    await confirmSignature(deps.rpc, d.signature, until, deps.clock, 2000);
    try {
      const row = await deps.store.getAuthorization(d.token);
      if (row) {
        const r = await reconcileAuthorization(deps, row);
        console.log(`[asa:after] late-settle check token=${d.token} → ${r.outcome}/${r.tag}${r.refundSignature ? ` refund=${r.refundSignature}` : ""}`);
      }
    } catch (e) {
      console.error(`[asa:after] late-settle reconcile failed token=${d.token}: ${safeErr(e)} (cron will retry)`);
    }
  }

  if (d.result === "APPROVED" && d.reason === "settled_confirmed" && d.card && d.lithicCardToken) {
    try {
      const card = await deps.store.getCard(d.card.pda.toBase58());
      if (card?.kind === "ONE_TIME") await deps.lithic.setCardState(d.lithicCardToken, "CLOSED");
    } catch (e) {
      console.warn(`[asa:after] one-time close skipped: ${safeErr(e, 80)}`); // SINGLE_USE cards auto-close at Lithic anyway
    }
  }
}

async function persist(deps: AfterDeps, d: AsaDecision, repliedAt: string, deduped: boolean) {
  const prev = await deps.store.getAuthorization(d.token);
  // Never downgrade an approved authorization because a later redelivery declined (e.g. incremental auth).
  if (prev?.decision === "APPROVED" && d.result !== "APPROVED") {
    const { updated_at: _u, ...rest } = prev;
    await deps.store.upsertAuthorization({ ...rest, timings: { ...prev.timings, [`redelivery_declined_${Date.now()}`]: d.timings.total_ms } });
    return;
  }
  if (deduped && prev) return;
  const reconcileAction = d.settleSent ? null : d.reason === "zero_amount_verification" ? "none_zero_amount" : "none_no_settle";
  await deps.store.upsertAuthorization({
    lithic_token: d.token, auth_hash: d.authHashHex ?? "", card_pda: d.card?.pda.toBase58() ?? null, amount_cents: d.amountCents,
    merchant_descriptor: d.merchant.descriptor, acceptor_id: d.merchant.acceptorId, decision: d.result, reason: reasonForRow(d.reason),
    settle_signature: d.signature, confirmed_at: d.confirmedAt, replied_at: repliedAt, timings: d.timings,
    reconcile_action: reconcileAction, ...(prev ? {} : { lithic_final_status: null, refund_signature: null }),
  });
  await deps.store.insertFeedEvent({
    owner_wallet: d.card?.owner.toBase58() ?? null, card_pda: d.card?.pda.toBase58() ?? null,
    kind: d.result === "APPROVED" ? "authorization_approved" : "authorization_declined",
    amount_base: d.amountBase > 0n ? d.amountBase.toString() : (BigInt(d.amountCents) * 10_000n).toString(), remaining_base: null,
    signature: d.signature, lithic_token: d.token, merchant: d.merchant.descriptor, reason: reasonText(d.reason), source: "lithic", slot: null,
  });
}
