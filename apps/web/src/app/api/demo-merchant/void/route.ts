// POST /api/demo-merchant/void: sandbox simulate/void of one of the user's own authorizations (F7 -> refund via F5).
import { errorResponse } from "@/server/auth";
import { demoVoid } from "@/server/demo/checkout";
import { demoDeps } from "@/server/demo/route-glue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  try {
    const deps = await demoDeps(req);
    const body = await req.json().catch(() => null);
    return Response.json(await demoVoid(body, deps));
  } catch (e) {
    return errorResponse(e);
  }
}
