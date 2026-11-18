
import { describe as d2, expect as e2, it as i2 } from "vitest";
import { outageFlag as of2 } from "./outage";
d2("outage flag never breaks the hot path", () => {
  i2("a store that throws synchronously (Supabase not configured) reads as OFF", async () => {
    const f = of2({ getSetting: () => { throw new Error("Supabase not configured"); } });
    e2(await f.get()).toBe(false);
  });
});
