// Chain-side card helpers: CardView assembly inputs, Allowances revoke with the sponsor receiver,
// wallet readiness (SA + ATA delegate).
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  ALLOWANCES_PROGRAM_ID, SOLSEND_PROGRAM_ID, cardDelegation, cardPda, decodeCard, readDelegation, readSaInitId, subscriptionAuthorityPda, usdcAta,
  type CardAccount, type DelegationView,
} from "@solsend/shared";
import { getAccountsChunked, parseTokenAccount, type Clock, type Rpc, type TokenAccountView } from "../solana/rpc";

export type ChainCard = { card: CardAccount | null; delegation: DelegationView | null; delegationLive: boolean; delegationPayer: PublicKey | null };

/** Allowances delegation header payer (offset 67..99) — the sponsor that receives rent on revoke. */
export const delegationPayer = (data: Uint8Array): PublicKey | null => (data.length >= 99 ? new PublicKey(data.subarray(67, 99)) : null);

/** Read Card PDA + delegation for many cards in ≤5-key batches. `delegationLive` = exists AND Allowances-owned. */
export async function readChainCards(rpc: Pick<Rpc, "getMultipleAccountsInfo">, cards: { owner: PublicKey; cardId: bigint }[], clock?: Clock): Promise<ChainCard[]> {
  const keys = cards.flatMap((c) => [cardPda(c.owner, c.cardId), cardDelegation(c.owner, c.cardId)]);
  const accs = await getAccountsChunked(rpc, keys, "confirmed", clock);
  return cards.map((_, i) => {
    const ca = accs[2 * i] ?? null, da = accs[2 * i + 1] ?? null;
    const card = ca && ca.owner.equals(SOLSEND_PROGRAM_ID) ? decodeCard(ca.data) : null;
    const live = !!da && da.owner.equals(ALLOWANCES_PROGRAM_ID);
    return { card, delegation: live ? readDelegation(da!.data) : null, delegationLive: live, delegationPayer: live ? delegationPayer(da!.data) : null };
  });
}

/** Allowances `revoke_delegation` (ix 3). For a sponsor-funded delegation the delegator must pass the
 *  recorded payer as receiver (upstream docs). The shared builder omits it → REQUEST filed for the lead. */
export function ixRevokeDelegationWithReceiver(owner: PublicKey, delegation: PublicKey, payer: PublicKey | null) {
  const keys = [{ pubkey: owner, isSigner: true, isWritable: true }, { pubkey: delegation, isSigner: false, isWritable: true }];
  if (payer && !payer.equals(owner)) keys.push({ pubkey: payer, isSigner: false, isWritable: true });
  return new TransactionInstruction({ programId: ALLOWANCES_PROGRAM_ID, keys, data: Buffer.from([3]) });
}

export type WalletChain = { lamports: bigint; ata: TokenAccountView | null; saExists: boolean; saInitId: bigint | null; delegateHealthy: boolean };

export async function readWalletChain(rpc: Pick<Rpc, "getMultipleAccountsInfo">, owner: PublicKey): Promise<WalletChain> {
  const sa = subscriptionAuthorityPda(owner);
  const [w, a, s] = await rpc.getMultipleAccountsInfo([owner, usdcAta(owner), sa], "confirmed");
  const ata = a ? parseTokenAccount(a.data) : null;
  const saOk = !!s && s.owner.equals(ALLOWANCES_PROGRAM_ID);
  return {
    lamports: BigInt(w?.lamports ?? 0), ata, saExists: saOk, saInitId: saOk ? readSaInitId(s!.data) : null,
    delegateHealthy: !!ata && ata.delegate === sa.toBase58() && ata.delegatedAmount > 0n,
  };
}

/** Remaining spend in the current period (a recurring period that has elapsed resets to the full amount). */
export function remainingBase(d: DelegationView | null, nowSecs: bigint): bigint {
  if (!d) return 0n;
  if (d.type === "fixed") return d.remaining;
  if (d.periodSecs > 0n && nowSecs >= d.currentPeriodStartTs + d.periodSecs) return d.amountPerPeriod;
  return d.remainingInPeriod;
}
