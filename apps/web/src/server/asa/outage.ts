// Issuer-outage flag (demo beat): when ON, every swipe declines CARD_PAUSED before any settle.
// Cached for 5 s per instance; a DB failure is treated as OFF (CP1 F4 step 3) — the chain still gates spend.
import "server-only";
import type { Store } from "../store";

export const OUTAGE_TTL_MS = 5_000;
export const isOutageValue = (v: string | null) => v === "1" || v === "true" || v === "on";

export function outageFlag(store: Pick<Store, "getSetting">, now: () => number = Date.now, firstReadTimeoutMs = 250) {
  // NOTE: callers may pass a store whose getSetting throws synchronously or rejects — both read as OFF.
  // Stale-while-revalidate: the ASA hot path NEVER waits on the database except the very first read per instance
  // (bounded by firstReadTimeoutMs). A demo toggle must not add a DB round trip to payments (hosted test finding).
  let cache: { value: boolean; at: number } | null = null;
  let inflight: Promise<boolean> | null = null;
  const refresh = () => (inflight ??= (async () => {
    let value = false;
    try { value = isOutageValue(await store.getSetting("issuer_outage")); } catch { value = false; }
    cache = { value, at: now() };
    inflight = null;
    return value;
  })());
  return {
    async get(): Promise<boolean> {
      if (cache) {
        if (now() - cache.at >= OUTAGE_TTL_MS) void refresh();
        return cache.value;
      }
      return Promise.race([refresh(), new Promise<boolean>((r) => setTimeout(() => r(false), firstReadTimeoutMs))]);
    },
    invalidate() { cache = null; },
  };
}
