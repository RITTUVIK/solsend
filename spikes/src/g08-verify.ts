// CP0b / G0.8 — independent onchain verification of the Privy sponsored transaction.
// Does not trust the fee-payer server's log: re-reads the transaction from devnet and checks
// confirmation, fee payer, paid fee, signer set, ed25519 signatures, balances and programs.
// Usage: pnpm exec tsx src/g08-verify.ts <signature>
import { PublicKey, Transaction } from "@solana/web3.js";
import { rpcLabel } from "./lib/env.js";
import { record } from "./lib/evidence.js";
import { devnet, explorerTx, loadKeypair } from "./lib/solana.js";

const sig = process.argv[2]!;
const conn = await devnet();
const ourFeePayer = loadKeypair("fee-payer").publicKey.toBase58();

const status = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
if (!tx) throw new Error("transaction not found");
const msg = tx.transaction.message;
const keys = msg.getAccountKeys().staticAccountKeys.map((k) => k.toBase58());
const nSigners = msg.header.numRequiredSignatures;
const signers = keys.slice(0, nSigners);
const feePayer = keys[0]!;
const user = signers.find((k) => k !== feePayer) ?? null;
const idx = (k: string) => keys.indexOf(k);
const bal = (k: string | null) => (k && idx(k) >= 0 ? { pre: tx.meta!.preBalances[idx(k)]!, post: tx.meta!.postBalances[idx(k)]! } : null);

// ed25519 signature verification over the exact message bytes (legacy message → Transaction.populate)
const rebuilt = Transaction.populate(msg as never, tx.transaction.signatures);
const allSigsValid = rebuilt.verifySignatures(true);
const perSigner = rebuilt.signatures.map((s) => ({ signer: s.publicKey.toBase58(), present: !!s.signature }));

const programs = [...new Set(msg.compiledInstructions.map((i) => keys[i.programIdIndex]))];
const memoLine = (tx.meta?.logMessages ?? []).find((l) => l.startsWith("Program log: Memo")) ?? null;
const userNow = user ? await conn.getBalance(new PublicKey(user), "confirmed") : null;
const fp = bal(feePayer)!;
const ub = bal(user);

const checks = {
  confirmed_or_finalized: status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized",
  no_error: tx.meta?.err === null && status?.err === null,
  fee_payer_is_our_server_key: feePayer === ourFeePayer,
  fee_paid_by_fee_payer: fp.pre - fp.post === tx.meta!.fee,
  exactly_two_signers_fee_payer_and_user: nSigners === 2 && !!user,
  all_signatures_cryptographically_valid: allSigsValid,
  user_sol_unchanged_by_tx: ub !== null && ub.pre === ub.post,
  user_sol_balance_zero: userNow === 0,
  only_memo_program_invoked: programs.length === 1 && programs[0] === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
};
record("g08", Object.values(checks).every(Boolean) ? "independent_verification_PASS" : "independent_verification_FAIL", {
  signature: sig, explorer: explorerTx(sig), rpc: rpcLabel(),
  confirmation_status: status?.confirmationStatus ?? null, slot: tx.slot, block_time: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
  fee_payer: feePayer, user_wallet_signer: user, signers: perSigner,
  fee_lamports: tx.meta!.fee, fee_payer_balance: fp, user_balance_in_tx: ub, user_balance_now_lamports: userNow,
  programs_invoked: programs, memo_log: memoLine, checks,
});
process.exit(0);
