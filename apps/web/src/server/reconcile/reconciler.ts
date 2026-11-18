// Reconciler executor (CP1 F5). Port of spikes/src/asa/reconcile.ts, driven by Lithic status.
// Refunds go ONLY through the program's `refund` (to card.source_token_account, capped at
// record.amount − record.refunded onchain). Refunds NEVER restore the card's allowance.
import "server-only";
import { ComputeBudgetProgram, PublicKey, Transaction, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import bs58 from "bs58";
import { LITHIC_TERMINAL_DECLINE, SOLSEND_PROGRAM_ID, USDC_MINT, decodeSettlementRecord, fromHex, ixRefund, toHex, usdcAta, type AuthorizationRow, type LithicTransaction } from "@solsend/shared";
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
  /** Pays rent to restore a closed owner USDC ATA before a refund (M3). Optional in tests. */
  feePayer?: Keypair;
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

type ResolvedCard = CardRef & { source: PublicKey };
async function resolveCard(deps: ReconcileDeps, cardPdaStr: string): Promise<ResolvedCard | null> {
  const pda = new PublicKey(cardPdaStr);
  const onchain = await readCard(deps.rpc, pda); // chain is authoritative for the refund destination
  return onchain ? { pda, owner: onchain.owner, cardId: onchain.cardId, source: onchain.sourceTokenAccount } : null;
}

/** L1: write ONLY the changed fields (never `{...staleRow, ...patch}`, which could clobber concurrent writers). */
const patchRow = (store: Store, token: string, patch: Partial<AuthorizationRow>) => store.upsertAuthorization({ lithic_token: token, ...patch });

/** M2/M3 retry policy: attempt n (1-based) waits min(2^(n-1) x 15 s, 30 min); after 8 -> anomaly_refund_failing. */
export const MAX_RECONCILE_ATTEMPTS = 8;
export const backoffMs = (attempts: number) => Math.min(2 ** Math.max(0, attempts - 1) * 15_000, 30 * 60_000);
/** "wait" outcomes are re-checked later instead of holding the head of the sweep (not counted as attempts). */
const WAIT_DELAY_MS: Record<string, number> = { lithic_pending: 60_000, not_found_grace: 15_000, lithic_status_unknown: 30_000 };

async function markRetry(deps: ReconcileDeps, row: AuthorizationRow, e: unknown, lithicStatus: LithicStatus): Promise<ReconcileResult> {
  const token = row.lithic_token;
  const attempts = (row.reconcile_attempts ?? 0) + 1;
  const failing = attempts >= MAX_RECONCILE_ATTEMPTS;
  const err = safeErr(e, 200);
  console.error(`[reconcile] attempt ${attempts} failed token=${token}: ${err}${failing ? " -> anomaly_refund_failing" : ""}`);
  await patchRow(deps.store, token, {
    reconcile_action: failing ? "anomaly_refund_failing" : null, reconcile_attempts: attempts,
    next_attempt_at: failing ? null : new Date(deps.clock.now() + backoffMs(attempts)).toISOString(), last_error: err,
    ...(lithicStatus && lithicStatus !== "NOT_FOUND" ? { lithic_final_status: lithicStatus } : {}),
  }).catch(() => {});
  return { token, outcome: failing ? "anomaly" : "error", tag: failing ? "anomaly_refund_failing" : `retry_${attempts}:${safeErr(e, 80)}`, lithicStatus };
}

/**
 * Reconcile ONE authorization. `knownStatus` (from a verified events webhook) skips the Lithic lookup.
 * Idempotent: a concurrent second refund is rejected onchain (RefundExceedsSettled). Any failure (refund tx,
 * RPC read, DB) takes the retry path: reconcile_action NULL + backoff, so the sweep retries it later. Never throws.
 */
export async function reconcileAuthorization(deps: ReconcileDeps, row: AuthorizationRow, knownStatus?: string): Promise<ReconcileResult> {
  const st: { lithicStatus: LithicStatus } = { lithicStatus: knownStatus ?? null };
  try {
    return await reconcileInner(deps, row, st);
  } catch (e) {
    return markRetry(deps, row, e, st.lithicStatus);
  }
}

async function reconcileInner(deps: ReconcileDeps, row: AuthorizationRow, st: { lithicStatus: LithicStatus }): Promise<ReconcileResult> {
  const token = row.lithic_token;
  if (!row.card_pda) {
    await patchRow(deps.store, token, { reconcile_action: "none_no_card" });
    return { token, outcome: "done", tag: "none_no_card", lithicStatus: null };
  }
  const expectedHash = toHex(authCommitment(token));
  if (row.auth_hash && row.auth_hash !== expectedHash) {
    await patchRow(deps.store, token, { reconcile_action: "anomaly_auth_hash_mismatch" });
    return { token, outcome: "anomaly", tag: "anomaly_auth_hash_mismatch", lithicStatus: null };
  }
  const card = await resolveCard(deps, row.card_pda);
  if (!card) {
    await patchRow(deps.store, token, { reconcile_action: "none_card_missing" });
    return { token, outcome: "done", tag: "none_card_missing", lithicStatus: null };
  }
  const authHash = fromHex(expectedHash);
  if (!st.lithicStatus && row.lithic_final_status && (LITHIC_TERMINAL_DECLINE.has(row.lithic_final_status) || row.lithic_final_status === "SETTLED")) st.lithicStatus = row.lithic_final_status;
  if (!st.lithicStatus) st.lithicStatus = (await fetchLithicStatus(deps.lithic, token)).status;
  const lithicStatus = st.lithicStatus;
  const record = await readSettlementRecord(deps.rpc, card.pda, authHash);
  const ageSecs = (deps.clock.now() - Date.parse(row.created_at)) / 1000;
  const rule = decideReconcile({ decision: row.decision, lithicStatus, record, ageSecs });
  const statusPatch = lithicStatus && lithicStatus !== "NOT_FOUND" ? { lithic_final_status: lithicStatus } : {};

  if (rule.action === "wait") {
    const delay = WAIT_DELAY_MS[rule.why] ?? 30_000;
    await patchRow(deps.store, token, { ...statusPatch, ...(row.reconcile_action === null ? { next_attempt_at: new Date(deps.clock.now() + delay).toISOString() } : {}) });
    return { token, outcome: "wait", tag: rule.why, lithicStatus };
  }
  if (rule.action === "done" || rule.action === "anomaly") {
    await patchRow(deps.store, token, { ...statusPatch, reconcile_action: rule.tag, next_attempt_at: null });
    if (rule.action === "anomaly") console.warn(`[reconcile] ANOMALY ${rule.tag} token=${token}`);
    return { token, outcome: rule.action, tag: rule.tag, lithicStatus };
  }

  // refund the remainder (capped onchain at record.amount - record.refunded). Errors -> retry path (caller).
  const sig = await sendRefund(deps, card, authHash, rule.amount);
  await patchRow(deps.store, token, { ...statusPatch, reconcile_action: "refunded", refund_signature: sig, next_attempt_at: null, last_error: null });
  await deps.store.insertFeedEvent({
    owner_wallet: card.owner.toBase58(), card_pda: card.pda.toBase58(), kind: "refunded", amount_base: rule.amount.toString(), remaining_base: null,
    signature: sig, lithic_token: token, merchant: row.merchant_descriptor, reason: `${REFUND_FEED_REASON} (Lithic ${lithicStatus})`, source: "reconciler", slot: null,
  }).catch(() => false);
  return { token, outcome: "refund", tag: "refunded", refundSignature: sig, lithicStatus };
}

/**
 * Send `refund` signed + paid by the settlement authority; resolves only once CONFIRMED with err null.
 * M3: if the destination (card.source_token_account) no longer exists AND equals usdcAta(owner), prepend an
 * idempotent ATA create paid by the fee payer, so a closed ATA can never block a refund. Any other missing
 * destination is never created (the refund then fails -> retry/anomaly).
 */
export async function sendRefund(deps: Pick<ReconcileDeps, "rpc" | "settler" | "clock" | "blockhash" | "feePayer">, card: CardRef & { source?: PublicKey }, authHash: Uint8Array, amount: bigint): Promise<string> {
  const pre: TransactionInstruction[] = [];
  if (card.source) {
    const dest = await deps.rpc.getAccountInfo(card.source, "confirmed");
    if (!dest) {
      if (!card.source.equals(usdcAta(card.owner))) throw new Error("refund destination missing and is not the owner's USDC ATA");
      if (!deps.feePayer) throw new Error("refund destination ATA missing (no fee payer configured to restore it)");
      pre.push(createAssociatedTokenAccountIdempotentInstruction(deps.feePayer.publicKey, card.source, card.owner, USDC_MINT));
    }
  }
  const tx = new Transaction({ feePayer: deps.settler.publicKey, recentBlockhash: await deps.blockhash() }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: pre.length ? 90_000 : 60_000 }),
    ...pre,
    ixRefund({ settler: deps.settler.publicKey, owner: card.owner, cardId: card.cardId, amount, authHash }),
  );
  if (pre.length) tx.sign(deps.settler, deps.feePayer!); else tx.sign(deps.settler);
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

/** Cron / manual sweep of due `reconcile_action IS NULL` rows (backoff-aware order). Sequential to respect RPC limits. */
export async function sweep(deps: ReconcileDeps, opts: { olderThanSecs?: number; limit?: number } = {}) {
  const rows = await deps.store.listUnreconciled(opts.olderThanSecs ?? 15, opts.limit ?? 20);
  const results: ReconcileResult[] = [];
  for (const row of rows) {
    results.push(await reconcileAuthorization(deps, row)); // never throws: failures take the retry path
  }
  return results;
}
