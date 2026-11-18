// GET /api/status: public health/readiness. Secret-free (see server/status/checks.ts).
import { runChecks, lithicPing, type RpcLike } from "@/server/status/checks";
import { getStore } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
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
  const res = await runChecks({ rpc, settler, feePayer, store, lithicPing: () => lithicPing(process.env.LITHIC_API_KEY), configError });
  return Response.json(res, { headers: { "cache-control": "no-store" } });
}
