// Shared helpers for the W1 devnet scripts (init-devnet.ts, smoke-devnet.ts).
//
// Module resolution: scripts/program is not a pnpm workspace package, so @solana/* are loaded
// through packages/shared (createRequire anchored at its package.json). @solana/web3.js has no
// "exports" map, so Node resolves its CJS `main` for both require and import — the scripts and
// the @solsend/shared builders therefore share ONE web3.js instance.
//
// Secrets: SOLANA_RPC_URL (tokenized QuickNode URL) is read in-process from spikes/.env and never
// printed. Keypairs are read from ~/.config/solsend/devnet/ and never printed.
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type * as Web3 from "../../packages/shared/node_modules/@solana/web3.js";
import type * as SplToken from "../../packages/shared/node_modules/@solana/spl-token";
import {
  ALLOWANCES_PROGRAM_ID, DEVNET_GENESIS_HASH, SOLSEND_PROGRAM_ID, USDC_MINT, allowancesEventAuthority, buildSolsendIx, cardDelegation, cardPda, configPda,
  decodeSolsendEventsFromLogs, label32, subscriptionAuthorityPda, toHex, treasuryAta, treasuryPda, usdcAta, utf8,
} from "../../packages/shared/src/index.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sharedRequire = createRequire(path.join(ROOT, "packages/shared/package.json"));
export const web3: typeof Web3 = sharedRequire("@solana/web3.js");
export const spl: typeof SplToken = sharedRequire("@solana/spl-token");

export type Ix = Web3.TransactionInstruction;

export const KEY_DIR = path.join(homedir(), ".config/solsend/devnet");
export const PUBLIC_DEVNET = "https://api.devnet.solana.com";
export const STATE_DIR = path.join(ROOT, "target/devnet"); // gitignored scratch state

export function loadKeypair(name: string): Web3.Keypair {
  const file = path.join(KEY_DIR, `${name}.json`);
  return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8")) as number[]));
}

/** Minimal dotenv parser (KEY=VALUE, optional quotes). Values are returned, never logged. */
function parseEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(raw);
    if (!m) continue;
    let v = m[2]!;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]!] = v;
  }
  return out;
}

/** spikes/.env of this checkout, or of the main checkout when running inside an agent worktree. */
function envFileCandidates(): string[] {
  const c = [process.env.SOLSEND_ENV_FILE, path.join(ROOT, "spikes/.env")];
  const wt = ROOT.split(`${path.sep}.claude${path.sep}worktrees${path.sep}`);
  if (wt.length === 2) c.push(path.join(wt[0]!, "spikes/.env"));
  return c.filter((x): x is string => !!x);
}

export async function connect(): Promise<{ connection: Web3.Connection; rpcLabel: string }> {
  let url = process.env.SOLANA_RPC_URL;
  let rpcLabel = url ? "SOLANA_RPC_URL (env)" : "";
  if (!url) {
    for (const f of envFileCandidates()) {
      if (!existsSync(f)) continue;
      const v = parseEnv(f).SOLANA_RPC_URL;
      if (v) {
        url = v;
        rpcLabel = "SOLANA_RPC_URL (spikes/.env, QuickNode)";
        break;
      }
    }
  }
  if (!url) {
    url = PUBLIC_DEVNET;
    rpcLabel = "public devnet (fallback)";
  }
  const connection = new web3.Connection(url, { commitment: "confirmed" });
  let genesis: string;
  try {
    genesis = await connection.getGenesisHash();
  } catch {
    // never echo the (tokenized) URL in an error
    throw new Error(`RPC ${rpcLabel} unreachable`);
  }
  if (genesis !== DEVNET_GENESIS_HASH) throw new Error(`RPC ${rpcLabel} is not devnet (genesis ${genesis})`);
  return { connection, rpcLabel };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type SentTx = {
  signature: string;
  ok: boolean;
  err: unknown;
  slot: number | null;
  computeUnits: number | null;
  fee: number | null;
  logs: string[];
  events: { name: string; data: Record<string, unknown> }[];
};

/**
 * Sign, send and confirm (confirmed). `expectFailure` sends with skipPreflight so a policy
 * rejection still lands onchain as a real failed transaction with a signature (evidence).
 */
export async function sendTx(
  connection: Web3.Connection,
  ixs: Web3.TransactionInstruction[],
  feePayer: Web3.Keypair,
  signers: Web3.Keypair[] = [],
  opts: { expectFailure?: boolean } = {},
): Promise<SentTx> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new web3.Transaction({ feePayer: feePayer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  const uniq = new Map<string, Web3.Keypair>();
  for (const k of [feePayer, ...signers]) uniq.set(k.publicKey.toBase58(), k);
  tx.sign(...uniq.values());
  const raw = tx.serialize();
  const signature = await connection.sendRawTransaction(raw, { skipPreflight: !!opts.expectFailure, maxRetries: 5 });
  const conf = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  let info: Web3.VersionedTransactionResponse | null = null;
  for (let i = 0; i < 20 && !info; i++) {
    info = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!info) await sleep(500);
  }
  const logs = info?.meta?.logMessages ?? [];
  const err = info?.meta?.err ?? conf.value.err ?? null;
  return {
    signature,
    ok: err === null,
    err,
    slot: info?.slot ?? null,
    computeUnits: info?.meta?.computeUnitsConsumed ?? null,
    fee: info?.meta?.fee ?? null,
    logs,
    events: decodeSolsendEventsFromLogs(logs),
  };
}

/** JSON-safe view of decoded values (bigint → string, PublicKey → base58, bytes → hex). */
export function plain(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return toHex(v);
  if (v && typeof v === "object" && "toBase58" in v && typeof (v as { toBase58: unknown }).toBase58 === "function")
    return (v as Web3.PublicKey).toBase58();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

export const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

export async function tokenBalance(connection: Web3.Connection, ata: Web3.PublicKey): Promise<bigint | null> {
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (!info) return null;
  return spl.unpackAccount(ata, info).amount;
}

// ── Current-contract builders (program "Upgrade 1" IDL) ─────────────────────
// packages/shared's high-level wrappers predate Upgrade 1 (record seeds, register_card's merchant_lock,
// initialize_config's program/program_data). Until the lead updates them, these build the same
// instructions with the shared IDL codec (`buildSolsendIx`), so encoding still comes from the IDL.
const BPF_LOADER_UPGRADEABLE = new web3.PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const pda = (seeds: Uint8Array[], program: Web3.PublicKey) => web3.PublicKey.findProgramAddressSync(seeds, program)[0];

/** SettlementRecord PDA = ["settle", auth_hash] (no card): one pull per authorization across all cards. */
export const settlementRecordPdaV2 = (authHash: Uint8Array) => pda([utf8("settle"), authHash], SOLSEND_PROGRAM_ID);
/** The SolSend ProgramData account (initialize_config front-run guard). */
export const programDataPda = () => pda([SOLSEND_PROGRAM_ID.toBytes()], BPF_LOADER_UPGRADEABLE);

export function ixInitializeConfigV2(p: { admin: Web3.PublicKey; settlementAuthority: Web3.PublicKey; treasuryDestination: Web3.PublicKey; perTxMax: bigint; idleSecs: bigint }) {
  return buildSolsendIx("initialize_config",
    { args: { settlementAuthority: p.settlementAuthority, treasuryDestination: p.treasuryDestination, perTxMax: p.perTxMax, idleSecs: p.idleSecs } },
    { admin: p.admin, config: configPda(), treasury: treasuryPda(), usdcMint: USDC_MINT, systemProgram: web3.SystemProgram.programId,
      program: SOLSEND_PROGRAM_ID, programData: programDataPda() });
}

/** `merchantLock` all zeros (default) = lock on first settle; non-zero = pre-locked at registration. */
export function ixRegisterCardV2(p: { owner: Web3.PublicKey; payer: Web3.PublicKey; cardId: bigint; kind: number; label: string; merchantLock?: Uint8Array }) {
  return buildSolsendIx("register_card",
    { cardId: p.cardId, kind: p.kind, delegationNonce: p.cardId, label: label32(p.label), merchantLock: p.merchantLock ?? new Uint8Array(32) },
    { owner: p.owner, payer: p.payer, config: configPda(), card: cardPda(p.owner, p.cardId), delegation: cardDelegation(p.owner, p.cardId),
      ownerAta: usdcAta(p.owner), usdcMint: USDC_MINT, systemProgram: web3.SystemProgram.programId });
}

export function ixSettleV2(p: { settler: Web3.PublicKey; owner: Web3.PublicKey; cardId: bigint; amount: bigint; authHash: Uint8Array; merchantHash: Uint8Array }) {
  return buildSolsendIx("settle",
    { amount: p.amount, authHash: p.authHash, merchantHash: p.merchantHash },
    { settlementAuthority: p.settler, config: configPda(), card: cardPda(p.owner, p.cardId), settlementRecord: settlementRecordPdaV2(p.authHash),
      delegation: cardDelegation(p.owner, p.cardId), subscriptionAuthority: subscriptionAuthorityPda(p.owner), sourceTokenAccount: usdcAta(p.owner),
      treasury: treasuryPda(), treasuryAta: treasuryAta(), usdcMint: USDC_MINT, eventAuthority: allowancesEventAuthority(),
      allowancesProgram: ALLOWANCES_PROGRAM_ID, tokenProgram: spl.TOKEN_PROGRAM_ID, associatedTokenProgram: spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: web3.SystemProgram.programId });
}

export function ixRefundV2(p: { settler: Web3.PublicKey; owner: Web3.PublicKey; cardId: bigint; amount: bigint; authHash: Uint8Array }) {
  return buildSolsendIx("refund", { amount: p.amount, authHash: p.authHash },
    { settlementAuthority: p.settler, config: configPda(), card: cardPda(p.owner, p.cardId), settlementRecord: settlementRecordPdaV2(p.authHash),
      sourceTokenAccount: usdcAta(p.owner), treasury: treasuryPda(), treasuryAta: treasuryAta(), usdcMint: USDC_MINT, tokenProgram: spl.TOKEN_PROGRAM_ID });
}
