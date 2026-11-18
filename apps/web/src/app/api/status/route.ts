// GET /api/status: public health/readiness. Secret-free (see server/status/checks.ts).
import { runChecks, lithicPing, statusCache, STATUS_CACHE_CONTROL, type RpcLike } from "@/server/status/checks";
import { getStore } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cached = statusCache(compute);

export async function GET(): Promise<Response> {
  return Response.json(await cached(), { headers: { "cache-control": STATUS_CACHE_CONTROL } });
}

async function compute() {
  let rpc: RpcLike | null = null, settler = null, feePayer = null, configError: string | undefined;
  try {
    const { connection, settlementAuthority, feePayerKey } = await import("@/server/keys");
    rpc = connection() as unknown as RpcLike;
    settler = settlementAuthority().publicKey;
    feePayer = feePayerKey().publicKey;
  } catch {
    configError = "server env incomplete (RPC / keys)"; // message only; never echo which value or its content
  }
  let store = null;
  try { store = getStore(); } catch { /* reported as a failed check */ }
  return runChecks({ rpc, settler, feePayer, store, lithicPing: () => lithicPing(process.env.LITHIC_API_KEY), configError });
}
