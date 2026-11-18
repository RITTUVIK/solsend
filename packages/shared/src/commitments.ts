// CP1 CONTRACT (security review, amendment 1) — onchain commitments instead of plaintext identifiers.
// The Lithic transaction token is NEVER published onchain. Settles carry
//   auth_hash     = sha256(utf8("solsend:auth:v1:" + lithicToken))
//   merchant_hash = sha256(utf8("solsend:merchant:v1:" + (acceptor_id || descriptor)))
// Lithic tokens are UUIDv4 (122 random bits) → auth_hash is hiding to the public and verifiable by anyone
// who holds the token (the cardholder, Lithic, us). merchant_hash is a pseudonym, NOT hiding (merchant
// ids are low-entropy/public); it only needs equality for the onchain merchant lock.
import { toHex, utf8 } from "./bytes.js";

export const AUTH_COMMITMENT_DOMAIN = "solsend:auth:v1:";
export const MERCHANT_COMMITMENT_DOMAIN = "solsend:merchant:v1:";

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data as BufferSource));
}
export const authCommitment = (lithicToken: string) => {
  if (!lithicToken) throw new Error("empty lithic token");
  return sha256(utf8(AUTH_COMMITMENT_DOMAIN + lithicToken));
};
export const merchantCommitment = (merchantId: string) => {
  if (!merchantId) throw new Error("empty merchant id");
  return sha256(utf8(MERCHANT_COMMITMENT_DOMAIN + merchantId));
};
export const authCommitmentHex = async (lithicToken: string) => toHex(await authCommitment(lithicToken));
