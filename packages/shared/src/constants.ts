// CP1 CONTRACT — network constants. Devnet only (hard rule 4).
import { PublicKey } from "@solana/web3.js";
import idl from "../idl/solsend.json" with { type: "json" };

export const CLUSTER = "devnet" as const;
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const PRIVY_SOLANA_CHAIN = "solana:devnet" as const;

export const SOLSEND_PROGRAM_ID = new PublicKey(idl.address);
export const ALLOWANCES_PROGRAM_ID = new PublicKey("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44");
export const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const USDC_DECIMALS = 6;
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export const CARD_KIND = { STORE_LOCKED: 0, ONE_TIME: 1, SUBSCRIPTION: 2 } as const;
export type CardKind = keyof typeof CARD_KIND;
export const CARD_STATUS = { ACTIVE: 0, FROZEN: 1, USED: 2, CLOSED: 3 } as const;
export type CardStatus = keyof typeof CARD_STATUS;
export const cardKindName = (k: number): CardKind => (["STORE_LOCKED", "ONE_TIME", "SUBSCRIPTION"] as const)[k] ?? "STORE_LOCKED";
export const cardStatusName = (s: number): CardStatus => (["ACTIVE", "FROZEN", "USED", "CLOSED"] as const)[s] ?? "CLOSED";

/** Persistent honesty banner (hard rule 2). */
export const SANDBOX_BANNER = "Sandbox cards · Solana devnet USDC · no real merchants are charged";

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddress = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
