// POST /api/cards/revoke-all → PreparedTx revoking every live SolSend delegation directly in the
// Allowances program (owner-signed escape hatch, ≤12 per tx; call again if more remain).
import { api } from "@solsend/shared";
import { errorResponse, requireUser } from "@/server/auth";
import { cardDeps, delegationDiscovery } from "@/server/deps";
import { respond } from "@/server/lib/http";
import { prepareRevokeAll } from "@/server/cards/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const { wallet } = await requireUser(req);
    return respond(api.RevokeAllResponse, await prepareRevokeAll({ ...cardDeps(), gpa: delegationDiscovery() }, wallet));
  } catch (e) {
    return errorResponse(e);
  }
}
