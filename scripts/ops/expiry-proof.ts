// DEVNET PROOF: free-trial card expiry is enforced ONCHAIN by the Allowances program.
// Built only from the shared builders (@solsend/shared). Keys: card-a-owner (owner), fee-payer, settlement-authority
// from ~/.config/solsend/devnet/. No Lithic calls. Never prints secrets.
//   1. create a STORE_LOCKED card whose FixedDelegation expires in ~2 min (chain clock)
//   2. settle 0.10 USDC before expiry → confirmed OK
//   3. wait until chain time > expiry, settle again → fails onchain with Allowances delegationExpired (Custom 128)
//   4. cleanup: refund the 0.10 (refunds work for any card state; capped by the record)
//   npx tsx@4.23.15 scripts/ops/expiry-proof.ts [--minutes 2]
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as web3 from "../../apps/web/node_modules/@solana/web3.js/lib/index.cjs.js";
import {
  ALLOWANCES_PROGRAM_ID, CARD_KIND, DEVNET_GENESIS_HASH, authCommitment, cardDelegation, cardPda, explorerTx, ixCreateFixedDelegation, ixInitSubscriptionAuthority,
  ixRefund, ixRegisterCard, ixSettle, merchantCommitment, readDelegation, readSaInitId, subscriptionAuthorityPda, usdcAta,
} from "../../packages/shared/src/index";
import { KEYS_DIR, appEnv, rpcLabel } from "./_lib";

const { ComputeBudgetProgram, Connection, Keypair, Transaction } = web3;
type Ix = InstanceType<typeof web3.TransactionInstruction>;
const args = process.argv.slice(2);
const minutes = Number(args[args.indexOf("--minutes") + 1] ?? 2) || 2;
const rpcUrl = appEnv().get("SOLANA_RPC_URL") ?? "https://api.devnet.solana.com";
if (/mainnet/i.test(rpcUrl)) throw new Error("refusing mainnet");
const conn = new Connection(rpcUrl, "confirmed");
if ((await conn.getGenesisHash()) !== DEVNET_GENESIS_HASH) throw new Error("RPC is not devnet");
const key = (n: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(KEYS_DIR, `${n}.json`), "utf8")) as number[]));
const owner = key("card-a-owner"), feePayer = key("fee-payer"), settler = key("settlement-authority");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const chainNow = async () => BigInt((await conn.getBlockTime(await conn.getSlot("confirmed"))) ?? Math.floor(Date.now() / 1000));

async function send(label: string, ixs: Ix[], payer: InstanceType<typeof Keypair>, signers: InstanceType<typeof Keypair>[], expectFail = false) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: expectFail, preflightCommitment: "confirmed" });
  const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  const info = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const err = res.value.err;
  const logs = (info?.meta?.logMessages ?? []).filter((l: string) => /failed|Error|error/.test(l)).slice(-3);
  console.log(`${label}: ${sig} err=${JSON.stringify(err)} slot=${info?.slot} blockTime=${info?.blockTime ? new Date(info.blockTime * 1000).toISOString() : "?"}${logs.length ? ` logs=${JSON.stringify(logs)}` : ""}`);
  return { sig, err, blockTime: info?.blockTime ?? null, logs };
}

// ── 1. card with a ~N-minute onchain expiry ─────────────────────────────────────────────────────
const saAcc = await conn.getAccountInfo(subscriptionAuthorityPda(owner.publicKey), "confirmed");
if (!saAcc || !saAcc.owner.equals(ALLOWANCES_PROGRAM_ID)) throw new Error("card-a-owner has no SubscriptionAuthority");
const initId = readSaInitId(saAcc.data);
const cardId = randomBytes(8).readBigUInt64LE(0) || 1n;
const pda = cardPda(owner.publicKey, cardId);
const t0 = await chainNow();
const expiry = t0 + BigInt(minutes * 60);
const setup = await send("create card (FixedDelegation 1.00 USDC, expiry_ts set) + register_card", [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
  ixInitSubscriptionAuthority(owner.publicKey, feePayer.publicKey), // idempotent re-arm (keeps init_id)
  ixCreateFixedDelegation({ owner: owner.publicKey, delegatee: pda, nonce: cardId, amount: 1_000_000n, expiryTs: expiry, initId, payer: feePayer.publicKey }),
  ixRegisterCard({ owner: owner.publicKey, payer: feePayer.publicKey, cardId, kind: CARD_KIND.STORE_LOCKED, label: "Free trial proof" }),
], feePayer, [feePayer, owner]);
if (setup.err) throw new Error("setup failed");
const del = await conn.getAccountInfo(cardDelegation(owner.publicKey, cardId), "confirmed");
const dv = del ? readDelegation(del.data) : null;
console.log(`card ${pda.toBase58()} (cardId ${cardId}) delegation expiry_ts=${dv?.expiryTs} (${new Date(Number(dv?.expiryTs ?? 0n) * 1000).toISOString()}), chain now ${t0}`);

// ── 2. settle before expiry ────────────────────────────────────────────────────────────────────
const merchant = await merchantCommitment("SOLSENDNFLX01");
const tok1 = randomUUID();
const ok = await send("settle 0.10 BEFORE expiry", [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
  ixSettle({ settler: settler.publicKey, owner: owner.publicKey, cardId, amount: 100_000n, authHash: await authCommitment(tok1), merchantHash: merchant }),
], settler, [settler]);

// ── 3. wait past expiry (chain clock), settle again ─────────────────────────────────────────────
for (;;) {
  const now = await chainNow();
  if (now > expiry + 2n) break;
  console.log(`waiting: chain ${now} < expiry ${expiry} (+2 s)`);
  await sleep(15_000);
}
const tok2 = randomUUID();
const bad = await send("settle 0.10 AFTER expiry (expected onchain failure)", [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
  ixSettle({ settler: settler.publicKey, owner: owner.publicKey, cardId, amount: 100_000n, authHash: await authCommitment(tok2), merchantHash: merchant }),
], settler, [settler], true);

// ── 4. cleanup: refund the pre-expiry settle ─────────────────────────────────────────────────────
const refund = ok.err ? null : await send("cleanup refund of the 0.10", [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
  ixRefund({ settler: settler.publicKey, owner: owner.publicKey, cardId, amount: 100_000n, authHash: await authCommitment(tok1) }),
], settler, [settler]);

const custom = (bad.err as { InstructionError?: [number, { Custom?: number }] } | null)?.InstructionError?.[1]?.Custom ?? null;
console.log(JSON.stringify({
  label: "DEVNET free-trial expiry proof (no Lithic)", rpc: rpcLabel(rpcUrl), owner: owner.publicKey.toBase58(), card_pda: pda.toBase58(), card_id: cardId.toString(),
  owner_ata: usdcAta(owner.publicKey).toBase58(), expiry_ts: expiry.toString(), expiry_iso: new Date(Number(expiry) * 1000).toISOString(),
  setup: { sig: setup.sig, explorer: explorerTx(setup.sig) },
  settle_before: { sig: ok.sig, err: ok.err, block_time: ok.blockTime, explorer: explorerTx(ok.sig) },
  settle_after: { sig: bad.sig, err: bad.err, block_time: bad.blockTime, custom_code: custom, logs: bad.logs, explorer: explorerTx(bad.sig) },
  refund: refund ? { sig: refund.sig, err: refund.err, explorer: explorerTx(refund.sig) } : null,
  pass: ok.err === null && custom === 128,
}, null, 2));
process.exit(0);
