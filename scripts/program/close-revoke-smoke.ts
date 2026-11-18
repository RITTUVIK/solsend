// LEAD. Devnet proof of F8 close: create a fee-payer-sponsored card, then close_card + Allowances revoke (with the
// sponsor as writable receiver — W1 finding) in ONE owner-signed tx; verify delegation closed, rent back to sponsor,
// and a settle afterwards fails. Usage: npx tsx scripts/program/close-revoke-smoke.ts
import { randomBytes } from "node:crypto";
import { connect, loadKeypair, sendTx, explorer, web3 } from "./lib.js";
import {
  ixCreateFixedDelegation, ixRegisterCard, ixCloseCard, ixRevokeDelegation, ixSettle, readDelegation, readSaInitId,
  cardPda, cardDelegation, subscriptionAuthorityPda, decodeCard, cardStatusName, authCommitment, merchantCommitment,
} from "../../packages/shared/src/index.js";

const { connection } = await connect();
const owner = loadKeypair("card-a-owner"), feePayer = loadKeypair("fee-payer"), settler = loadKeypair("settlement-authority");
const cardId = randomBytes(8).readBigUInt64LE();
const card = cardPda(owner.publicKey, cardId), delegation = cardDelegation(owner.publicKey, cardId);
const sa = await connection.getAccountInfo(subscriptionAuthorityPda(owner.publicKey));
if (!sa) throw new Error("owner SA missing");
const fpBefore = await connection.getBalance(feePayer.publicKey);

const create = await sendTx(connection, [
  ixCreateFixedDelegation({ owner: owner.publicKey, delegatee: card, nonce: cardId, amount: 100_000n, expiryTs: 0n, initId: readSaInitId(sa.data), payer: feePayer.publicKey }),
  ixRegisterCard({ owner: owner.publicKey, payer: feePayer.publicKey, cardId, kind: 0, label: "close-revoke smoke" }),
], feePayer, [owner]);
console.log(`create   ok=${create.ok} ${explorer(create.signature)}`);
const d = readDelegation((await connection.getAccountInfo(delegation))!.data)!;
console.log(`delegation sponsor == fee payer: ${d.payer.equals(feePayer.publicKey)}`);

// Negative control: revoke WITHOUT receiver must fail (documents the bug the fix addresses).
const bad = await sendTx(connection, [ixRevokeDelegation(owner.publicKey, delegation)], feePayer, [owner], { expectFailure: true });
console.log(`revoke w/o receiver ok=${bad.ok} err=${JSON.stringify(bad.err)} ${explorer(bad.signature)}`);

const close = await sendTx(connection, [ixCloseCard(owner.publicKey, cardId), ixRevokeDelegation(owner.publicKey, delegation, d.payer)], feePayer, [owner]);
console.log(`close+revoke ok=${close.ok} events=${close.events.map((e) => e.name).join(",")} ${explorer(close.signature)}`);
const after = await connection.getAccountInfo(delegation);
const c = decodeCard((await connection.getAccountInfo(card))!.data)!;
console.log(`delegation account closed: ${after === null}; card status: ${cardStatusName(c.status)}`);

const settle = await sendTx(connection, [ixSettle({ settler: settler.publicKey, owner: owner.publicKey, cardId, amount: 10_000n,
  authHash: await authCommitment(`smoke-${cardId}`), merchantHash: await merchantCommitment("SOLSENDDEMOTEMU01") })], settler, [], { expectFailure: true });
console.log(`settle after close ok=${settle.ok} err=${JSON.stringify(settle.err)} ${explorer(settle.signature)}`);
const fpAfter = await connection.getBalance(feePayer.publicKey);
console.log(`fee payer net lamports (card rent kept for late refunds; delegation rent returned): ${fpAfter - fpBefore}`);
void web3;
