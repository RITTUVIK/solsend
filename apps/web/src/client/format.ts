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

export const MERCHANT_LABEL: Record<string, string> = { TEMU: "Temu", AMAZON: "Amazon", NETFLIX: "Netflix", OTHER_STORE: "Corner Cafe" };
export const merchantLabel = (m: string): string => MERCHANT_LABEL[m] ?? m;

/** Preset stores are locked onchain to that store FROM CREATION. "Other" cards lock to the first store that charges them. */
export const PRESET_STORES = ["temu", "amazon", "netflix"];
export const isPresetStore = (merchantName: string): boolean => PRESET_STORES.includes(merchantName.trim().toLowerCase());

export const KIND_LABEL = { STORE_LOCKED: "Store-locked", ONE_TIME: "One-time", SUBSCRIPTION: "Subscription" } as const;

export type DisplayStatus = "Active" | "Frozen" | "Used" | "Closed" | "Revoked" | "Expired" | "Setting up" | "Needs retry" | "Failed";

/** The single place that decides how a card is presented. A card is usable only if issued, ACTIVE, live and not expired. */
export function displayStatus(c: CardView): DisplayStatus {
  if (c.issueState === "failed") return "Failed";
  if (c.issueState === "lithic_failed") return "Needs retry";
  if (c.issueState !== "issued") return "Setting up";
  if (c.status === "CLOSED") return "Closed";
  if (!c.delegationLive) return "Revoked";
  if (isExpired(c)) return "Expired";
  if (c.status === "FROZEN") return "Frozen";
  if (c.status === "USED") return "Used";
  return "Active";
}
export const isUsable = (c: CardView): boolean => displayStatus(c) === "Active";

/** Onchain expiry: the server's `expired` flag, or our clock past `expiresAt` (the chain rejects pulls either way). */
export function isExpired(c: CardView, now = Date.now()): boolean {
  return !!c.expired || (!!c.expiresAt && now >= new Date(c.expiresAt).getTime());
}
/** "Expires in 6d" / "Expires in 2m" / null. */
export function expiresIn(c: CardView, now = Date.now()): string | null {
  if (!c.expiresAt || isExpired(c, now)) return null;
  const s = Math.max(0, Math.round((new Date(c.expiresAt).getTime() - now) / 1000));
  if (s < 60) return `Expires in ${s}s`;
  if (s < 3600) return `Expires in ${Math.ceil(s / 60)}m`;
  if (s < 86400) return `Expires in ${Math.round(s / 3600)}h`;
  return `Expires in ${Math.round(s / 86400)}d`;
}

/** A per-period cap that comes back: a monthly card with no expiry, or one that outlives its current period. */
export function capRenews(c: CardView): boolean {
  if (c.limit.type !== "per_period") return false;
  if (!c.expiresAt) return true;
  const life = Date.parse(c.expiresAt) - Date.parse(c.createdAt);
  return c.limit.periodSecs != null && Number.isFinite(life) && life > c.limit.periodSecs * 1000;
}

/** The most that can be pulled from the wallet right now: sum of remaining caps on live, usable cards. `renews` is true
 *  when one of them is a monthly cap that comes back next period, so the sum is "this month", not "ever". */
export function blastRadius(cards: CardView[] | null | undefined): { base: bigint; count: number; renews: boolean } {
  let base = 0n;
  let count = 0;
  let renews = false;
  for (const c of cards ?? []) {
    if (c.status === "ACTIVE" && c.delegationLive && !isExpired(c) && c.issueState === "issued") { base += BigInt(c.limit.remainingBase); count++; renews ||= capRenews(c); }
  }
  return { base, count, renews };
}

export const limitSuffix = (c: CardView): string => (c.limit.type === "per_period" ? "/ month cap" : "lifetime cap");

/** Friendly decline copy keyed by Lithic ASA result (see CP1 F4 table). Falls back to the API's own reason. */
export function declineCopy(lithicResult: string | null, reason: string | null): string {
  // Outer card-network safety limit (2x the onchain limit, or SINGLE_USE): declined before any onchain tx.
  if (reason && /safety limit/i.test(reason)) return reason;
  if (reason && /idle/i.test(reason)) return "Card idle — unfreeze to reactivate";
  if (reason && /expir/i.test(reason)) return "Card expired";
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

/** Display name for a merchant value that may be a raw enum ("AMAZON") or a typed name ("Corner Cafe"). */
export function storeName(m: string | null | undefined): string {
  if (!m) return "SolSend";
  const k = m.trim().toUpperCase();
  if (MERCHANT_LABEL[k]) return MERCHANT_LABEL[k]!;
  return m;
}

export type DeclineFix = "use_locked_store" | "pay_remaining" | "add_usdc" | "lower_amount" | "reactivate" | "unfreeze" | null;
/** One-sentence decline story: what happened + why it's safe. Never claims the chain verifies the merchant itself. */
export function declineStory(o: { lithicResult: string | null; reason: string | null; amountBase: bigint; remainingBase: bigint | null; lockedTo: string | null; walletBase: bigint | null }): { text: string; tone: "no" | "warn"; fix: DeclineFix } {
  const r = o.reason ?? "";
  if (/expir/i.test(r)) return { text: "This card expired when your free trial ended. Your USDC didn't move.", tone: "warn", fix: null };
  if (/idle/i.test(r)) return { text: "This card went idle. Reactivate it to keep using it. Your USDC didn't move.", tone: "warn", fix: "reactivate" };
  if (/safety limit/i.test(r)) return { text: "Stopped by the card network's safety limit before it ever reached Solana. Your USDC didn't move.", tone: "no", fix: "lower_amount" };
  switch (o.lithicResult) {
    case "UNAUTHORIZED_MERCHANT":
      return { text: `${o.lockedTo ? `This card only works at ${sandboxName(storeName(o.lockedTo))}` : "This card is locked to a different store"}. A leaked number is useless anywhere else. Your USDC didn't move.`, tone: "no", fix: o.lockedTo ? "use_locked_store" : null };
    case "INSUFFICIENT_FUNDS":
      if (o.walletBase != null && o.remainingBase != null && o.amountBase <= o.remainingBase && o.walletBase < o.amountBase)
        return { text: `Your wallet has ${usd(o.walletBase)} — not enough for ${usd(o.amountBase)}. Your USDC didn't move.`, tone: "no", fix: "add_usdc" };
      return { text: `${usd(o.amountBase)} is more than the ${o.remainingBase != null ? usd(o.remainingBase) : "amount"} left on this card, so Solana rejected the payment. Your USDC didn't move.`, tone: "no", fix: o.remainingBase != null && o.remainingBase > 0n ? "pay_remaining" : null };
    case "VELOCITY_EXCEEDED":
      return { text: "This period's cap is used up. It resets next period. Your USDC didn't move.", tone: "no", fix: null };
    case "CARD_PAUSED":
      return { text: "This card can't be charged right now (frozen, used or revoked). Your USDC didn't move.", tone: "warn", fix: "unfreeze" };
    default:
      return { text: "Blocked by this card's onchain rules. Your USDC didn't move.", tone: "no", fix: null };
  }
}
