// CP1 CONTRACT — PDA derivations (SolSend + Allowances).
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ALLOWANCES_PROGRAM_ID, SOLSEND_PROGRAM_ID, USDC_MINT } from "./constants.js";
import { u64le, utf8 } from "./bytes.js";

const pda = (seeds: Uint8Array[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];

export const configPda = () => pda([utf8("config")], SOLSEND_PROGRAM_ID);
export const treasuryPda = () => pda([utf8("treasury")], SOLSEND_PROGRAM_ID);
export const treasuryAta = () => getAssociatedTokenAddressSync(USDC_MINT, treasuryPda(), true);
export const cardPda = (owner: PublicKey, cardId: bigint) => pda([utf8("card"), owner.toBytes(), u64le(cardId)], SOLSEND_PROGRAM_ID);
export const settlementRecordPda = (card: PublicKey, authHash: Uint8Array) => pda([utf8("settle"), card.toBytes(), authHash], SOLSEND_PROGRAM_ID);
export const usdcAta = (owner: PublicKey) => getAssociatedTokenAddressSync(USDC_MINT, owner, true);

// Allowances (Solana Subscriptions & Allowances program)
export const subscriptionAuthorityPda = (user: PublicKey) => pda([utf8("SubscriptionAuthority"), user.toBytes(), USDC_MINT.toBytes()], ALLOWANCES_PROGRAM_ID);
export const delegationPda = (sa: PublicKey, delegator: PublicKey, delegatee: PublicKey, nonce: bigint) =>
  pda([utf8("delegation"), sa.toBytes(), delegator.toBytes(), delegatee.toBytes(), u64le(nonce)], ALLOWANCES_PROGRAM_ID);
export const allowancesEventAuthority = () => pda([utf8("event_authority")], ALLOWANCES_PROGRAM_ID);

/** The card's delegation (delegator = owner, delegatee = Card PDA, nonce = card_id by convention). */
export const cardDelegation = (owner: PublicKey, cardId: bigint) => delegationPda(subscriptionAuthorityPda(owner), owner, cardPda(owner, cardId), cardId);
