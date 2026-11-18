// Cards (CP1 F3 recoverable workflow + F8 lifecycle). Pure over injected deps (rpc/store/keys/lithic/clock).
import "server-only";
import { randomBytes } from "node:crypto";
import { ComputeBudgetProgram, PublicKey, Transaction, type Keypair } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import {
  ALLOWANCES_PROGRAM_ID, CARD_KIND, DEMO_MERCHANTS, SOLSEND_PROGRAM_ID, USDC_MINT, api, cardDelegation, cardPda, cardStatusName, centsToBase,
  ixCloseCard, ixCreateFixedDelegation, ixCreateRecurringDelegation, ixFreezeCard, ixInitSubscriptionAuthority, ixRegisterCard, ixUnfreezeCard,
  usdcAta, type CardRow,
} from "@solsend/shared";
type TCardView = api.TCardView;
import type { z } from "zod";
import { HttpError } from "../auth";
import type { Store } from "../store";
import type { LithicApi } from "../lithic/client";
import { safeErr } from "../lib/safe";
import { merchantCommitment } from "../lib/commitments";
import { tagsFor } from "../solana/records";
import { getAccountsChunked, type Clock, type Rpc } from "../solana/rpc";
import { createIntent, INTENT_TTL_MS, type IntentKind } from "../tx/intents";
import { ixRevokeDelegationWithReceiver, readChainCards, readWalletChain, remainingBase, type ChainCard } from "./chain";

export type CardDeps = { rpc: Rpc; store: Store; feePayer: Keypair; lithic: LithicApi; clock: Clock };

/** Measured on devnet (docs/evidence/w2-backend.md). */
export const CREATE_CARD_CU = 80_000; // register path measured 26,223 CU (+~5k when re-arming the SA)
export const ACTION_CU = 80_000;
const MAX_REVOKES_PER_TX = 12;

const randomCardId = (): bigint => {
  for (;;) {
    const id = randomBytes(8).readBigUInt64LE(0);
    if (id > 0n) return id;
  }
};

async function newTx(rpc: Rpc, feePayer: PublicKey) {
  const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash("confirmed");
  return new Transaction({ feePayer, blockhash, lastValidBlockHeight });
}

/** Lead note (W1 upgrade): a card for a Demo Merchant preset is merchant-locked FROM CREATION to that preset's
 *  acceptor id (a leaked card can't be used anywhere else, even on first use). Anything else → null = lock on first use. */
const PRESET_BY_NAME: Record<string, keyof typeof DEMO_MERCHANTS> = { temu: "TEMU", amazon: "AMAZON", netflix: "NETFLIX" };
export function presetMerchantLock(merchantName: string): Uint8Array | null {
  const key = PRESET_BY_NAME[merchantName.trim().toLowerCase().replace(/\s*\(sandbox\)$/, "")];
  return key ? merchantCommitment(DEMO_MERCHANTS[key].acceptorId) : null;
}

// ── F3 step 1: prepare ─────────────────────────────────────────────────────────────────────────────
export async function prepareCard(deps: CardDeps, owner: string, req: z.infer<typeof api.PrepareCardRequest>): Promise<z.infer<typeof api.PrepareCardResponse>> {
  if (req.kind === "SUBSCRIPTION" && !req.periodDays) throw new HttpError(400, "periodDays is required for SUBSCRIPTION cards", "bad_request");
  const ownerKey = new PublicKey(owner);
  const w = await readWalletChain(deps.rpc, ownerKey);
  if (!w.ata) throw new HttpError(409, "no devnet USDC account yet: claim test USDC first", "no_usdc_account");
  // Allowances sets init_id = creation slot, which can't be predicted, so a missing SA needs its own
  // setup tx first (POST /api/wallet/setup). Re-arming an EXISTING SA keeps init_id (verified by devnet simulation).
  if (!w.saExists || w.saInitId === null) throw new HttpError(409, "wallet setup required (POST /api/wallet/setup)", "setup_required");

  const cardId = randomCardId();
  const pda = cardPda(ownerKey, cardId);
  const limitBase = centsToBase(req.limitCents);
  const periodSecs = req.kind === "SUBSCRIPTION" ? BigInt(req.periodDays!) * 86_400n : null;
  const fp = deps.feePayer.publicKey;
  const tx = await newTx(deps.rpc, fp);
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: CREATE_CARD_CU }));
  if (!w.delegateHealthy) tx.add(ixInitSubscriptionAuthority(ownerKey, fp)); // re-arm the SA as the ATA's delegate
  if (periodSecs === null) {
    tx.add(ixCreateFixedDelegation({ owner: ownerKey, delegatee: pda, nonce: cardId, amount: limitBase, expiryTs: 0n, initId: w.saInitId, payer: fp }));
  } else {
    // start_ts 0 = first period starts when the tx lands (requires an expiry; Allowances rejects start_ts in the past).
    const expiry = BigInt(Math.floor(deps.clock.now() / 1000)) + 5n * 365n * 86_400n;
    tx.add(ixCreateRecurringDelegation({ owner: ownerKey, delegatee: pda, nonce: cardId, amountPerPeriod: limitBase, periodSecs, startTs: 0n, expiryTs: expiry, initId: w.saInitId, payer: fp }));
  }
  const merchantLock = presetMerchantLock(req.merchantName);
  tx.add(ixRegisterCard({ owner: ownerKey, payer: fp, cardId, kind: CARD_KIND[req.kind], label: req.label, merchantLock: merchantLock ?? undefined }));

  await deps.store.insertCard({
    card_pda: pda.toBase58(), owner_wallet: owner, card_id: cardId.toString(), kind: req.kind, label: req.label, merchant_name: req.merchantName,
    limit_base: limitBase.toString(), period_secs: periodSecs === null ? null : Number(periodSecs), issue_state: "onchain_pending",
    register_signature: null, lithic_card_token: null, lithic_last_four: null, lithic_error: null,
  });
  const prepared = await createIntent(deps.store, { owner, kind: "create_card", cardPda: pda.toBase58(), tx, nowMs: deps.clock.now() });
  return { ...prepared, cardPda: pda.toBase58(), cardId: cardId.toString() };
}

/** First-time wallet setup: create the USDC ATA (idempotent) + Allowances SubscriptionAuthority (or re-arm it). */
export async function prepareWalletSetup(deps: CardDeps, owner: string) {
  const ownerKey = new PublicKey(owner);
  const fp = deps.feePayer.publicKey;
  const w = await readWalletChain(deps.rpc, ownerKey);
  if (w.saExists && w.delegateHealthy) throw new HttpError(409, "wallet already set up", "already_set_up");
  const tx = await newTx(deps.rpc, fp);
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }));
  if (!w.ata) tx.add(createAssociatedTokenAccountIdempotentInstruction(fp, usdcAta(ownerKey), ownerKey, USDC_MINT));
  tx.add(ixInitSubscriptionAuthority(ownerKey, fp));
  return createIntent(deps.store, { owner, kind: "wallet_setup", cardPda: null, tx, nowMs: deps.clock.now() });
}

// ── F3 step 4: Lithic issuance (CAS lock onchain_confirmed|lithic_failed → lithic_pending) ──────────────
export async function issueLithicCard(deps: Pick<CardDeps, "store" | "lithic">, row: CardRow): Promise<CardRow["issue_state"]> {
  const from = row.issue_state;
  if (from !== "onchain_confirmed" && from !== "lithic_failed") return from;
  if (!(await deps.store.updateCard(row.card_pda, { issue_state: "lithic_pending", lithic_error: null }, from))) return "lithic_pending";
  try {
    const owner = new PublicKey(row.owner_wallet);
    const issued = await deps.lithic.createCard({
      kind: row.kind, limitCents: Number(BigInt(row.limit_base) / 10_000n), memo: `SolSend ${row.label} (sandbox)`, tags: tagsFor(owner, BigInt(row.card_id)),
    });
    await deps.store.updateCard(row.card_pda, { issue_state: "issued", lithic_card_token: issued.token, lithic_last_four: issued.lastFour, lithic_error: null }, "lithic_pending");
    return "issued";
  } catch (e) {
    await deps.store.updateCard(row.card_pda, { issue_state: "lithic_failed", lithic_error: safeErr(e, 200) }, "lithic_pending");
    return "lithic_failed";
  }
}

// ── F3 step 5: recovery + CardView ────────────────────────────────────────────────────────────────
const STALE_LITHIC_PENDING_MS = 90_000;
const ONCHAIN_PENDING_GRACE_MS = INTENT_TTL_MS + 90_000; // intent expiry + blockhash lifetime

/** Advance non-final rows against the chain. Returns refreshed rows + their chain state. */
export async function recoverAndList(deps: CardDeps, owner: string, opts: { maxIssues?: number } = {}): Promise<{ rows: CardRow[]; chain: ChainCard[] }> {
  let rows = await deps.store.listCards(owner);
  const chain = await readChainCards(deps.rpc, rows.map((r) => ({ owner: new PublicKey(r.owner_wallet), cardId: BigInt(r.card_id) })), deps.clock);
  const now = deps.clock.now();
  let changed = false, issues = 0;
  for (const [i, r] of rows.entries()) {
    const onchain = !!chain[i]?.card;
    const age = now - Date.parse(r.created_at);
    if ((r.issue_state === "onchain_pending" || r.issue_state === "failed") && onchain) {
      changed = (await deps.store.updateCard(r.card_pda, { issue_state: "onchain_confirmed" }, r.issue_state)) || changed;
    } else if (r.issue_state === "onchain_pending" && !onchain && age > ONCHAIN_PENDING_GRACE_MS) {
      changed = (await deps.store.updateCard(r.card_pda, { issue_state: "failed" }, "onchain_pending")) || changed;
    } else if (r.issue_state === "lithic_pending" && now - Date.parse(r.updated_at) > STALE_LITHIC_PENDING_MS) {
      changed = (await deps.store.updateCard(r.card_pda, { issue_state: "lithic_failed", lithic_error: "issuance interrupted; retry" }, "lithic_pending")) || changed;
    }
  }
  if (changed) rows = await deps.store.listCards(owner);
  for (const r of rows) {
    if (r.issue_state === "onchain_confirmed" && issues < (opts.maxIssues ?? 2)) { issues++; await issueLithicCard(deps, r); changed = true; }
  }
  if (issues) rows = await deps.store.listCards(owner);
  return { rows, chain: rows.length === chain.length && !changed ? chain : await readChainCards(deps.rpc, rows.map((r) => ({ owner: new PublicKey(r.owner_wallet), cardId: BigInt(r.card_id) })), deps.clock) };
}

export function toCardView(row: CardRow, c: ChainCard | undefined, nowMs: number): TCardView {
  const card = c?.card ?? null;
  const owner = new PublicKey(row.owner_wallet);
  const delegation = card?.delegation ?? cardDelegation(owner, BigInt(row.card_id));
  const recurring = row.kind === "SUBSCRIPTION";
  const status = card ? cardStatusName(card.status) : "CLOSED";
  return {
    cardPda: row.card_pda, cardId: row.card_id, label: row.label, merchantName: row.merchant_name, kind: row.kind, status, issueState: row.issue_state,
    expiresAt: null, expired: false, // TODO(W2): read the delegation expiry_ts (onchain) for free-trial cards
    lithic: { cardToken: row.lithic_card_token, lastFour: row.lithic_last_four, state: null },
    limit: {
      type: recurring ? "per_period" : "lifetime", totalBase: row.limit_base,
      remainingBase: (c?.delegationLive ? remainingBase(c.delegation, BigInt(Math.floor(nowMs / 1000))) : 0n).toString(),
      periodSecs: row.period_secs,
    },
    totals: { settledBase: (card?.totalSettled ?? 0n).toString(), refundedBase: (card?.totalRefunded ?? 0n).toString() },
    merchantLocked: !!card && card.merchantLock.some((b) => b !== 0),
    delegationLive: !!c?.delegationLive,
    delegation: delegation.toBase58(), createdAt: new Date(row.created_at).toISOString(), registerSignature: row.register_signature,
  };
}

/** A card can pay only if issued AND onchain Active AND its delegation is live (F3 step 5). */
export const isUsable = (v: TCardView) => v.issueState === "issued" && v.status === "ACTIVE" && v.delegationLive;

// ── F8: freeze / unfreeze / close (owner-signed PreparedTx) ──────────────────────────────────────────
export async function ownedCard(store: Store, owner: string, cardPdaStr: string): Promise<CardRow> {
  const row = await store.getCard(cardPdaStr);
  if (!row || row.owner_wallet !== owner) throw new HttpError(404, "card not found", "not_found");
  return row;
}

export async function prepareCardAction(deps: CardDeps, owner: string, row: CardRow, action: "freeze" | "unfreeze" | "close") {
  const ownerKey = new PublicKey(owner);
  const cardId = BigInt(row.card_id);
  const [c] = await readChainCards(deps.rpc, [{ owner: ownerKey, cardId }]);
  if (!c?.card) throw new HttpError(409, "card is not registered onchain", "not_onchain");
  const status = cardStatusName(c.card.status);
  if (action === "freeze" && status !== "ACTIVE") throw new HttpError(409, `card is ${status}`, "invalid_state");
  if (action === "unfreeze" && status !== "FROZEN") throw new HttpError(409, `card is ${status}`, "invalid_state");
  if (action === "close" && status === "CLOSED" && !c.delegationLive) throw new HttpError(409, "card already closed", "invalid_state");
  const tx = await newTx(deps.rpc, deps.feePayer.publicKey);
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: ACTION_CU }));
  if (action === "freeze") tx.add(ixFreezeCard({ authority: ownerKey, owner: ownerKey, cardId }));
  if (action === "unfreeze") tx.add(ixUnfreezeCard(ownerKey, cardId));
  if (action === "close") {
    if (status !== "CLOSED") tx.add(ixCloseCard(ownerKey, cardId));
    if (c.delegationLive) tx.add(ixRevokeDelegationWithReceiver(ownerKey, c.card.delegation, c.delegationPayer));
  }
  const kind: IntentKind = action === "freeze" ? "card_freeze" : action === "unfreeze" ? "card_unfreeze" : "card_close";
  return createIntent(deps.store, { owner, kind, cardPda: row.card_pda, tx, nowMs: deps.clock.now() });
}

/** Escape hatch: one owner-signed tx revoking every live SolSend delegation directly in Allowances (≤12). */
export async function prepareRevokeAll(deps: CardDeps & { gpa?: (owner: PublicKey) => Promise<PublicKey[]> }, owner: string) {
  const ownerKey = new PublicKey(owner);
  const fromDb = (await deps.store.listCards(owner)).map((r) => cardDelegation(ownerKey, BigInt(r.card_id)));
  let fromChain: PublicKey[] = [];
  try { fromChain = deps.gpa ? await deps.gpa(ownerKey) : []; } catch { /* gPA unavailable on this RPC plan → DB list */ }
  const uniq = [...new Map([...fromDb, ...fromChain].map((k) => [k.toBase58(), k])).values()];
  const accs = await getAccountsChunked(deps.rpc, uniq, "confirmed", deps.clock);
  const live = uniq.map((k, i) => ({ k, a: accs[i] })).filter((x) => x.a && x.a.owner.equals(ALLOWANCES_PROGRAM_ID));
  if (!live.length) throw new HttpError(409, "no live delegations to revoke", "nothing_to_revoke");
  const tx = await newTx(deps.rpc, deps.feePayer.publicKey);
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 30_000 + 15_000 * Math.min(live.length, MAX_REVOKES_PER_TX) }));
  for (const { k, a } of live.slice(0, MAX_REVOKES_PER_TX)) {
    const payer = a!.data.length >= 99 ? new PublicKey(a!.data.subarray(67, 99)) : null;
    tx.add(ixRevokeDelegationWithReceiver(ownerKey, k, payer));
  }
  return createIntent(deps.store, { owner, kind: "revoke_all", cardPda: null, tx, nowMs: deps.clock.now() });
}

/** getProgramAccounts: Allowances delegations whose delegator (offset 3) is `owner` and whose delegatee is a SolSend card. */
export function gpaDelegations(rpc: { getProgramAccounts: (p: PublicKey, c: object) => Promise<readonly { pubkey: PublicKey; account: { data: Buffer } }[]> }, readOwners: (keys: PublicKey[]) => Promise<(PublicKey | null)[]>) {
  return async (owner: PublicKey) => {
    const res = await rpc.getProgramAccounts(ALLOWANCES_PROGRAM_ID, { commitment: "confirmed", filters: [{ memcmp: { offset: 3, bytes: owner.toBase58() } }], dataSlice: { offset: 35, length: 32 } });
    const delegatees = res.map((r) => new PublicKey(r.account.data.subarray(0, 32)));
    const owners = await readOwners(delegatees);
    return res.filter((_, i) => owners[i]?.equals(SOLSEND_PROGRAM_ID)).map((r) => r.pubkey);
  };
}
