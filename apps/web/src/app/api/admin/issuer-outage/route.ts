// POST /api/admin/issuer-outage {enabled} (Bearer ADMIN_API_TOKEN) — demo "issuer outage" switch: every
// swipe declines CARD_PAUSED before any settle. GET returns the current value. Propagates within the 5 s cache TTL.
import { api } from "@solsend/shared";
import { errorResponse } from "@/server/auth";
import { env } from "@/server/env";
import { getStore } from "@/server/store";
import { readJson, requireBearer } from "@/server/lib/http";
import { isOutageValue } from "@/server/asa/outage";
import { outageCache } from "@/server/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    requireBearer(req, env().ADMIN_API_TOKEN, "admin");
    return Response.json({ enabled: isOutageValue(await getStore().getSetting("issuer_outage")) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    requireBearer(req, env().ADMIN_API_TOKEN, "admin");
    const { enabled } = await readJson(req, api.IssuerOutageRequest);
    await getStore().setSetting("issuer_outage", enabled ? "1" : "0");
    outageCache().invalidate();
    console.log(`[admin] issuer_outage=${enabled}`);
    return Response.json({ enabled });
  } catch (e) {
    return errorResponse(e);
  }
}
