// G0.3 — Card A backed by a normal devnet keypair wallet (card-a-owner).
//   1) create Stripe virtual card with crypto_wallet{solana,usdc,standard,address=owner}
//   2) SPL approve 10 USDC from owner's USDC ATA → Bridge issuer delegate PDA
//   3) simulate a $1.14 authorization; poll crypto_transactions for the onchain hash
//   4) verify the pull on devnet (USDC left THIS ATA)
// G0.3b (--revoke-test): revoke the delegate, simulate again → expect decline and no pull.
//   This is the empirical basis for SolSend's freeze/expire design: only an onchain
//   revoke removes spending power; program-side flags do not stop an SPL delegate.
import { createApproveInstruction, createRevokeInstruction } from "@solana/spl-token";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { poll, record, saveState, stateStr } from "./lib/evidence.js";
import {
  cardSummary, confirmedHashes, createCryptoCard, failedCrypto, getAuthorizationWithCrypto, simulateAuthorization,
} from "./lib/providers.js";
import {
  describeUsdcTx, devnet, explorerTx, fmtUsdc, issuerDelegate, knownSignatures, loadKeypair, send, tokenState, usdcAta,
} from "./lib/solana.js";

const APPROVE_BASE = 10_000_000n; // 10 USDC
const AUTH_CENTS = 114; // $1.14

const conn = await devnet();
const owner = loadKeypair("card-a-owner");
const ata = usdcAta(owner.publicKey);
const delegate = issuerDelegate(ata);
const ich = stateStr("stripeCardholderId");
if (!ich) throw new Error("No stripeCardholderId — run g02:customer first.");

const before = await tokenState(conn, ata);
const sol = (await conn.getBalance(owner.publicKey)) / LAMPORTS_PER_SOL;
record("g03", "preflight", {
  owner: owner.publicKey.toBase58(), usdc_ata: ata.toBase58(), expected_delegate: delegate.toBase58(),
  usdc: fmtUsdc(before.amount), sol, current_delegate: before.delegate,
});
if (!before.exists || before.amount < APPROVE_BASE) throw new Error(`card-a-owner needs ≥10 devnet USDC in ${ata.toBase58()} (Circle faucet).`);
if (sol < 0.01) throw new Error("card-a-owner needs a little devnet SOL for fees.");

async function approve(amount: bigint, label: string) {
  const res = await send(conn, [createApproveInstruction(ata, delegate, owner.publicKey, amount)], [owner]);
  const st = await tokenState(conn, ata);
  record("g03", label, { ...res, explorer: explorerTx(res.signature), delegate: st.delegate, delegated: fmtUsdc(st.delegatedAmount), delegate_matches_expected: st.delegate === delegate.toBase58() });
  return res;
}

async function authorizeAndTrace(cardId: string, label: string) {
  const known = await knownSignatures(conn, ata);
  const t0 = Date.now();
  const auth = await simulateAuthorization(cardId, AUTH_CENTS, label);
  record("g03", `${label}_auth_created`, {
    authorization_id: auth.id, approved: auth.approved, status: auth.status, amount: auth.amount,
    request_history: (auth.request_history ?? []).map((r: any) => ({ approved: r.approved, reason: r.reason, reason_message: r.reason_message ?? null })),
  });
  if (!auth.approved) return { auth, hash: undefined };

  const traced = await poll(`${label} crypto hash`, async () => {
    const { auth: a, versionUsed } = await getAuthorizationWithCrypto(auth.id);
    const hashes = confirmedHashes(a);
    const failed = failedCrypto(a);
    if (hashes.length || failed.length) return { a, versionUsed, hashes, failed };
    return undefined;
  }, { intervalMs: 2000, timeoutMs: 5 * 60_000 });

  if (!traced) {
    record("g03", `${label}_no_crypto_tx`, { authorization_id: auth.id, waited_s: Math.round((Date.now() - t0) / 1000) });
    return { auth, hash: undefined };
  }
  const elapsed = Math.round((Date.now() - t0) / 1000);
  if (traced.failed.length) record("g03", `${label}_crypto_failed`, { authorization_id: auth.id, failed: traced.failed });
  const hash = traced.hashes[0];
  if (!hash) return { auth, hash: undefined };
  const onchain = await describeUsdcTx(conn, hash);
  const mine = onchain.usdcDeltas.find((d) => d.tokenAccount === ata.toBase58());
  const after = await tokenState(conn, ata);
  record("g03", `${label}_onchain_pull`, {
    authorization_id: auth.id, stripe_version_with_crypto_fields: traced.versionUsed, seconds_auth_to_hash: elapsed,
    ...onchain, card_a_ata_delta: mine?.delta ?? "0 (ATA not in tx!)",
    pulled_from_card_a_ata: mine ? BigInt(mine.delta) < 0n : false,
    sig_was_new_for_ata: !known.has(hash),
    delegated_remaining: fmtUsdc(after.delegatedAmount),
  });
  return { auth, hash };
}

// ── main flow ───────────────────────────────────────────────────────────────
let cardId = stateStr("cardAId");
if (!cardId) {
  const { card, attempts } = await createCryptoCard(ich, owner.publicKey.toBase58(), "card-a");
  record("g03", "create_card", { attempts, card: card ? cardSummary(card) : null });
  if (!card) { record("g03", "FAIL", { reason: "Stripe rejected crypto_wallet card creation" }); process.exit(1); }
  cardId = card.id as string;
  saveState({ cardAId: cardId });
}

if (process.argv.includes("--revoke-test")) {
  const rv = await send(conn, [createRevokeInstruction(ata, owner.publicKey)], [owner]);
  const st = await tokenState(conn, ata);
  record("g03b", "revoked", { ...rv, explorer: explorerTx(rv.signature), delegate_after: st.delegate });
  const { auth, hash } = await authorizeAndTrace(cardId, "g03b_after_revoke");
  record("g03b", auth.approved || hash ? "FAIL_still_spendable" : "PASS_declined_after_revoke", {
    authorization_id: auth.id, approved: auth.approved, onchain_hash: hash ?? null,
  });
  await approve(APPROVE_BASE, "reapproved_for_g06");
  process.exit(0);
}

const st = await tokenState(conn, ata);
if (st.delegate !== delegate.toBase58() || st.delegatedAmount < 1_000_000n) await approve(APPROVE_BASE, "approved");
const { auth, hash } = await authorizeAndTrace(cardId, "card_a");
saveState({ cardAAuthId: auth.id, cardAPullSig: hash ?? null });
record("g03", hash ? "PASS" : "FAIL", { card_id: cardId, authorization_id: auth.id, onchain_signature: hash ?? null, explorer: hash ? explorerTx(hash) : null });
