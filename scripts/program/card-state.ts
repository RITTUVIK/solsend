// LEAD. Print a card's onchain state (delegation remaining, status, lock) and the owner's USDC balance.
// Usage: npx tsx scripts/program/card-state.ts <owner> <cardId>
import { connect, web3 } from "./lib.js";
import { cardPda, cardDelegation, decodeCard, readDelegation, usdcAta, cardStatusName, toHex, formatUsdc } from "../../packages/shared/src/index.js";
const [ownerS, idS] = process.argv.slice(2);
const owner = new web3.PublicKey(ownerS!), id = BigInt(idS!);
const { connection } = await connect();
const [c, d, a] = await connection.getMultipleAccountsInfo([cardPda(owner, id), cardDelegation(owner, id), usdcAta(owner)]);
const card = c ? decodeCard(c.data) : null, del = d ? readDelegation(d.data) : null;
const bal = a ? (await connection.getTokenAccountBalance(usdcAta(owner))).value.amount : "0";
console.log(JSON.stringify({
  card: card && { status: cardStatusName(card.status), kind: card.kind, lockSet: toHex(card.merchantLock) !== "0".repeat(64), settled: formatUsdc(card.totalSettled), refunded: formatUsdc(card.totalRefunded), settleCount: card.settleCount },
  delegation: del && (del.type === "fixed" ? { type: "fixed", remaining: formatUsdc(del.remaining) } : { type: "recurring", remainingInPeriod: formatUsdc(del.remainingInPeriod) }),
  ownerUsdc: formatUsdc(BigInt(bal)),
}));
