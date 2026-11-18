// Issuer-outage flag (demo beat): when ON, every swipe declines CARD_PAUSED before any settle.
// Cached for 5 s per instance; a DB failure is treated as OFF (CP1 F4 step 3) — the chain still gates spend.
import type { Store } from "../store";

export const OUTAGE_TTL_MS = 5_000;
export const isOutageValue = (v: string | null) => v === "1" || v === "true" || v === "on";

export function outageFlag(store: Pick<Store, "getSetting">, now: () => number = Date.now) {
  let cache: { value: boolean; at: number } | null = null;
  return {
    async get(): Promise<boolean> {
      if (cache && now() - cache.at < OUTAGE_TTL_MS) return cache.value;
      let value = false;
      try { value = isOutageValue(await store.getSetting("issuer_outage")); } catch { value = false; }
      cache = { value, at: now() };
      return value;
    },
    invalidate() { cache = null; },
  };
}
