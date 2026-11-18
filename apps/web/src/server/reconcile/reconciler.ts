// Reconciler executor (CP1 F5). Port of spikes/src/asa/reconcile.ts, driven by Lithic status.
// Refunds go ONLY through the program's `refund` (to card.source_token_account, capped at
// record.amount − record.refunded onchain). Refunds NEVER restore the card's allowance.
import { ComputeBudgetProgram, PublicKey, Transaction, type Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { LITHIC_TERMINAL_DECLINE, SOLSEND_PROGRAM_ID, decodeSettlementRecord, fromHex, ixRefund, toHex, type AuthorizationRow, type LithicTransaction } from "@solsend/shared";
import type { Store } from "../store";
import type { LithicApi } from "../lithic/client";
import { authCommitment } from "../lib/commitments";
import { safeErr } from "../lib/safe";
import { confirmSignature, rebroadcast, type Clock, type Rpc } from "../solana/rpc";
import { readCard, readSettlementRecord, recordAddress, type CardRef } from "../solana/records";
import { decideReconcile, REFUND_FEED_REASON, type LithicStatus, type RuleOutput } from "./rules";

export type ReconcileDeps = {
  rpc: Rpc; settler: Keypair; store: Store; lithic: Pick<LithicApi, "getTransaction">; clock: Clock;
  blockhash: () => Promise<string>;
};
export type ReconcileResult = { token: string; outcome: RuleOutput["action"] | "skipped" | "error"; tag: string; refundSignature?: string; lithicStatus: LithicStatus };

/** Lithic transaction → status for the rule. NOT_FOUND on 404, null when the lookup failed. */
export async function fetchLithicStatus(lithic: Pick<LithicApi, "getTransaction">, token: string): Promise<{ status: LithicStatus; tx: LithicTransaction | null }> {
  try {
    const tx = await lithic.getTransaction(token);
    return tx ? { status: tx.status, tx } : { status: "NOT_FOUND", tx: null };
  } catch {
    return { status: null, tx: null };
  }
}

async function resolveCard(deps: ReconcileDeps, cardPdaStr: string): Promise<CardRef | null> {
  const pda = new PublicKey(cardPdaStr);
  const row = await deps.store.getCard(cardPdaStr).catch(() => null);
  if (row) return { pda, owner: new PublicKey(row.owner_wallet), cardId: BigInt(row.card_id) };
  const onchain = await readCard(deps.rpc, pda);
  return onchain ? { pda, owner: onchain.owner, cardId: onchain.cardId } : null;
}

const patchRow = (store: Store, row: AuthorizationRow, patch: Partial<AuthorizationRow>) => {
  const { updated_at: _u, ...rest } = row;
  return store.upsertAuthorization({ ...rest, ...patch });
};

/**
 * Reconcile ONE authorization. `knownStatus` (from a verified events webhook) skips the Lithic lookup.
 * Idempotent: a concurrent second refund is rejected onchain (RefundExceedsSettled).
 */
export async function reconcileAuthorization(deps: ReconcileDeps, row: AuthorizationRow, knownStatus?: string): Promise<ReconcileResult> {
  const token = row.lithic_token;
  if (!row.card_pda) {
    await patchRow(deps.store, row, { reconcile_action: "none_no_card" });
    return { token, outcome: "done", tag: "none_no_card", lithicStatus: null };
  }
  const expectedHash = toHex(authCommitment(token));
  if (row.auth_hash && row.auth_hash !== expectedHash) {
    await patchRow(deps.store, row, { reconcile_action: "anomaly_auth_hash_mismatch" });
    return { token, outcome: "anomaly", tag: "anomaly_auth_hash_mismatch", lithicStatus: null };
  }
  const card = await resolveCard(deps, row.card_pda);
  if (!card) {
    await patchRow(deps.store, row, { reconcile_action: "none_card_missing" });
    return { token, outcome: "done", tag: "none_card_missing", lithicStatus: null };
  }
  const authHash = fromHex(expectedHash);
  let lithicStatus: LithicStatus = knownStatus ?? null;
  if (!lithicStatus && row.lithic_final_status && (LITHIC_TERMINAL_DECLINE.has(row.lithic_final_status) || row.lithic_final_status === "SETTLED")) lithicStatus = row.lithic_final_status;
  if (!lithicStatus) lithicStatus = (await fetchLithicStatus(deps.lithic, token)).status;
  const record = await readSettlementRecord(deps.rpc, card.pda, authHash);
  const ageSecs = (deps.clock.now() - Date.parse(row.created_at)) / 1000;
  const rule = decideReconcile({ decision: row.decision, lithicStatus, record, ageSecs });
  const statusPatch = lithicStatus && lithicStatus !== "NOT_FOUND" ? { lithic_final_status: lithicStatus } : {};

  if (rule.action === "wait") {
    if (statusPatch.lithic_final_status && statusPatch.lithic_final_status !== row.lithic_final_status) await patchRow(deps.store, row, statusPatch);
    return { token, outcome: "wait", tag: rule.why, lithicStatus };
  }
  if (rule.action === "done" || rule.action === "anomaly") {
    await patchRow(deps.store, row, { ...statusPatch, reconcile_action: rule.tag });
    if (rule.action === "anomaly") console.warn(`[reconcile] ANOMALY ${rule.tag} token=${token}`);
    return { token, outcome: rule.action, tag: rule.tag, lithicStatus };
  }

  // refund the remainder (capped onchain at record.amount − record.refunded)
  try {
    const sig = await sendRefund(deps, card, authHash, rule.amount);
    await patchRow(deps.store, row, { ...statusPatch, reconcile_action: "refunded", refund_signature: sig });
    await deps.store.insertFeedEvent({
      owner_wallet: card.owner.toBase58(), card_pda: card.pda.toBase58(), kind: "refunded", amount_base: rule.amount.toString(), remaining_base: null,
      signature: sig, lithic_token: token, merchant: row.merchant_descriptor, reason: `${REFUND_FEED_REASON} (Lithic ${lithicStatus})`, source: "reconciler", slot: null,
    }).catch(() => false);
    return { token, outcome: "refund", tag: "refunded", refundSignature: sig, lithicStatus };
  } catch (e) {
    console.error(`[reconcile] refund failed token=${token}: ${safeErr(e)}`);
    if (statusPatch.lithic_final_status) await patchRow(deps.store, row, statusPatch).catch(() => {});
    return { token, outcome: "error", tag: `refund_failed:${safeErr(e, 80)}`, lithicStatus };
  }
}

/** Send `refund` signed + paid by the settlement authority; resolves only once CONFIRMED with err null. */
export async function sendRefund(deps: Pick<ReconcileDeps, "rpc" | "settler" | "clock" | "blockhash">, card: CardRef, authHash: Uint8Array, amount: bigint): Promise<string> {
  const tx = new Transaction({ feePayer: deps.settler.publicKey, recentBlockhash: await deps.blockhash() }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
    ixRefund({ settler: deps.settler.publicKey, owner: card.owner, cardId: card.cardId, amount, authHash }),
  );
  tx.sign(deps.settler);
  const raw = tx.serialize();
  const sig = bs58.encode(tx.signature!);
  await deps.rpc.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 });
  const until = deps.clock.now() + 45_000;
  const stop = rebroadcast(deps.rpc, raw, until, deps.clock, 2000);
  try {
    const st = await confirmSignature(deps.rpc, sig, until, deps.clock);
    if (!st) throw new Error(`refund ${sig} not confirmed in time`);
    if (st.err) throw new Error(`refund ${sig} failed: ${JSON.stringify(st.err).slice(0, 80)}`);
    return sig;
  } finally {
    stop();
  }
}

/**
 * Recovery when the authorizations row is missing (ASA persist failed, DB reset): rebuild a minimal row from
 * the onchain SettlementRecord (created_at = record.created_ts) and run the normal Lithic-status rule.
 * Decision is unknown, so an APPROVED-only branch can never fire; DECLINED/VOIDED/EXPIRED/NOT_FOUND refund.
 */
export async function recoverMissingRow(deps: ReconcileDeps, token: string, cardPdaStr: string): Promise<ReconcileResult> {
  const existing = await deps.store.getAuthorization(token);
  if (existing) return reconcileAuthorization(deps, existing);
  const pda = new PublicKey(cardPdaStr);
  const acc = await deps.rpc.getAccountInfo(recordAddress(pda, authCommitment(token)), "confirmed");
  const rec = acc && acc.owner.equals(SOLSEND_PROGRAM_ID) ? decodeSettlementRecord(acc.data) : null;
  if (!rec || !rec.card.equals(pda)) return { token, outcome: "skipped", tag: "no_onchain_record", lithicStatus: null };
  await deps.store.upsertAuthorization({
    lithic_token: token, auth_hash: toHex(authCommitment(token)), card_pda: cardPdaStr, amount_cents: Number(rec.amount / 10_000n), merchant_descriptor: null, acceptor_id: null,
    decision: "UNKNOWN", reason: "row recovered from onchain SettlementRecord", settle_signature: null, confirmed_at: null, replied_at: null, timings: {},
    lithic_final_status: null, reconcile_action: null, refund_signature: null, created_at: new Date(Number(rec.createdTs) * 1000).toISOString(),
  });
  return reconcileAuthorization(deps, (await deps.store.getAuthorization(token))!);
}

/** Cron / manual sweep of `reconcile_action IS NULL` rows (oldest first). Sequential to respect RPC limits. */
export async function sweep(deps: ReconcileDeps, opts: { olderThanSecs?: number; limit?: number } = {}) {
  const rows = await deps.store.listUnreconciled(opts.olderThanSecs ?? 15, opts.limit ?? 20);
  const results: ReconcileResult[] = [];
  for (const row of rows) {
    try {
      results.push(await reconcileAuthorization(deps, row));
    } catch (e) {
      results.push({ token: row.lithic_token, outcome: "error", tag: safeErr(e, 80), lithicStatus: null });
    }
  }
  return results;
}
