
import { describe as d2, expect as e2, it as i2 } from "vitest";
import { outageFlag as of2 } from "./outage";
d2("outage flag never breaks the hot path", () => {
  i2("a store that throws synchronously (Supabase not configured) reads as OFF", async () => {
    const f = of2({ getSetting: () => { throw new Error("Supabase not configured"); } });
    e2(await f.get()).toBe(false);
  });
});

d2("outage flag is stale-while-revalidate (never blocks the hot path on the DB)", () => {
  i2("first read bounded by timeout; later reads serve cache instantly and refresh in background", async () => {
    let t = 0, value = "1", calls = 0;
    let release = null as (() => void) | null;
    const slow = { getSetting: async () => { calls++; await new Promise<void>((r) => { release = r; }); return value; } };
    const f = of2(slow, () => t, 20);
    e2(await f.get()).toBe(false);                 // DB slow on first read → OFF after 20 ms (never blocks)
    release!(); await new Promise((r) => setTimeout(r, 0));
    e2(await f.get()).toBe(true);                  // refreshed value now cached
    value = "0"; t += 10_000;                      // stale → serve cached immediately, refresh in background
    const p = f.get(); release?.(); e2(await p).toBe(true);
    await new Promise((r) => setTimeout(r, 0)); release!(); await new Promise((r) => setTimeout(r, 0));
    e2(await f.get()).toBe(false);                 // toggle picked up after background refresh
    e2(calls).toBeGreaterThanOrEqual(2);
  });
});
