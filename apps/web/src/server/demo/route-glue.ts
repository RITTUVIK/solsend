// Shared glue for the Demo Merchant routes: auth + config + live Lithic sandbox client.
import "server-only";
import { requireUser } from "../auth";
import { settlerLamportsCached } from "./sol-gate";
import { getStore } from "../store";
import type { DemoDeps } from "./checkout";
import { LithicSim } from "./lithic-sim";

export async function demoDeps(req: Request): Promise<DemoDeps> {
  const user = await requireUser(req);
  const key = process.env.LITHIC_API_KEY;
  const enabled = process.env.DEMO_MERCHANT_ENABLED === "1" && !!key;
  const max = Number(process.env.DEMO_MERCHANT_MAX_CENTS ?? 5000);
  return { store: getStore(), sim: new LithicSim(key ?? "unset"), wallet: user.wallet, enabled, maxCents: Number.isFinite(max) ? Math.min(max, 5000) : 5000, settlerLamports: settlerLamportsCached };
}
