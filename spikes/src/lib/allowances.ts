// Hand-built instructions for (a) the Solana Subscriptions & Allowances program
// (Codama IDL, numeric discriminators) and (b) our allowances_spike policy program
// (Anchor discriminators from target/idl). No SDK dependency on purpose: the ASA hot
// path must stay lean, and LiteSVM tests (S1a–S1x) already verified these layouts
// against the real devnet binary.
import { createHash } from "node:crypto";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { MINT, u64le } from "./solana.js";

export const ALLOWANCES = new PublicKey("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44");
export const POLICY = new PublicKey("8uSYgZn5rvEbrpc3NgQFvqcqMA7snptsmiey5457ddR9");
export const EVENT_IX_TAG = Buffer.from("e445a52e51cb9a1d", "hex");

const i64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(n); return b; };
const pda = (seeds: (Buffer | Uint8Array)[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];

export const subscriptionAuthority = (user: PublicKey) => pda([Buffer.from("SubscriptionAuthority"), user.toBuffer(), MINT.toBuffer()], ALLOWANCES);
export const delegationPda = (sa: PublicKey, delegator: PublicKey, delegatee: PublicKey, nonce: bigint) =>
  pda([Buffer.from("delegation"), sa.toBuffer(), delegator.toBuffer(), delegatee.toBuffer(), u64le(nonce)], ALLOWANCES);
export const eventAuthority = () => pda([Buffer.from("event_authority")], ALLOWANCES);
export const configPda = () => pda([Buffer.from("config")], POLICY);
export const treasuryPda = () => pda([Buffer.from("treasury")], POLICY);
export const treasuryAta = () => getAssociatedTokenAddressSync(MINT, treasuryPda(), true);
export const cardPda = (owner: PublicKey, cardId: bigint) => pda([Buffer.from("card"), owner.toBuffer(), u64le(cardId)], POLICY);
export const settleRecordPda = (card: PublicKey, authHash: Buffer) => pda([Buffer.from("settle"), card.toBuffer(), authHash], POLICY);
export const authHash = (lithicToken: string) => createHash("sha256").update(lithicToken).digest();

const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });

// ── Allowances program instructions ─────────────────────────────────────────
export function ixInitSubscriptionAuthority(owner: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ALLOWANCES,
    keys: [meta(owner, true, true), meta(subscriptionAuthority(owner), true), meta(MINT), meta(getAssociatedTokenAddressSync(MINT, owner), true),
      meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID)],
    data: Buffer.from([0]),
  });
}

export async function saInitId(conn: Connection, owner: PublicKey): Promise<bigint | null> {
  const acc = await conn.getAccountInfo(subscriptionAuthority(owner), "confirmed");
  return acc ? acc.data.readBigInt64LE(98) : null; // disc1 + user32 + mint32 + payer32 + bump1
}

export function ixCreateFixedDelegation(owner: PublicKey, delegatee: PublicKey, nonce: bigint, amount: bigint, expiryTs: bigint, initId: bigint) {
  const sa = subscriptionAuthority(owner);
  return new TransactionInstruction({
    programId: ALLOWANCES,
    keys: [meta(owner, true, true), meta(sa), meta(delegationPda(sa, owner, delegatee, nonce), true), meta(delegatee), meta(SystemProgram.programId)],
    data: Buffer.concat([Buffer.from([1]), u64le(nonce), u64le(amount), i64le(expiryTs), i64le(initId)]),
  });
}

export function ixRevokeDelegation(owner: PublicKey, delegation: PublicKey) {
  return new TransactionInstruction({ programId: ALLOWANCES, keys: [meta(owner, true, true), meta(delegation, true)], data: Buffer.from([3]) });
}

export function fixedRemaining(data: Buffer): bigint {
  return data.readBigUInt64LE(171); // header107 + sa32 + mint32
}

// ── Policy (allowances_spike) instructions ──────────────────────────────────
const DISC = {
  initialize_config: [208, 127, 21, 1, 194, 190, 196, 70],
  register_card: [33, 25, 154, 111, 155, 31, 45, 36],
  settle: [175, 42, 185, 87, 144, 131, 102, 212],
  freeze: [255, 91, 207, 84, 251, 194, 254, 63],
} as const;

export function ixInitializeConfig(admin: PublicKey, settlementAuthority: PublicKey) {
  return new TransactionInstruction({
    programId: POLICY,
    keys: [meta(admin, true, true), meta(configPda(), true), meta(treasuryPda()), meta(MINT), meta(SystemProgram.programId)],
    data: Buffer.concat([Buffer.from(DISC.initialize_config), settlementAuthority.toBuffer()]),
  });
}

export function ixRegisterCard(owner: PublicKey, cardId: bigint, kind: 0 | 1, nonce: bigint) {
  const card = cardPda(owner, cardId);
  const delegation = delegationPda(subscriptionAuthority(owner), owner, card, nonce);
  return new TransactionInstruction({
    programId: POLICY,
    keys: [meta(owner, true, true), meta(configPda()), meta(card, true), meta(delegation), meta(getAssociatedTokenAddressSync(MINT, owner)),
      meta(MINT), meta(SystemProgram.programId)],
    data: Buffer.concat([Buffer.from(DISC.register_card), u64le(cardId), Buffer.from([kind]), u64le(nonce)]),
  });
}

export function ixSettle(settler: PublicKey, owner: PublicKey, cardId: bigint, nonce: bigint, amount: bigint, hash: Buffer) {
  const card = cardPda(owner, cardId);
  const sa = subscriptionAuthority(owner);
  return new TransactionInstruction({
    programId: POLICY,
    keys: [
      meta(settler, true, true), meta(configPda()), meta(card, true), meta(settleRecordPda(card, hash), true),
      meta(delegationPda(sa, owner, card, nonce), true), meta(sa), meta(getAssociatedTokenAddressSync(MINT, owner), true),
      meta(treasuryPda()), meta(treasuryAta(), true), meta(MINT), meta(eventAuthority()), meta(ALLOWANCES),
      meta(TOKEN_PROGRAM_ID), meta(ASSOCIATED_TOKEN_PROGRAM_ID), meta(SystemProgram.programId),
    ],
    data: Buffer.concat([Buffer.from(DISC.settle), u64le(amount), hash]),
  });
}

/** Decode Allowances FixedTransferEvent (tag e445a52e51cb9a1d + 0x03) from inner-instruction data. */
export function decodeFixedTransferEvent(data: Buffer) {
  if (data.length < 9 + 32 * 4 + 16 + 64 || !data.subarray(0, 8).equals(EVENT_IX_TAG) || data[8] !== 0x03) return null;
  let o = 9;
  const pk = () => { const k = new PublicKey(data.subarray(o, o + 32)); o += 32; return k.toBase58(); };
  const u64 = () => { const v = data.readBigUInt64LE(o); o += 8; return v.toString(); };
  return { delegation: pk(), delegator: pk(), delegatee: pk(), mint: pk(), amount: u64(), remainingAmount: u64(), receiver: pk(), receiverTokenAccount: pk() };
}

export function ixRefund(settler: PublicKey, owner: PublicKey, cardId: bigint, amount: bigint, hash: Buffer) {
  const card = cardPda(owner, cardId);
  return new TransactionInstruction({
    programId: POLICY,
    keys: [meta(settler, false, true), meta(configPda()), meta(card, true), meta(settleRecordPda(card, hash), true),
      meta(getAssociatedTokenAddressSync(MINT, owner), true), meta(treasuryPda()), meta(treasuryAta(), true), meta(MINT), meta(TOKEN_PROGRAM_ID)],
    data: Buffer.concat([Buffer.from([2, 96, 183, 251, 63, 208, 46, 46]), u64le(amount), hash]),
  });
}

export function ixFreeze(owner: PublicKey, cardId: bigint) {
  return new TransactionInstruction({
    programId: POLICY,
    keys: [meta(owner, false, true), meta(cardPda(owner, cardId), true)],
    data: Buffer.from(DISC.freeze),
  });
}

/** SettlementRecord: disc8 + card32 + auth_hash32 + amount8 + refunded8 + bump1 */
export async function readSettlementRecord(conn: Connection, card: PublicKey, hash: Buffer) {
  const acc = await conn.getAccountInfo(settleRecordPda(card, hash), "confirmed");
  if (!acc) return null;
  return { amount: acc.data.readBigUInt64LE(72), refunded: acc.data.readBigUInt64LE(80) };
}

/** Batched SettlementRecord reads (chunked getMultipleAccounts) — avoids per-record RPC fan-out. */
export async function readSettlementRecords(conn: Connection, items: { card: PublicKey; hash: Buffer }[]) {
  const out: ({ amount: bigint; refunded: bigint } | null)[] = [];
  // QuickNode's free ("discover") plan limits getMultipleAccounts to 5 accounts per call
  // (error -32615); 5 also works on the public RPC. Small pause keeps us under 15 req/s.
  const CHUNK = Number(process.env.RPC_MULTI_ACCOUNTS_MAX ?? 5);
  for (let i = 0; i < items.length; i += CHUNK) {
    if (i > 0) await new Promise((r) => setTimeout(r, 120));
    const chunk = items.slice(i, i + CHUNK);
    const accs = await conn.getMultipleAccountsInfo(chunk.map((c) => settleRecordPda(c.card, c.hash)), "confirmed");
    for (const a of accs) out.push(a ? { amount: a.data.readBigUInt64LE(72), refunded: a.data.readBigUInt64LE(80) } : null);
  }
  return out;
}
