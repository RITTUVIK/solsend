// G0.4 — Card B whose crypto_wallet[address] is a PDA of our throwaway Anchor program.
//   1) PDA = ["spike_card", authority, card_id_le] under the spike program (off-curve)
//   2) vault = ATA(PDA, USDC) (allowOwnerOffCurve), fund 3 USDC from card-a-owner
//   3) create Stripe card with crypto_wallet[address] = PDA   ← does Stripe/Bridge accept it?
//   4) program approve_issuer → invoke_signed SPL approve(vault → issuer delegate PDA)
//   5) simulate $1.14 auth; poll for onchain hash; verify USDC left the PDA vault
// Outcome decides the SolSend vault ownership model (PDA vs. fallback).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AnchorProvider, BN, Program, Wallet, type Idl } from "@anchor-lang/core";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { SPIKES_DIR, SPIKE_PROGRAM_ID, USDC_DECIMALS } from "./lib/env.js";
import { poll, record, saveState, stateStr } from "./lib/evidence.js";
import { cardSummary, confirmedHashes, createCryptoCard, failedCrypto, getAuthorizationWithCrypto, simulateAuthorization } from "./lib/providers.js";
import { MINT, describeUsdcTx, devnet, explorerAddr, explorerTx, fmtUsdc, issuerDelegate, loadKeypair, send, tokenState, usdcAta } from "./lib/solana.js";

const CARD_ID = 1n;
const FUND_BASE = 3_000_000n; // 3 USDC
const AUTH_CENTS = 114;

const conn = await devnet();
const programInfo = await conn.getAccountInfo(new PublicKey(SPIKE_PROGRAM_ID));
if (!programInfo?.executable) throw new Error("Spike program not deployed on devnet. Run: (cd pda_vault_spike && anchor deploy --provider.cluster devnet)");

const user = loadKeypair("card-a-owner"); // same human/cardholder as Card A, different wallet
const ich = stateStr("stripeCardholderId");
if (!ich) throw new Error("No stripeCardholderId — run g02:customer first.");

const idl = JSON.parse(readFileSync(join(SPIKES_DIR, "pda_vault_spike/target/idl/pda_vault_spike.json"), "utf8")) as Idl;
const provider = new AnchorProvider(conn, new Wallet(user), { commitment: "confirmed" });
const program = new Program(idl, provider);

const cardIdLe = Buffer.alloc(8);
cardIdLe.writeBigUInt64LE(CARD_ID);
const [pda] = PublicKey.findProgramAddressSync([Buffer.from("spike_card"), user.publicKey.toBuffer(), cardIdLe], new PublicKey(SPIKE_PROGRAM_ID));
const vault = usdcAta(pda);
const delegate = issuerDelegate(vault);
record("g04", "derived", {
  pda: pda.toBase58(), pda_on_curve: PublicKey.isOnCurve(pda.toBytes()), vault_ata: vault.toBase58(),
  expected_delegate: delegate.toBase58(), explorer_pda: explorerAddr(pda.toBase58()),
});

// 2) vault + funding
let v = await tokenState(conn, vault);
if (!v.exists || v.amount < FUND_BASE) {
  const userAta = usdcAta(user.publicKey);
  const res = await send(conn, [
    createAssociatedTokenAccountIdempotentInstruction(user.publicKey, vault, pda, MINT),
    createTransferCheckedInstruction(userAta, MINT, vault, user.publicKey, FUND_BASE - v.amount, USDC_DECIMALS),
  ], [user]);
  v = await tokenState(conn, vault);
  record("g04", "vault_funded", { ...res, explorer: explorerTx(res.signature), vault_balance: fmtUsdc(v.amount), vault_owner: v.owner });
}

// 3) Stripe card with PDA address
let cardId = stateStr("cardBId");
if (!cardId) {
  const { card, attempts } = await createCryptoCard(ich, pda.toBase58(), "card-b-pda");
  record("g04", "create_card_with_pda_address", { accepted: !!card, attempts, card: card ? cardSummary(card) : null });
  if (!card) { record("g04", "FAIL", { stage: "stripe_rejected_pda_address" }); process.exit(1); }
  cardId = card.id as string;
  saveState({ cardBId: cardId, cardBPda: pda.toBase58(), cardBVault: vault.toBase58() });
}

// 4) program-signed approval
if (v.delegate !== delegate.toBase58()) {
  const sig = await program.methods
    .approveIssuer!(new BN(CARD_ID.toString()), new BN(1), new BN(FUND_BASE.toString()))
    .accounts({ authority: user.publicKey, mint: MINT, issuerDelegate: delegate } as any)
    .rpc();
  v = await tokenState(conn, vault);
  record("g04", "program_approved_delegate", { signature: sig, explorer: explorerTx(sig), delegate: v.delegate, delegated: fmtUsdc(v.delegatedAmount), matches_expected: v.delegate === delegate.toBase58() });
}

// 5) simulate + trace
const t0 = Date.now();
const auth = await simulateAuthorization(cardId, AUTH_CENTS, "card_b_auth");
record("g04", "auth_created", {
  authorization_id: auth.id, approved: auth.approved, status: auth.status,
  request_history: (auth.request_history ?? []).map((r: any) => ({ approved: r.approved, reason: r.reason, reason_message: r.reason_message ?? null })),
});
let hash: string | undefined;
if (auth.approved) {
  const traced = await poll("card B crypto hash", async () => {
    const { auth: a, versionUsed } = await getAuthorizationWithCrypto(auth.id);
    const hashes = confirmedHashes(a);
    const failed = failedCrypto(a);
    return hashes.length || failed.length ? { versionUsed, hashes, failed } : undefined;
  }, { intervalMs: 2000, timeoutMs: 5 * 60_000 });
  if (traced?.failed.length) record("g04", "crypto_failed", { failed: traced.failed });
  hash = traced?.hashes[0];
  if (hash) {
    const onchain = await describeUsdcTx(conn, hash);
    const mine = onchain.usdcDeltas.find((d) => d.tokenAccount === vault.toBase58());
    record("g04", "onchain_pull", { authorization_id: auth.id, seconds_auth_to_hash: Math.round((Date.now() - t0) / 1000), ...onchain, pda_vault_delta: mine?.delta ?? "0 (vault not in tx!)" });
  }
}
saveState({ cardBAuthId: auth.id, cardBPullSig: hash ?? null });
record("g04", hash ? "PASS" : "FAIL", {
  card_id: cardId, authorization_id: auth.id, approved: auth.approved, onchain_signature: hash ?? null,
  decision: hash ? "vault_model=PDA" : "vault_model=fallback (see GATE0.md security audit)",
});
