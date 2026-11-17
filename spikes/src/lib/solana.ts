import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  type ParsedTransactionWithMeta,
  type TransactionInstruction,
} from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  DEVNET_GENESIS_HASH,
  ISSUER_MERCHANT_ID,
  ISSUER_PROGRAM_ID,
  KEYS_DIR,
  RPC_URL,
  USDC_MINT,
} from "./env.js";

export const MINT = new PublicKey(USDC_MINT);
export const ISSUER = new PublicKey(ISSUER_PROGRAM_ID);

let _conn: Connection | undefined;
export async function devnet(): Promise<Connection> {
  if (_conn) return _conn;
  const conn = new Connection(RPC_URL, "confirmed");
  const genesis = await conn.getGenesisHash();
  if (genesis !== DEVNET_GENESIS_HASH) {
    throw new Error(`Refusing to run: RPC genesis ${genesis} is not Solana devnet (hard rule 4).`);
  }
  _conn = conn;
  return conn;
}

export function loadKeypair(name: string): Keypair {
  const raw = JSON.parse(readFileSync(join(KEYS_DIR, `${name}.json`), "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

export function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

/** Bridge issuer delegate PDA: ["user_delegate", u64_le(merchant_id), mint, token_account]. */
export function issuerDelegate(tokenAccount: PublicKey, merchantId = ISSUER_MERCHANT_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_delegate"), u64le(merchantId), MINT.toBuffer(), tokenAccount.toBuffer()],
    ISSUER,
  )[0];
}

export function usdcAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(MINT, owner, /* allowOwnerOffCurve */ true);
}

export async function tokenState(conn: Connection, ata: PublicKey) {
  try {
    const a = await getAccount(conn, ata, "confirmed");
    return {
      exists: true,
      owner: a.owner.toBase58(),
      amount: a.amount,
      delegate: a.delegate?.toBase58() ?? null,
      delegatedAmount: a.delegatedAmount,
    };
  } catch {
    return { exists: false, owner: null, amount: 0n, delegate: null, delegatedAmount: 0n };
  }
}

export async function send(
  conn: Connection,
  ixs: TransactionInstruction[],
  signers: Keypair[],
): Promise<{ signature: string; slot: number; confirmedAt: string }> {
  const tx = new Transaction().add(...ixs);
  const signature = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
  const status = await conn.getSignatureStatus(signature);
  return { signature, slot: status.value?.slot ?? -1, confirmedAt: new Date().toISOString() };
}

export type UsdcDelta = { tokenAccount: string; owner: string | null; delta: bigint };

/** Per-token-account USDC balance deltas for a transaction. */
export function usdcDeltas(tx: ParsedTransactionWithMeta): UsdcDelta[] {
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
  const pre = new Map<number, { amt: bigint; owner: string | null }>();
  const post = new Map<number, { amt: bigint; owner: string | null }>();
  for (const b of tx.meta?.preTokenBalances ?? []) {
    if (b.mint === USDC_MINT) pre.set(b.accountIndex, { amt: BigInt(b.uiTokenAmount.amount), owner: b.owner ?? null });
  }
  for (const b of tx.meta?.postTokenBalances ?? []) {
    if (b.mint === USDC_MINT) post.set(b.accountIndex, { amt: BigInt(b.uiTokenAmount.amount), owner: b.owner ?? null });
  }
  const idx = new Set([...pre.keys(), ...post.keys()]);
  return [...idx].map((i) => ({
    tokenAccount: keys[i] ?? `#${i}`,
    owner: post.get(i)?.owner ?? pre.get(i)?.owner ?? null,
    delta: (post.get(i)?.amt ?? 0n) - (pre.get(i)?.amt ?? 0n),
  }));
}

export async function fetchParsedTx(conn: Connection, signature: string) {
  for (let i = 0; i < 20; i++) {
    const tx = await conn.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (tx) return tx;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`transaction ${signature} not found on devnet`);
}

/** Summarise an onchain pull/refund for evidence. */
export async function describeUsdcTx(conn: Connection, signature: string) {
  const tx = await fetchParsedTx(conn, signature);
  const programs = [...new Set(tx.transaction.message.instructions.map((ix) => ix.programId.toBase58()))];
  return {
    signature,
    explorer: explorerTx(signature),
    slot: tx.slot,
    blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    success: tx.meta?.err === null,
    topLevelPrograms: programs,
    invokesIssuerProgram: tx.meta?.logMessages?.some((l) => l.includes(ISSUER_PROGRAM_ID)) ?? false,
    usdcDeltas: usdcDeltas(tx).map((d) => ({ ...d, delta: d.delta.toString() })),
  };
}

/** Wait for the first new signature touching `address` that isn't in `known`. */
export async function waitForNewSignature(
  conn: Connection,
  address: PublicKey,
  known: Set<string>,
  { timeoutMs = 30 * 60_000, intervalMs = 2000 } = {},
): Promise<{ signature: string; seenAt: string } | undefined> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const sigs = await conn.getSignaturesForAddress(address, { limit: 20 }, "confirmed");
    const fresh = sigs.filter((s) => !known.has(s.signature) && s.err === null);
    if (fresh.length) return { signature: fresh[fresh.length - 1]!.signature, seenAt: new Date().toISOString() };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return undefined;
}

export async function knownSignatures(conn: Connection, address: PublicKey): Promise<Set<string>> {
  const sigs = await conn.getSignaturesForAddress(address, { limit: 100 }, "confirmed");
  return new Set(sigs.map((s) => s.signature));
}

export const fmtUsdc = (base: bigint) => `${(Number(base) / 1e6).toFixed(6)} USDC`;
