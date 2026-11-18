// Server-built transactions → user signs (Privy) → server cosigns as fee payer and sends (CP0b G0.8).
// The fee payer cosigns ONLY when ALL hold (docs/TRUST.md "Fee payer"):
//   - the signed message is BYTE-IDENTICAL to the stored intent (sha256 of the raw message bytes, sliced
//     straight from the wire — no re-serialization that could normalize a tampered message),
//   - the intent belongs to the caller, is unexpired and is consumed atomically (single use),
//   - the owner's ed25519 signature over those bytes verifies.
import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import { PublicKey, VersionedMessage, type Keypair, type Transaction } from "@solana/web3.js";
import { bytesToBase64, base64ToBytes, type TxIntentRow } from "@solsend/shared";
import { HttpError } from "../auth";
import type { Store } from "../store";

export const INTENT_TTL_MS = 2 * 60_000;
export type IntentKind = "create_card" | "wallet_setup" | "card_freeze" | "card_unfreeze" | "card_close" | "revoke_all";

export const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export async function createIntent(store: Store, p: { owner: string; kind: IntentKind; cardPda: string | null; tx: Transaction; nowMs: number }) {
  const message = p.tx.serializeMessage();
  const expiresAt = new Date(p.nowMs + INTENT_TTL_MS).toISOString();
  const row = await store.insertIntent({ owner_wallet: p.owner, kind: p.kind, card_pda: p.cardPda, message_sha256: sha256Hex(message), expires_at: expiresAt });
  const wire = p.tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return { intentId: row.id, txBase64: bytesToBase64(wire), expiresAt };
}

/** Wire format: shortvec(numSigs) ‖ numSigs×64 signature bytes ‖ message. */
export function splitWire(wire: Uint8Array): { numSigs: number; sigOffset: number; message: Uint8Array } {
  let n = 0, shift = 0, i = 0;
  for (;;) {
    if (i >= wire.length || i > 2) throw new HttpError(400, "malformed transaction", "bad_tx");
    const b = wire[i++]!;
    n |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  const sigOffset = i;
  if (n < 1 || wire.length < sigOffset + n * 64 + 4) throw new HttpError(400, "malformed transaction", "bad_tx");
  return { numSigs: n, sigOffset, message: wire.subarray(sigOffset + n * 64) };
}

export type VerifiedTx = { wire: Uint8Array; message: Uint8Array; sigOffset: number; signers: PublicKey[] };

/** PURE check of a user-signed tx against its intent. Throws HttpError (4xx) on any mismatch. */
export function verifySignedAgainstIntent(intent: TxIntentRow, signedTxBase64: string, p: { owner: string; feePayer: PublicKey; nowMs: number }): VerifiedTx {
  if (intent.owner_wallet !== p.owner) throw new HttpError(403, "intent belongs to another wallet", "forbidden");
  if (intent.consumed_at) throw new HttpError(409, "intent already used", "intent_consumed");
  if (Date.parse(intent.expires_at) <= p.nowMs) throw new HttpError(410, "intent expired; prepare again", "intent_expired");
  let wire: Uint8Array;
  try { wire = base64ToBytes(signedTxBase64); } catch { throw new HttpError(400, "malformed transaction", "bad_tx"); }
  if (wire.length > 1232) throw new HttpError(400, "transaction too large", "bad_tx");
  const { numSigs, sigOffset, message } = splitWire(wire);
  if (sha256Hex(message) !== intent.message_sha256) throw new HttpError(400, "transaction does not match the prepared intent", "intent_mismatch");
  let msg: VersionedMessage;
  try { msg = VersionedMessage.deserialize(message); } catch { throw new HttpError(400, "malformed transaction", "bad_tx"); }
  const required = msg.header.numRequiredSignatures;
  if (required !== numSigs) throw new HttpError(400, "signature count mismatch", "bad_tx");
  const signers = msg.staticAccountKeys.slice(0, required);
  if (!signers[0]?.equals(p.feePayer)) throw new HttpError(400, "fee payer mismatch", "bad_tx");
  const ownerKey = new PublicKey(p.owner);
  const ownerIdx = signers.findIndex((k) => k.equals(ownerKey));
  if (ownerIdx < 1) throw new HttpError(400, "owner is not a signer", "bad_tx");
  if (signers.some((k) => !k.equals(p.feePayer) && !k.equals(ownerKey))) throw new HttpError(400, "unexpected signer", "bad_tx");
  const ownerSig = wire.subarray(sigOffset + ownerIdx * 64, sigOffset + ownerIdx * 64 + 64);
  if (!nacl.sign.detached.verify(message, ownerSig, ownerKey.toBytes())) throw new HttpError(400, "owner signature invalid", "bad_signature");
  return { wire: Uint8Array.from(wire), message: Uint8Array.from(message), sigOffset, signers };
}

/** Add the fee-payer signature (slot 0) to a verified tx. Returns the full wire + base58 signature. */
export function cosign(v: VerifiedTx, feePayer: Keypair): { wire: Uint8Array; signatureBytes: Uint8Array } {
  if (!v.signers[0]!.equals(feePayer.publicKey)) throw new Error("fee payer mismatch");
  const sig = nacl.sign.detached(v.message, feePayer.secretKey);
  const wire = Uint8Array.from(v.wire);
  wire.set(sig, v.sigOffset);
  return { wire, signatureBytes: sig };
}

/** Load → verify → atomically consume. Consumption happens BEFORE sending, so an intent signs at most once. */
export async function takeIntent(store: Store, intentId: string, signedTxBase64: string, p: { owner: string; feePayer: PublicKey; nowMs: number }) {
  const intent = await store.getIntent(intentId);
  if (!intent) throw new HttpError(404, "unknown intent", "not_found");
  const verified = verifySignedAgainstIntent(intent, signedTxBase64, p);
  if (!(await store.consumeIntent(intent.id))) throw new HttpError(409, "intent already used or expired", "intent_consumed");
  return { intent, verified };
}
