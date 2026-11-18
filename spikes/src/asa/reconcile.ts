// CP0b — reconciler. Invariant: after reconciliation, USDC moved == USDC approved.
// Input = each authorization's FINAL decision (production: Lithic card_transaction events;
// mock: the reply to the final delivery attempt). For every authorization whose final decision
// is not APPROVED but whose settle landed onchain anyway (late landing / duplicate race), refund
// the unrefunded remainder to the card's stored source account. Idempotent: the program caps
// refunds at record.amount - record.refunded.
import { Transaction, sendAndConfirmTransaction, type Connection, type Keypair } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { authHash, cardPda, ixRefund, readSettlementRecords } from "../lib/allowances.js";

export type FinalDecision = { token: string; owner: string; cardId: bigint; finalResult: string };
export type ReconcileOutcome = FinalDecision & { record: { amount: string; refunded: string } | null; action: "none" | "refunded" | "ANOMALY_approved_without_record"; refundSig?: string };

export async function reconcile(conn: Connection, settler: Keypair, items: FinalDecision[]): Promise<ReconcileOutcome[]> {
  const out: ReconcileOutcome[] = [];
  const recs = await readSettlementRecords(conn, items.map((it) => ({ card: cardPda(new PublicKey(it.owner), it.cardId), hash: authHash(it.token) })));
  for (const [i, it] of items.entries()) {
    const owner = new PublicKey(it.owner);
    const hash = authHash(it.token);
    const rec = recs[i] ?? null;
    const r = rec ? { amount: rec.amount.toString(), refunded: rec.refunded.toString() } : null;
    if (it.finalResult === "APPROVED") {
      out.push({ ...it, record: r, action: rec ? "none" : "ANOMALY_approved_without_record" });
      continue;
    }
    if (rec && rec.refunded < rec.amount) {
      const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ixRefund(settler.publicKey, owner, it.cardId, rec.amount - rec.refunded, hash)), [settler], { commitment: "confirmed" });
      out.push({ ...it, record: r, action: "refunded", refundSig: sig });
    } else out.push({ ...it, record: r, action: "none" });
  }
  return out;
}
