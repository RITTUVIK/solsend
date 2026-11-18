import { formatUsdc } from "@solsend/shared";
import type { api } from "@solsend/shared";

export type CardView = api.TCardView;
export type FeedRow = api.TFeedRow;

export const usd = (base: string | bigint | null | undefined): string => (base == null ? "—" : `$${formatUsdc(base)}`);

export const shortId = (s: string, n = 4): string => (s.length <= n * 2 + 1 ? s : `${s.slice(0, n)}…${s.slice(-n)}`);

export const b64ToBytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export const bytesToB64 = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

export const isMockSig = (sig: string): boolean => sig.startsWith("mock");

/** Merchant names always carry "(sandbox)". */
export const sandboxName = (name: string): string => (/\(sandbox\)/i.test(name) ? name : `${name} (sandbox)`);

export const MERCHANT_LABEL: Record<string, string> = { TEMU: "Temu", AMAZON: "Amazon", NETFLIX: "Netflix", OTHER_STORE: "Other store" };
export const merchantLabel = (m: string): string => MERCHANT_LABEL[m] ?? m;

/** Preset stores are locked onchain to that store FROM CREATION. "Other" cards lock to the first store that charges them. */
export const PRESET_STORES = ["temu", "amazon", "netflix"];
export const isPresetStore = (merchantName: string): boolean => PRESET_STORES.includes(merchantName.trim().toLowerCase());

export const KIND_LABEL = { STORE_LOCKED: "Store-locked", ONE_TIME: "One-time", SUBSCRIPTION: "Subscription" } as const;

export type DisplayStatus = "Active" | "Frozen" | "Used" | "Closed" | "Revoked" | "Setting up" | "Needs retry" | "Failed";

/** The single place that decides how a card is presented. A card is usable only if issued, ACTIVE and its delegation is live. */
export function displayStatus(c: CardView): DisplayStatus {
  if (c.issueState === "failed") return "Failed";
  if (c.issueState === "lithic_failed") return "Needs retry";
  if (c.issueState !== "issued") return "Setting up";
  if (c.status === "CLOSED") return "Closed";
  if (!c.delegationLive) return "Revoked";
  if (c.status === "FROZEN") return "Frozen";
  if (c.status === "USED") return "Used";
  return "Active";
}
export const isUsable = (c: CardView): boolean => displayStatus(c) === "Active";

export const limitSuffix = (c: CardView): string => (c.limit.type === "per_period" ? "/ month cap" : "lifetime cap");

/** Friendly decline copy keyed by Lithic ASA result (see CP1 F4 table). Falls back to the API's own reason. */
export function declineCopy(lithicResult: string | null, reason: string | null): string {
  // Outer card-network safety limit (2x the onchain limit, or SINGLE_USE): declined before any onchain tx.
  if (reason && /safety limit/i.test(reason)) return reason;
  if (reason && /idle/i.test(reason)) return "Card idle — unfreeze to reactivate";
  switch (lithicResult) {
    case "INSUFFICIENT_FUNDS": return "Over this card's limit";
    case "VELOCITY_EXCEEDED": return "Monthly cap reached";
    case "CARD_PAUSED": return "Card frozen";
    case "UNAUTHORIZED_MERCHANT": return "Card locked to another store";
    case "SUSPECTED_FRAUD": return "Blocked by onchain rules";
    default: return reason && reason.trim() ? reason : "Declined by the card's onchain rules";
  }
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}
