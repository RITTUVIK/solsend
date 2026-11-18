// LEAD. Independent onchain view of one Lithic authorization: commitment → SettlementRecord, card, delegation, owner ATA.
// Usage: npx tsx scripts/program/auth-state.ts <lithicToken>
import { connect } from "./lib.js";
import { authCommitment, settlementRecordPda, decodeSettlementRecord, decodeCard, cardDelegation, readDelegation, usdcAta, cardStatusName, formatUsdc, toHex } from "../../packages/shared/src/index.js";
const token = process.argv[2]!;
const { connection } = await connect();
const h = await authCommitment(token);
const recPda = settlementRecordPda(h);
const recAcc = await connection.getAccountInfo(recPda, "confirmed");
const rec = recAcc ? decodeSettlementRecord(recAcc.data) : null;
if (!rec) { console.log(JSON.stringify({ token, authHash: toHex(h).slice(0, 12), record: null })); process.exit(0); }
const cardAcc = await connection.getAccountInfo(rec.card, "confirmed");
const card = cardAcc ? decodeCard(cardAcc.data) : null;
const del = card ? await connection.getAccountInfo(cardDelegation(card.owner, card.cardId), "confirmed") : null;
const dv = del ? readDelegation(del.data) : null;
const bal = card ? (await connection.getTokenAccountBalance(usdcAta(card.owner)).catch(() => null))?.value.amount ?? "0" : "0";
console.log(JSON.stringify({
  token, authHash: toHex(h).slice(0, 12), recordPda: recPda.toBase58(),
  record: { card: rec.card.toBase58(), amount: formatUsdc(rec.amount), refunded: formatUsdc(rec.refunded), createdTs: new Date(Number(rec.createdTs) * 1000).toISOString() },
  card: card && { owner: card.owner.toBase58(), status: cardStatusName(card.status), source: card.sourceTokenAccount.toBase58(), sourceIsOwnerAta: card.sourceTokenAccount.equals(usdcAta(card.owner)), settled: formatUsdc(card.totalSettled), refunded: formatUsdc(card.totalRefunded) },
  delegation: dv && (dv.type === "fixed" ? { remaining: formatUsdc(dv.remaining) } : { remainingInPeriod: formatUsdc(dv.remainingInPeriod) }),
  ownerUsdc: formatUsdc(BigInt(bal)),
}, null, 1));
