// SettlementRecord / Card readers at `confirmed` commitment, plus the card ↔ Lithic tags mapping.
import { PublicKey } from "@solana/web3.js";
import { CardTagsZ, SOLSEND_PROGRAM_ID, cardPda, decodeCard, decodeSettlementRecord, settlementRecordPda, type CardAccount } from "@solsend/shared";
import { getAccountsChunked, type Clock, type Rpc } from "./rpc";

export type RecordView = { amount: bigint; refunded: bigint };
export type CardRef = { pda: PublicKey; owner: PublicKey; cardId: bigint };

/** THE ONLY place the SettlementRecord address is derived (ASA duplicate rule, reconciler, recovery, tests, ops).
 *  Program Upgrade 1: seeds are ["settle", auth_hash] — one record per authorization across ALL cards. `card` is kept in
 *  the signature because readers still require record.card == card (a record for another card never approves here). */
export const recordAddress = (_card: PublicKey, authHash: Uint8Array): PublicKey => settlementRecordPda(authHash);

export async function readSettlementRecord(rpc: Pick<Rpc, "getAccountInfo">, card: PublicKey, authHash: Uint8Array): Promise<RecordView | null> {
  const acc = await rpc.getAccountInfo(recordAddress(card, authHash), "confirmed");
  return acc ? decodeRecordAccount(acc, card) : null;
}

export async function readSettlementRecords(rpc: Pick<Rpc, "getMultipleAccountsInfo">, items: { card: PublicKey; authHash: Uint8Array }[], clock?: Clock): Promise<(RecordView | null)[]> {
  const accs = await getAccountsChunked(rpc, items.map((i) => recordAddress(i.card, i.authHash)), "confirmed", clock);
  return accs.map((a, i) => (a ? decodeRecordAccount(a, items[i]!.card) : null));
}

function decodeRecordAccount(acc: { owner: PublicKey; data: Uint8Array }, card: PublicKey): RecordView | null {
  if (!acc.owner.equals(SOLSEND_PROGRAM_ID)) return null;
  const r = decodeSettlementRecord(acc.data);
  if (!r || !r.card.equals(card)) return null;
  return { amount: r.amount, refunded: r.refunded };
}

export async function readCard(rpc: Pick<Rpc, "getAccountInfo">, pda: PublicKey): Promise<CardAccount | null> {
  const acc = await rpc.getAccountInfo(pda, "confirmed");
  if (!acc || !acc.owner.equals(SOLSEND_PROGRAM_ID)) return null;
  return decodeCard(acc.data);
}

const U64_MAX = (1n << 64n) - 1n;
/** Lithic card tags → Card PDA, accepted only if `cardPda(owner, cardId) == tags.solsend_card` (F4 step 2). */
export function cardFromTags(tags: unknown): CardRef | null {
  const t = CardTagsZ.safeParse(tags);
  if (!t.success || !/^\d{1,20}$/.test(t.data.solsend_card_id)) return null;
  try {
    const owner = new PublicKey(t.data.solsend_owner);
    const cardId = BigInt(t.data.solsend_card_id);
    if (cardId > U64_MAX) return null;
    const pda = cardPda(owner, cardId);
    return pda.toBase58() === t.data.solsend_card ? { pda, owner, cardId } : null;
  } catch {
    return null;
  }
}

export const tagsFor = (owner: PublicKey, cardId: bigint) => ({ solsend_card: cardPda(owner, cardId).toBase58(), solsend_owner: owner.toBase58(), solsend_card_id: cardId.toString() });
