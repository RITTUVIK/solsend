// CP1 CONTRACT — Solana Subscriptions & Allowances (De1egAFM…) builders and account readers.
// Layouts verified against the devnet binary in CP0b (S1, LiteSVM + devnet).
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ALLOWANCES_PROGRAM_ID, USDC_MINT } from "./constants.js";
import { concat, i64le, readI64, readU64, u64le } from "./bytes.js";
import { delegationPda, subscriptionAuthorityPda, usdcAta } from "./pda.js";

const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
const ix = (keys: ReturnType<typeof meta>[], data: Uint8Array) => new TransactionInstruction({ programId: ALLOWANCES_PROGRAM_ID, keys, data: data as Buffer });

/** ix 0. Sets the SA PDA as the owner ATA's single SPL delegate (u64::MAX). Optional trailing sponsor payer. */
export function ixInitSubscriptionAuthority(owner: PublicKey, payer?: PublicKey) {
  const keys = [meta(owner, true, true), meta(subscriptionAuthorityPda(owner), true), meta(USDC_MINT), meta(usdcAta(owner), true), meta(SystemProgram.programId), meta(TOKEN_PROGRAM_ID)];
  if (payer) keys.push(meta(payer, true, true));
  return ix(keys, Uint8Array.of(0));
}

/** ix 1. Fixed delegation: total cap `amount`, `expiryTs` 0 = none. */
export function ixCreateFixedDelegation(p: { owner: PublicKey; delegatee: PublicKey; nonce: bigint; amount: bigint; expiryTs: bigint; initId: bigint; payer?: PublicKey }) {
  const sa = subscriptionAuthorityPda(p.owner);
  const keys = [meta(p.owner, true, true), meta(sa), meta(delegationPda(sa, p.owner, p.delegatee, p.nonce), true), meta(p.delegatee), meta(SystemProgram.programId)];
  if (p.payer) keys.push(meta(p.payer, true, true));
  return ix(keys, concat(Uint8Array.of(1), u64le(p.nonce), u64le(p.amount), i64le(p.expiryTs), i64le(p.initId)));
}

/** ix 2. Recurring delegation: `amountPerPeriod` every `periodSecs` from `startTs` until `expiryTs`. */
export function ixCreateRecurringDelegation(p: { owner: PublicKey; delegatee: PublicKey; nonce: bigint; amountPerPeriod: bigint; periodSecs: bigint; startTs: bigint; expiryTs: bigint; initId: bigint; payer?: PublicKey }) {
  const sa = subscriptionAuthorityPda(p.owner);
  const keys = [meta(p.owner, true, true), meta(sa), meta(delegationPda(sa, p.owner, p.delegatee, p.nonce), true), meta(p.delegatee), meta(SystemProgram.programId)];
  if (p.payer) keys.push(meta(p.payer, true, true));
  return ix(keys, concat(Uint8Array.of(2), u64le(p.nonce), u64le(p.amountPerPeriod), u64le(p.periodSecs), i64le(p.startTs), i64le(p.expiryTs), i64le(p.initId)));
}

/** ix 3. Owner closes a delegation (works without SolSend — the user's escape hatch).
 *  If the delegation's rent was sponsored (header `payer` != owner — true for every SolSend card, sponsored by our fee
 *  payer), the devnet binary REQUIRES that sponsor as a writable `receiver` (rent goes back to it); otherwise it fails
 *  with Allowances 113 notEnoughAccountKeys (found by W1 on devnet). Pass `readDelegation(data).payer`. */
export const ixRevokeDelegation = (owner: PublicKey, delegation: PublicKey, receiver?: PublicKey) =>
  ix([meta(owner, true, true), meta(delegation, true), ...(receiver && !receiver.equals(owner) ? [meta(receiver, true)] : [])], Uint8Array.of(3));

// ── readers ─────────────────────────────────────────────────────────────────
/** SubscriptionAuthority: disc1 user32 mint32 payer32 bump1 initId8 */
export const readSaInitId = (data: Uint8Array): bigint => readI64(data, 98);

export type DelegationView =
  | { type: "fixed"; delegator: PublicKey; delegatee: PublicKey; payer: PublicKey; remaining: bigint; expiryTs: bigint }
  | { type: "recurring"; delegator: PublicKey; delegatee: PublicKey; payer: PublicKey; amountPerPeriod: bigint; pulledInPeriod: bigint; remainingInPeriod: bigint; currentPeriodStartTs: bigint; periodSecs: bigint; expiryTs: bigint };

/** Header: disc1 version1 bump1 delegator32 delegatee32 payer32 initId8 (107 bytes). Fixed = 187 bytes, Recurring = 211 bytes. */
export function readDelegation(data: Uint8Array): DelegationView | null {
  if (data.length < 179) return null;
  const delegator = new PublicKey(data.subarray(3, 35));
  const delegatee = new PublicKey(data.subarray(35, 67));
  const payer = new PublicKey(data.subarray(67, 99)); // rent sponsor → required `receiver` for revoke
  if (data.length >= 211) {
    const amountPerPeriod = readU64(data, 195);
    const pulledInPeriod = readU64(data, 203);
    return { type: "recurring", delegator, delegatee, payer, currentPeriodStartTs: readI64(data, 171), periodSecs: readU64(data, 179), expiryTs: readI64(data, 187),
      amountPerPeriod, pulledInPeriod, remainingInPeriod: amountPerPeriod > pulledInPeriod ? amountPerPeriod - pulledInPeriod : 0n };
  }
  return { type: "fixed", delegator, delegatee, payer, remaining: readU64(data, 171), expiryTs: readI64(data, 179) };
}
