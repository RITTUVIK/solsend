// POST /api/demo-merchant/checkout: sandbox-only simulated purchase against one of the user's own cards (F7).
import { errorResponse } from "@/server/auth";
import { demoCheckout } from "@/server/demo/checkout";
import { demoDeps } from "@/server/demo/route-glue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  try {
    const deps = await demoDeps(req);
    const body = await req.json().catch(() => null);
    return Response.json(await demoCheckout(body, deps));
  } catch (e) {
    return errorResponse(e);
  }
}
