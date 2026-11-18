// CP0b / S1f — the S1 flow live on Solana devnet with real devnet USDC:
//   SA init (if needed) → FixedDelegation(5 USDC, delegatee = Card PDA) → register_card →
//   settle 1.14 (CPI pull) → decode Allowances FixedTransferEvent → duplicate settle (must fail)
//   → over-cap settle (must fail) → user revokes directly in Allowances → settle (must fail).
// Every transaction here is a real product action; nothing is sent "for show".
import bs58 from "bs58";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Transaction, sendAndConfirmTransaction, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { record } from "./lib/evidence.js";
import { MINT, devnet, explorerTx, fmtUsdc, loadKeypair, tokenState } from "./lib/solana.js";
import {
  ALLOWANCES, POLICY, authHash, cardPda, configPda, decodeFixedTransferEvent, delegationPda, fixedRemaining,
  ixCreateFixedDelegation, ixInitSubscriptionAuthority, ixInitializeConfig, ixRegisterCard, ixRevokeDelegation, ixSettle,
  saInitId, subscriptionAuthority, treasuryAta, treasuryPda,
} from "./lib/allowances.js";

const conn = await devnet();
const admin = loadKeypair("deployer");
const owner = loadKeypair("card-a-owner");
const settler = loadKeypair("settlement-authority");
const ownerAta = getAssociatedTokenAddressSync(MINT, owner.publicKey);

async function tx(label: string, ixs: TransactionInstruction[], signers: Keypair[]) {
  const t0 = performance.now();
  const signature = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: "confirmed" });
  const ms = Math.round(performance.now() - t0);
  record("s1f", label, { signature, explorer: explorerTx(signature), send_to_confirmed_ms: ms, rpc: "public devnet (indicative only; S3 measures properly)" });
  return signature;
}

async function expectFail(label: string, ixs: TransactionInstruction[], signers: Keypair[]) {
  const before = (await tokenState(conn, ownerAta)).amount;
  try {
    const sig = await tx(label, ixs, signers);
    record("s1f", `${label}_UNEXPECTED_SUCCESS`, { signature: sig });
    return false;
  } catch (e) {
    const after = (await tokenState(conn, ownerAta)).amount;
    const logs = (e as { logs?: string[] }).logs ?? [];
    record("s1f", `${label}_rejected`, {
      error: String((e as Error).message).split("\n")[0]?.slice(0, 200),
      program_error_log: logs.filter((l) => l.includes("failed") || l.includes("already in use")).slice(-2),
      owner_usdc_unchanged: before === after,
    });
    return before === after;
  }
}

// 0. one-time setup (idempotent)
if (!(await conn.getAccountInfo(configPda()))) await tx("initialize_config", [ixInitializeConfig(admin.publicKey, settler.publicKey)], [admin]);
if (!(await conn.getAccountInfo(treasuryAta())))
  await tx("create_treasury_ata", [createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, treasuryAta(), treasuryPda(), MINT)], [admin]);
if ((await saInitId(conn, owner.publicKey)) === null) await tx("init_subscription_authority", [ixInitSubscriptionAuthority(owner.publicKey)], [owner]);
const initId = (await saInitId(conn, owner.publicKey))!;
const ownerAtaState = await tokenState(conn, ownerAta);
record("s1f", "preflight", {
  policy_program: POLICY.toBase58(), allowances_program: ALLOWANCES.toBase58(), owner: owner.publicKey.toBase58(),
  owner_usdc: fmtUsdc(ownerAtaState.amount), owner_ata_delegate: ownerAtaState.delegate,
  delegate_is_subscription_authority: ownerAtaState.delegate === subscriptionAuthority(owner.publicKey).toBase58(),
  sa_init_id: initId.toString(), settlement_authority: settler.publicKey.toBase58(), treasury_ata: treasuryAta().toBase58(),
});

// 1. card = FixedDelegation(5 USDC) with delegatee = Card PDA, registered in the policy program
const cardId = BigInt(Date.now());
const nonce = cardId;
const card = cardPda(owner.publicKey, cardId);
const delegation = delegationPda(subscriptionAuthority(owner.publicKey), owner.publicKey, card, nonce);
await tx("create_card_delegation_and_register", [
  ixCreateFixedDelegation(owner.publicKey, card, nonce, 5_000_000n, 0n, initId),
  ixRegisterCard(owner.publicKey, cardId, 0, nonce),
], [owner]);

// 2. settle 1.14 USDC for a (synthetic, labeled) authorization reference
const auth1 = authHash(`s1f-devnet-auth-${cardId}-1`);
const ownerBefore = (await tokenState(conn, ownerAta)).amount;
const treasBefore = (await tokenState(conn, treasuryAta())).amount;
const settleSig = await tx("settle_1.14", [ixSettle(settler.publicKey, owner.publicKey, cardId, nonce, 1_140_000n, auth1)], [settler]);
const parsed = await conn.getTransaction(settleSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
const keys = parsed!.transaction.message.getAccountKeys().staticAccountKeys;
const events = (parsed!.meta?.innerInstructions ?? []).flatMap((ii) => ii.instructions)
  .filter((ix) => keys[ix.programIdIndex]!.equals(ALLOWANCES))
  .map((ix) => decodeFixedTransferEvent(Buffer.from(bs58.decode(ix.data)))).filter(Boolean);
const delAcc = await conn.getAccountInfo(delegation, "confirmed");
const ownerAfter = (await tokenState(conn, ownerAta)).amount;
const treasAfter = (await tokenState(conn, treasuryAta())).amount;
const s1fCore = ownerBefore - ownerAfter === 1_140_000n && treasAfter - treasBefore === 1_140_000n && delAcc !== null && fixedRemaining(delAcc.data) === 3_860_000n;
record("s1f", "settle_verified", {
  card_pda: card.toBase58(), delegation: delegation.toBase58(), owner_delta: (ownerAfter - ownerBefore).toString(),
  treasury_delta: (treasAfter - treasBefore).toString(), delegation_remaining: delAcc ? fixedRemaining(delAcc.data).toString() : null,
  decoded_allowances_events: events, cu: parsed!.meta?.computeUnitsConsumed ?? null, ok: s1fCore,
});

// 3. negative paths on devnet
const dup = await expectFail("duplicate_settle_same_auth", [ixSettle(settler.publicKey, owner.publicKey, cardId, nonce, 1_140_000n, auth1)], [settler]);
const over = await expectFail("over_cap_settle_4.00", [ixSettle(settler.publicKey, owner.publicKey, cardId, nonce, 4_000_000n, authHash(`s1f-devnet-auth-${cardId}-2`))], [settler]);
await tx("user_revokes_delegation_directly_in_allowances", [ixRevokeDelegation(owner.publicKey, delegation)], [owner]);
const revoked = await expectFail("settle_after_external_revoke", [ixSettle(settler.publicKey, owner.publicKey, cardId, nonce, 500_000n, authHash(`s1f-devnet-auth-${cardId}-3`))], [settler]);

record("s1f", s1fCore && dup && over && revoked && events.length === 1 ? "PASS" : "FAIL", {
  core_pull_verified: s1fCore, duplicate_rejected: dup, over_cap_rejected: over, external_revoke_blocks_pull: revoked, events_decoded: events.length,
});
