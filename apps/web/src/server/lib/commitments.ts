// Onchain commitments (lead amendment 1, supersedes the plain sha256(token) in CP1 F4).
// MIRROR of packages/shared/src/commitments.ts (`authCommitment` / `merchantCommitment`, async WebCrypto)
// until that lands on feat/solsend-mvp. Strings MUST stay byte-identical to the shared version.
//   auth_hash     = sha256(utf8("solsend:auth:v1:" + lithicToken))      — hiding (token is a UUIDv4)
//   merchant_hash = sha256(utf8("solsend:merchant:v1:" + (acceptor_id || descriptor)))
import { createHash } from "node:crypto";
import { toHex } from "@solsend/shared";

export const AUTH_COMMITMENT_PREFIX = "solsend:auth:v1:";
export const MERCHANT_COMMITMENT_PREFIX = "solsend:merchant:v1:";

const sha256 = (s: string) => new Uint8Array(createHash("sha256").update(s, "utf8").digest());

/** 32-byte SettlementRecord seed / settle `auth_hash` for a Lithic transaction token. */
export const authCommitment = (lithicToken: string): Uint8Array => sha256(AUTH_COMMITMENT_PREFIX + lithicToken);
export const authCommitmentHex = (lithicToken: string): string => toHex(authCommitment(lithicToken));

/** Merchant identity used for the onchain merchant lock: card-network acceptor id, else the descriptor. */
export function merchantIdentity(m: { acceptor_id?: string | null; descriptor?: string | null } | undefined): string | null {
  const a = m?.acceptor_id?.trim();
  if (a) return a;
  const d = m?.descriptor?.trim();
  return d ? d : null;
}

export const merchantCommitment = (identity: string): Uint8Array => sha256(MERCHANT_COMMITMENT_PREFIX + identity);
