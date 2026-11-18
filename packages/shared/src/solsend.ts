// CP1 CONTRACT — typed SolSend instruction builders (all PDAs derived here, never by callers).
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ALLOWANCES_PROGRAM_ID, USDC_MINT } from "./constants.js";
import { buildSolsendIx, decodeSolsendAccount } from "./idl.js";
import {
  allowancesEventAuthority, cardDelegation, cardPda, configPda, settlementRecordPda, subscriptionAuthorityPda, treasuryAta, treasuryPda, usdcAta,
} from "./pda.js";
import { label32 } from "./bytes.js";

export type CardAccount = {
  owner: PublicKey; cardId: bigint; kind: number; status: number; delegation: PublicKey; delegationNonce: bigint;
  sourceTokenAccount: PublicKey; label: Uint8Array; merchantLock: Uint8Array; createdTs: bigint; lastUsedTs: bigint;
  totalSettled: bigint; totalRefunded: bigint; settleCount: number; bump: number;
};
export type ConfigAccount = {
  admin: PublicKey; settlementAuthority: PublicKey; usdcMint: PublicKey; treasuryDestination: PublicKey;
  perTxMax: bigint; idleSecs: bigint; paused: boolean; treasuryBump: number; bump: number;
};
export type SettlementRecordAccount = { card: PublicKey; authHash: Uint8Array; amount: bigint; refunded: bigint; createdTs: bigint; bump: number };

export const decodeCard = (data: Uint8Array) => decodeSolsendAccount<CardAccount>("Card", data);
export const decodeConfig = (data: Uint8Array) => decodeSolsendAccount<ConfigAccount>("Config", data);
export const decodeSettlementRecord = (data: Uint8Array) => decodeSolsendAccount<SettlementRecordAccount>("SettlementRecord", data);

export function ixInitializeConfig(p: { admin: PublicKey; settlementAuthority: PublicKey; treasuryDestination: PublicKey; perTxMax: bigint; idleSecs: bigint }) {
  return buildSolsendIx("initialize_config",
    { args: { settlementAuthority: p.settlementAuthority, treasuryDestination: p.treasuryDestination, perTxMax: p.perTxMax, idleSecs: p.idleSecs } },
    { admin: p.admin, config: configPda(), treasury: treasuryPda(), usdcMint: USDC_MINT, systemProgram: SystemProgram.programId });
}
export const ixSetPaused = (admin: PublicKey, paused: boolean) => buildSolsendIx("set_paused", { paused }, { admin, config: configPda() });
export const ixSetSettlementAuthority = (admin: PublicKey, newAuthority: PublicKey) =>
  buildSolsendIx("set_settlement_authority", { newAuthority }, { admin, config: configPda() });

/** Owner signs; `payer` (our fee payer) sponsors the Card account rent. Delegation nonce = cardId. */
export function ixRegisterCard(p: { owner: PublicKey; payer: PublicKey; cardId: bigint; kind: number; label: string }) {
  return buildSolsendIx("register_card",
    { cardId: p.cardId, kind: p.kind, delegationNonce: p.cardId, label: label32(p.label) },
    { owner: p.owner, payer: p.payer, config: configPda(), card: cardPda(p.owner, p.cardId), delegation: cardDelegation(p.owner, p.cardId),
      ownerAta: usdcAta(p.owner), usdcMint: USDC_MINT, systemProgram: SystemProgram.programId });
}

export function ixSettle(p: { settler: PublicKey; owner: PublicKey; cardId: bigint; amount: bigint; authHash: Uint8Array; merchantHash: Uint8Array }) {
  const card = cardPda(p.owner, p.cardId);
  return buildSolsendIx("settle",
    { amount: p.amount, authHash: p.authHash, merchantHash: p.merchantHash },
    { settlementAuthority: p.settler, config: configPda(), card, settlementRecord: settlementRecordPda(card, p.authHash),
      delegation: cardDelegation(p.owner, p.cardId), subscriptionAuthority: subscriptionAuthorityPda(p.owner), sourceTokenAccount: usdcAta(p.owner),
      treasury: treasuryPda(), treasuryAta: treasuryAta(), usdcMint: USDC_MINT, eventAuthority: allowancesEventAuthority(),
      allowancesProgram: ALLOWANCES_PROGRAM_ID, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId });
}

export function ixRefund(p: { settler: PublicKey; owner: PublicKey; cardId: bigint; amount: bigint; authHash: Uint8Array }) {
  const card = cardPda(p.owner, p.cardId);
  return buildSolsendIx("refund", { amount: p.amount, authHash: p.authHash },
    { settlementAuthority: p.settler, config: configPda(), card, settlementRecord: settlementRecordPda(card, p.authHash),
      sourceTokenAccount: usdcAta(p.owner), treasury: treasuryPda(), treasuryAta: treasuryAta(), usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID });
}

export const ixFreezeCard = (p: { authority: PublicKey; owner: PublicKey; cardId: bigint }) =>
  buildSolsendIx("freeze_card", {}, { authority: p.authority, config: configPda(), card: cardPda(p.owner, p.cardId) });
export const ixUnfreezeCard = (owner: PublicKey, cardId: bigint) => buildSolsendIx("unfreeze_card", {}, { owner, card: cardPda(owner, cardId) });
export const ixCloseCard = (owner: PublicKey, cardId: bigint) => buildSolsendIx("close_card", {}, { owner, card: cardPda(owner, cardId) });
export const ixAdminWithdraw = (p: { admin: PublicKey; destination: PublicKey; amount: bigint }) =>
  buildSolsendIx("admin_withdraw", { amount: p.amount },
    { admin: p.admin, config: configPda(), treasury: treasuryPda(), treasuryAta: treasuryAta(), destination: p.destination, usdcMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ID });
