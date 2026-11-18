// CP0b / S2 T3 completion — Lithic applied the void asynchronously (status VOIDED observed after the
// main run's 4 s wait). Reconcile T1 with its final Lithic status and refund onchain. No Lithic calls.
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { record } from "./lib/evidence.js";
import { MINT, devnet, explorerTx, loadKeypair, tokenState } from "./lib/solana.js";
import { authHash, cardPda, readSettlementRecord } from "./lib/allowances.js";
import { reconcile } from "./asa/reconcile.js";
const conn = await devnet();
const owner = loadKeypair("card-a-owner");
const settler = loadKeypair("settlement-authority");
const ata = getAssociatedTokenAddressSync(MINT, owner.publicKey);
const t1 = "934ca60c-f410-47e7-ac06-41f9994d9e4b";
const cardId = 1794973227631011n;
const before = (await tokenState(conn, ata)).amount;
// Final Lithic state observed via GET /v1/transactions/{t1}: status VOIDED, events AUTHORIZATION(+114) + AUTHORIZATION_REVERSAL(-114 @ 03:42:25Z)
const r = await reconcile(conn, settler, [{ token: t1, owner: owner.publicKey.toBase58(), cardId, finalResult: "VOIDED" }]);
const rec = await readSettlementRecord(conn, cardPda(owner.publicKey, cardId), authHash(t1));
const after = (await tokenState(conn, ata)).amount;
record("s2", "T3_void_refund_completed", {
  lithic_transaction: t1, lithic_final: { status: "VOIDED", result_field_still: "APPROVED", reversal_event_created: "2026-11-18T03:42:25Z", reversal_amount_cents: -114 },
  finding: "Lithic status update is async (>4s after void); result field stays APPROVED on void — reconcile on status/event type, not result",
  reconciler_action: r[0]?.action, refund: r[0]?.refundSig ? { signature: r[0].refundSig, explorer: explorerTx(r[0].refundSig) } : null,
  record_after: rec ? { amount: rec.amount.toString(), refunded: rec.refunded.toString() } : null,
  owner_usdc_delta: (after - before).toString(),
});
process.exit(0);
