// POST /api/quicknode: QuickNode Streams -> live feed (F6). Auth = HMAC (x-qn-signature), not a user session.
import { getStore } from "@/server/store";
import { handleQuickNodeWebhook } from "@/server/qn/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleQuickNodeWebhook(req, { token: process.env.QN_STREAM_SECURITY_TOKEN, store: getStore() });
}
