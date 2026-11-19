// GET /api/status: public health/readiness. Secret-free (see server/status/checks.ts).
import { runChecks, lithicPing, statusCache, STATUS_CACHE_CONTROL, type RpcLike } from "@/server/status/checks";
import { getStore } from "@/server/store";
import { waitUntil } from "@vercel/functions";
import { maybePiggybackSweep } from "@/server/reconcile/piggyback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cached = statusCache(compute);

export async function GET(): Promise<Response> {
  return Response.json(await cached(), { headers: { "cache-control": STATUS_CACHE_CONTROL } });
}

async function compute() {
  let rpc: RpcLike | null = null, settler = null, feePayer = null, faucet = null, faucetAmountBase: bigint | undefined, configError: string | undefined;
  try {
    const { connection, settlementAuthority, feePayerKey, faucetKey } = await import("@/server/keys");
    rpc = connection() as unknown as RpcLike;
    settler = settlementAuthority().publicKey;
    feePayer = feePayerKey().publicKey;
    // The faucet is optional: a deployment without one simply has no faucet check.
    try { faucet = faucetKey().publicKey; faucetAmountBase = (await import("@/server/env")).env().FAUCET_AMOUNT_BASE; } catch { faucet = null; }
  } catch {
    configError = "server env incomplete (RPC / keys)"; // message only; never echo which value or its content
  }
  let store = null;
  try { store = getStore(); } catch { /* reported as a failed check */ }
  // Status checks are computed at most once per 30 s (cache + CDN). Like /api/feed and /api/cards, viewing status also
  // drives the small, globally rate-limited reconcile sweep, so "unreconciled" never sits stale when the app is idle
  // (the GitHub cron only runs from main). Never blocks or fails the response.
  if (store) {
    try {
      const { reconcileDeps } = await import("@/server/deps");
      waitUntil(maybePiggybackSweep(reconcileDeps, store));
    } catch { /* best effort */ }
  }
  return runChecks({ rpc, settler, feePayer, store, lithicPing: () => lithicPing(process.env.LITHIC_API_KEY), configError, faucet, faucetAmountBase });
}
