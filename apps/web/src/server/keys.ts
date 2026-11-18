// LEAD-OWNED. Server keypairs from env (JSON byte arrays). Never log, return, or serialize these.
import "server-only";
import { Connection, Keypair } from "@solana/web3.js";
import { DEVNET_GENESIS_HASH } from "@solsend/shared";
import { env, wsUrl } from "./env";

const parse = (name: string, raw: string): Keypair => {
  try {
    const arr = JSON.parse(raw) as number[];
    if (!Array.isArray(arr) || arr.length !== 64) throw new Error();
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  } catch {
    throw new Error(`${name} is not a 64-byte JSON keypair`);
  }
};

let settler: Keypair | null = null, feePayer: Keypair | null = null, faucet: Keypair | null = null;
export const settlementAuthority = () => (settler ??= parse("SETTLEMENT_AUTHORITY_SECRET_KEY", env().SETTLEMENT_AUTHORITY_SECRET_KEY));
export const feePayerKey = () => (feePayer ??= parse("FEE_PAYER_SECRET_KEY", env().FEE_PAYER_SECRET_KEY));
export const faucetKey = () => {
  const raw = env().DEMO_FAUCET_SECRET_KEY;
  if (!raw) throw new Error("DEMO_FAUCET_SECRET_KEY not configured");
  return (faucet ??= parse("DEMO_FAUCET_SECRET_KEY", raw));
};

let conn: Connection | null = null;
let genesisChecked: Promise<void> | null = null;
/** Shared devnet connection (warm instances reuse it). Call `assertDevnet()` once per cold start. */
export const connection = () => (conn ??= new Connection(env().SOLANA_RPC_URL, { commitment: "confirmed", wsEndpoint: wsUrl() }));
export const assertDevnet = () =>
  (genesisChecked ??= connection().getGenesisHash().then((g) => {
    if (g !== DEVNET_GENESIS_HASH) { genesisChecked = null; throw new Error("RPC is not Solana devnet"); }
  }));
