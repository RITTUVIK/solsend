// Wallet (F1 view) + faucet (F2): "devnet test USDC" from the demo-faucet wallet; the faucet pays the
// user's ATA rent (idempotent create) and the fee. Rate-limited per wallet + globally (store fails closed).
import bs58 from "bs58";
import { ComputeBudgetProgram, PublicKey, Transaction, type Keypair } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction } from "@solana/spl-token";
import { USDC_DECIMALS, USDC_MINT, explorerTx, usdcAta, type api } from "@solsend/shared";
import type { z } from "zod";
import { HttpError } from "../auth";
import type { Store } from "../store";
import { confirmSignature, parseTokenAccount, rebroadcast, type Clock, type Rpc } from "../solana/rpc";
import { readWalletChain } from "../cards/chain";

export async function walletView(rpc: Rpc, wallet: string): Promise<z.infer<typeof api.WalletResponse>> {
  const w = await readWalletChain(rpc, new PublicKey(wallet));
  return { wallet, usdcBase: (w.ata?.amount ?? 0n).toString(), solLamports: w.lamports.toString(), subscriptionAuthorityReady: w.saExists, delegateHealthy: w.delegateHealthy };
}

export const FAUCET_PER_WALLET_PER_HOUR = 1;
export const FAUCET_GLOBAL_PER_HOUR = 60;

export async function claimFaucet(deps: { rpc: Rpc; store: Store; faucet: Keypair; clock: Clock; amountBase: bigint }, wallet: string): Promise<z.infer<typeof api.FaucetResponse>> {
  if (!(await deps.store.rateLimit(`faucet:${wallet}`, 3600, FAUCET_PER_WALLET_PER_HOUR))) throw new HttpError(429, "faucet: 1 claim per hour per wallet", "rate_limited");
  if (!(await deps.store.rateLimit("faucet:global", 3600, FAUCET_GLOBAL_PER_HOUR))) throw new HttpError(429, "faucet busy, try later", "rate_limited");
  const user = new PublicKey(wallet);
  const src = usdcAta(deps.faucet.publicKey);
  const srcAcc = await deps.rpc.getAccountInfo(src, "confirmed");
  const bal = srcAcc ? parseTokenAccount(srcAcc.data)?.amount ?? 0n : 0n;
  if (bal < deps.amountBase) throw new HttpError(503, "faucet is empty (devnet test USDC)", "faucet_empty");
  const dst = usdcAta(user);
  const { blockhash } = await deps.rpc.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: deps.faucet.publicKey, recentBlockhash: blockhash }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
    createAssociatedTokenAccountIdempotentInstruction(deps.faucet.publicKey, dst, user, USDC_MINT),
    createTransferCheckedInstruction(src, USDC_MINT, dst, deps.faucet.publicKey, deps.amountBase, USDC_DECIMALS),
  );
  tx.sign(deps.faucet);
  const raw = tx.serialize();
  const signature = bs58.encode(tx.signature!);
  await deps.rpc.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 2 });
  const until = deps.clock.now() + 45_000;
  const stop = rebroadcast(deps.rpc, raw, until, deps.clock, 2000);
  let st;
  try { st = await confirmSignature(deps.rpc, signature, until, deps.clock); } finally { stop(); }
  if (!st) throw new HttpError(504, `faucet transfer not confirmed yet: ${signature}`, "not_confirmed");
  if (st.err) throw new HttpError(502, `faucet transfer failed: ${signature}`, "tx_failed");
  await deps.store.insertFeedEvent({ owner_wallet: wallet, card_pda: null, kind: "faucet", amount_base: deps.amountBase.toString(), remaining_base: null, signature, lithic_token: null, merchant: null, reason: "devnet test USDC", source: "app", slot: null }).catch(() => false);
  return { signature, explorer: explorerTx(signature), amountBase: deps.amountBase.toString(), label: "devnet test USDC" };
}
