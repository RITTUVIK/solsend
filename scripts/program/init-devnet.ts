// Idempotent devnet initialisation of the deployed SolSend program, using ONLY @solsend/shared
// builders for SolSend instructions (this also proves the TS builders against the real program).
//
//   npx tsx scripts/program/init-devnet.ts
//
// 1. treasury PDA's USDC ATA          (created if missing)
// 2. admin (deployer) USDC ATA        (= config.treasury_destination; created if missing)
// 3. initialize_config                (admin = deployer, settlement authority, per_tx_max, idle_secs)
// 4. fee payer SOL top-up to 0.6 SOL  (from the deployer)
// Writes target/devnet/w1-init.json (gitignored) for the evidence writer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  SOLSEND_PROGRAM_ID, USDC_MINT, configPda, decodeConfig, ixInitializeConfig, ixSetSettlementAuthority, treasuryAta, treasuryPda, usdcAta,
} from "../../packages/shared/src/index.js";
import { STATE_DIR, connect, explorer, loadKeypair, plain, sendTx, spl, web3 } from "./lib.js";

const EXPECTED = {
  settlementAuthority: "eLqvkHwL9KCuk9ZgLUVXSLo3cn6ybH8MTiYGXe3DzUu",
  feePayer: "3dQxfxtUXJrNXXApsByeRy8pB7gHQpZfHxVruy2S3r7m",
  admin: "peENpfyrTzWyHejccTYto9Jg46UjqKfEaK3ye5xaP8L",
  usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};
const PER_TX_MAX = 1_000_000_000n; // 1000 USDC
const IDLE_SECS = 2_592_000n; // 30 days
const FEE_PAYER_TARGET_LAMPORTS = 600_000_000; // 0.6 SOL

async function main() {
  const { connection, rpcLabel } = await connect();
  console.log(`rpc: ${rpcLabel} (devnet genesis verified)`);
  const admin = loadKeypair("deployer");
  const settler = loadKeypair("settlement-authority").publicKey;
  const feePayer = loadKeypair("fee-payer").publicKey;
  if (admin.publicKey.toBase58() !== EXPECTED.admin) throw new Error("deployer key mismatch");
  if (settler.toBase58() !== EXPECTED.settlementAuthority) throw new Error("settlement-authority key mismatch");
  if (feePayer.toBase58() !== EXPECTED.feePayer) throw new Error("fee-payer key mismatch");
  if (USDC_MINT.toBase58() !== EXPECTED.usdcMint) throw new Error("USDC mint mismatch");

  const prog = await connection.getAccountInfo(SOLSEND_PROGRAM_ID);
  if (!prog?.executable) throw new Error(`program ${SOLSEND_PROGRAM_ID.toBase58()} is not deployed`);

  const steps: Record<string, unknown>[] = [];
  const treasury = treasuryPda();
  const tAta = treasuryAta();
  const adminAta = usdcAta(admin.publicKey);

  // 1 + 2. ATAs (idempotent create)
  for (const [label, ata, owner] of [["treasury ATA", tAta, treasury], ["admin USDC ATA (treasury_destination)", adminAta, admin.publicKey]] as const) {
    if (await connection.getAccountInfo(ata)) {
      console.log(`${label}: exists ${ata.toBase58()}`);
      steps.push({ step: label, address: ata.toBase58(), action: "exists" });
      continue;
    }
    const ix = spl.createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, owner, USDC_MINT);
    const r = await sendTx(connection, [ix], admin);
    if (!r.ok) throw new Error(`${label} failed: ${JSON.stringify(r.err)}`);
    console.log(`${label}: created ${ata.toBase58()}  ${explorer(r.signature)}`);
    steps.push({ step: label, address: ata.toBase58(), action: "created", signature: r.signature });
  }

  // 3. config
  const cfgAddr = configPda();
  let cfgInfo = await connection.getAccountInfo(cfgAddr);
  if (!cfgInfo) {
    const ix = ixInitializeConfig({ admin: admin.publicKey, settlementAuthority: settler, treasuryDestination: adminAta, perTxMax: PER_TX_MAX, idleSecs: IDLE_SECS });
    const r = await sendTx(connection, [ix], admin);
    if (!r.ok) throw new Error(`initialize_config failed: ${JSON.stringify(r.err)} ${r.logs.slice(-5).join(" | ")}`);
    console.log(`initialize_config: ${explorer(r.signature)}  CU ${r.computeUnits}`);
    steps.push({ step: "initialize_config", action: "created", signature: r.signature, computeUnits: r.computeUnits, events: r.events });
    cfgInfo = await connection.getAccountInfo(cfgAddr);
  } else {
    console.log(`config: exists ${cfgAddr.toBase58()}`);
    steps.push({ step: "initialize_config", action: "exists" });
  }
  let cfg = decodeConfig(cfgInfo!.data);
  if (!cfg) throw new Error("config account does not decode");
  if (!cfg.admin.equals(admin.publicKey)) throw new Error(`config.admin is ${cfg.admin.toBase58()}, not the deployer (front-run?)`);
  if (!cfg.settlementAuthority.equals(settler)) {
    const r = await sendTx(connection, [ixSetSettlementAuthority(admin.publicKey, settler)], admin);
    if (!r.ok) throw new Error(`set_settlement_authority failed: ${JSON.stringify(r.err)}`);
    console.log(`set_settlement_authority: ${explorer(r.signature)}`);
    steps.push({ step: "set_settlement_authority", signature: r.signature, events: r.events });
    cfg = decodeConfig((await connection.getAccountInfo(cfgAddr))!.data)!;
  }
  const problems = [
    !cfg.usdcMint.equals(USDC_MINT) && "usdc_mint",
    !cfg.treasuryDestination.equals(adminAta) && "treasury_destination",
    cfg.perTxMax !== PER_TX_MAX && "per_tx_max",
    cfg.idleSecs !== IDLE_SECS && "idle_secs",
    cfg.paused && "paused",
  ].filter(Boolean);
  if (problems.length) console.warn(`WARNING config differs from the expected init values: ${problems.join(", ")}`);

  // 4. fee payer top-up
  const fpBefore = await connection.getBalance(feePayer, "confirmed");
  let topUp: Record<string, unknown> = { step: "fee payer top-up", before: fpBefore, action: "none" };
  if (fpBefore < FEE_PAYER_TARGET_LAMPORTS) {
    const lamports = FEE_PAYER_TARGET_LAMPORTS - fpBefore;
    const r = await sendTx(connection, [web3.SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: feePayer, lamports })], admin);
    if (!r.ok) throw new Error(`top-up failed: ${JSON.stringify(r.err)}`);
    const after = await connection.getBalance(feePayer, "confirmed");
    console.log(`fee payer top-up: +${lamports / 1e9} SOL → ${after / 1e9} SOL  ${explorer(r.signature)}`);
    topUp = { step: "fee payer top-up", action: "sent", before: fpBefore, lamports, after, signature: r.signature };
  } else console.log(`fee payer: ${fpBefore / 1e9} SOL (≥ 0.6, no top-up)`);
  steps.push(topUp);

  const summary = {
    at: new Date().toISOString(),
    rpc: rpcLabel,
    programId: SOLSEND_PROGRAM_ID.toBase58(),
    config: cfgAddr.toBase58(),
    treasury: treasury.toBase58(),
    treasuryAta: tAta.toBase58(),
    treasuryDestination: adminAta.toBase58(),
    admin: cfg.admin.toBase58(),
    settlementAuthority: cfg.settlementAuthority.toBase58(),
    usdcMint: cfg.usdcMint.toBase58(),
    perTxMax: cfg.perTxMax.toString(),
    idleSecs: cfg.idleSecs.toString(),
    paused: cfg.paused,
    deployerBalanceSol: (await connection.getBalance(admin.publicKey, "confirmed")) / 1e9,
    steps,
  };
  // keep the signatures of the run that actually created each account (re-runs only report "exists")
  const stateFile = path.join(STATE_DIR, "w1-init.json");
  const prev = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, "utf8")) as { steps?: Record<string, unknown>[] }) : {};
  for (const st of steps) {
    const old = prev.steps?.find((p) => p.step === st.step && p.signature);
    if (!st.signature && old) Object.assign(st, { ...old, action: `${String(old.action ?? "sent").replace(/ \(earlier run\)$/, "")} (earlier run)` });
  }
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(plain(summary), null, 2));
  console.log(JSON.stringify({ ...summary, steps: undefined }, null, 2));
}

main().catch((e) => {
  console.error(`init-devnet FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
