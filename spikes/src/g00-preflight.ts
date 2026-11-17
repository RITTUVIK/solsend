// G0.9 + preflight: tool versions, devnet guard, wallet balances, onchain fixtures.
import { execSync } from "node:child_process";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ISSUER_PROGRAM_ID, SPIKE_PROGRAM_ID, USDC_MINT, RPC_URL } from "./lib/env.js";
import { record } from "./lib/evidence.js";
import { devnet, loadKeypair, tokenState, usdcAta, fmtUsdc, explorerAddr } from "./lib/solana.js";

const sh = (cmd: string) => {
  try {
    return execSync(cmd, { encoding: "utf8", env: { ...process.env, NO_DNA: "1" } }).trim().split("\n")[0];
  } catch (e) {
    return `ERROR: ${(e as Error).message.split("\n")[0]}`;
  }
};

const conn = await devnet(); // throws unless genesis == devnet
const versions = {
  anchor: sh("anchor --version"),
  solana: sh("solana --version"),
  cargo_build_sbf: sh("cargo build-sbf --version"),
  rustc_host_toolchain_for_programs: sh("rustc +1.95.0 --version"),
  node: process.version,
  pnpm: sh("pnpm --version"),
  rpc: RPC_URL.replace(/\/[A-Za-z0-9]{16,}\/?$/, "/<redacted>"),
  devnet_genesis_verified: true,
};
record("g09", "versions", versions);
record("g09", "test_framework", {
  recommendation: "LiteSVM (Rust) — default `anchor init` test template in Anchor 1.2.2; Mollusk / mocha / jest available via --test-template",
  source: "anchor v1.2.2 docs/content/docs/installation.mdx (Anchor CLI Basics → Initialize Project)",
});

const wallets: Record<string, unknown> = {};
for (const name of ["deployer", "card-a-owner", "fee-payer"]) {
  const kp = loadKeypair(name);
  const ata = usdcAta(kp.publicKey);
  const sol = (await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL;
  const usdc = await tokenState(conn, ata);
  wallets[name] = {
    pubkey: kp.publicKey.toBase58(),
    sol,
    usdc_ata: ata.toBase58(),
    usdc: usdc.exists ? fmtUsdc(usdc.amount) : "no ATA",
    delegate: usdc.delegate,
  };
}
record("g00", "wallets", wallets);

const issuer = await conn.getAccountInfo(new PublicKey(ISSUER_PROGRAM_ID));
const spike = await conn.getAccountInfo(new PublicKey(SPIKE_PROGRAM_ID));
const mint = await conn.getParsedAccountInfo(new PublicKey(USDC_MINT));
record("g00", "onchain_fixtures", {
  issuer_program: { id: ISSUER_PROGRAM_ID, executable: issuer?.executable ?? false, explorer: explorerAddr(ISSUER_PROGRAM_ID) },
  spike_program: { id: SPIKE_PROGRAM_ID, deployed: spike?.executable ?? false },
  usdc_mint: { id: USDC_MINT, decimals: (mint.value?.data as any)?.parsed?.info?.decimals ?? null },
});
