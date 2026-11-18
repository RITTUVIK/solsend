// CP0b / S3 diagnostic — is slow confirmation the NETWORK or the RPC?
// 10 real 1-cent settles on a dedicated test card, spaced out (rate-friendly). For each:
// send (skipPreflight) → websocket notifications for `processed` and `confirmed` → landing slot.
// Also records devnet's recent performance samples (slot time).
import { ComputeBudgetProgram, Transaction } from "@solana/web3.js";
import { optEnv, rpcLabel } from "./lib/env.js";
import { record } from "./lib/evidence.js";
import { devnet, loadKeypair } from "./lib/solana.js";
import { authHash, cardPda, ixCreateFixedDelegation, ixRegisterCard, ixSettle, saInitId } from "./lib/allowances.js";
import { sendAndConfirmTransaction } from "@solana/web3.js";

const conn = await devnet();
const owner = loadKeypair("card-a-owner");
const settler = loadKeypair("settlement-authority");
const N = Number(optEnv("DIAG_N") ?? 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const perf = await conn.getRecentPerformanceSamples(6);
const slotMs = perf.map((s) => Math.round((s.samplePeriodSecs * 1000) / Math.max(1, s.numSlots)));
const initId = (await saInitId(conn, owner.publicKey))!;
const cardId = BigInt(Date.now()) * 1000n + 7n;
await sendAndConfirmTransaction(conn, new Transaction().add(
  ixCreateFixedDelegation(owner.publicKey, cardPda(owner.publicKey, cardId), cardId, 200_000n, 0n, initId),
  ixRegisterCard(owner.publicKey, cardId, 0, cardId),
), [owner], { commitment: "confirmed" });

const rows: { processed_ms: number | null; confirmed_ms: number | null; land_slot: number | null; sent_slot: number }[] = [];
for (let i = 0; i < N; i++) {
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const sentSlot = await conn.getSlot("processed");
  const tx = new Transaction({ feePayer: settler.publicKey, recentBlockhash: blockhash }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 90_000 }),
    ixSettle(settler.publicKey, owner.publicKey, cardId, cardId, 10_000n, authHash(`diag-${cardId}-${i}`)),
  );
  tx.sign(settler);
  const t0 = performance.now();
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 2 });
  const at = (c: "processed" | "confirmed") => new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), 20_000);
    conn.onSignature(sig, () => { clearTimeout(timer); resolve(Math.round(performance.now() - t0)); }, c);
  });
  const [p, c] = await Promise.all([at("processed"), at("confirmed")]);
  const landed = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  rows.push({ processed_ms: p, confirmed_ms: c, land_slot: landed?.slot ?? null, sent_slot: sentSlot });
  await sleep(1500);
}
const conf = rows.map((r) => r.confirmed_ms).filter((x): x is number => x !== null).sort((a, b) => a - b);
const proc = rows.map((r) => r.processed_ms).filter((x): x is number => x !== null).sort((a, b) => a - b);
record("s3", "confirm_diagnostic", {
  label: "REAL devnet settles; websocket notifications", rpc: rpcLabel(),
  devnet_recent_slot_time_ms: slotMs, n: N,
  processed_ms: { p50: proc[Math.floor(proc.length / 2)], max: proc[proc.length - 1] },
  confirmed_ms: { p50: conf[Math.floor(conf.length / 2)], max: conf[conf.length - 1], min: conf[0] },
  slots_from_send_to_land: rows.map((r) => (r.land_slot !== null ? r.land_slot - r.sent_slot : null)), rows,
});
process.exit(0);
