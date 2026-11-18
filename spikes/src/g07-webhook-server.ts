// G0.7 — QuickNode Streams webhook receiver (run behind a tunnel, e.g. `ngrok http 8787`).
// Verifies X-QN-Signature = hex(HMAC-SHA256(security_token, nonce + timestamp + body)),
// rejects stale timestamps (±5 min) and replayed nonces, records arrival latency.
// GET /seen?sig=<signature> (localhost only) lets the latency probe look up arrivals.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { SPIKES_DIR, env } from "./lib/env.js";
import { record } from "./lib/evidence.js";

const PORT = Number(process.env.G07_PORT ?? 8787);
const TOKEN = env("QN_STREAM_SECURITY_TOKEN");
const seenNonces = new Map<string, number>();
const arrivals = new Map<string, { receivedAt: string; slot: number | null; blockTime: number | null; match: unknown }>();
let captured = 0;

export function verifyQuickNode(token: string, nonce: string, timestamp: string, body: string, signature: string): boolean {
  const expected = createHmac("sha256", Buffer.from(token)).update(Buffer.from(nonce + timestamp + body)).digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function timestampOk(ts: string): boolean {
  const n = Number(ts);
  if (!Number.isFinite(n)) return false;
  const ms = n > 1e12 ? n : n * 1000;
  return Math.abs(Date.now() - ms) < 5 * 60_000;
}

createServer(async (req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/seen")) {
    const local = req.socket.remoteAddress === "127.0.0.1" || req.socket.remoteAddress === "::1" || req.socket.remoteAddress === "::ffff:127.0.0.1";
    if (!local || req.headers["x-forwarded-for"]) { res.writeHead(403).end(); return; }
    const sig = new URL(req.url, "http://x").searchParams.get("sig") ?? "";
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(arrivals.get(sig) ?? null));
    return;
  }
  if (req.method !== "POST" || req.url !== "/webhooks/quicknode") { res.writeHead(404).end(); return; }

  const receivedAt = new Date();
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let raw = Buffer.concat(chunks);
  if (req.headers["content-encoding"] === "gzip") raw = gunzipSync(raw);
  const body = raw.toString("utf8");

  const nonce = String(req.headers["x-qn-nonce"] ?? "");
  const ts = String(req.headers["x-qn-timestamp"] ?? "");
  const sig = String(req.headers["x-qn-signature"] ?? "");
  if (!nonce || !ts || !sig || !verifyQuickNode(TOKEN, nonce, ts, body, sig)) {
    record("g07", "webhook_rejected_bad_signature", { has_nonce: !!nonce, has_ts: !!ts, has_sig: !!sig });
    res.writeHead(401).end();
    return;
  }
  if (!timestampOk(ts)) { record("g07", "webhook_rejected_stale", { qn_timestamp: ts }); res.writeHead(401).end(); return; }
  if (seenNonces.has(nonce)) { record("g07", "webhook_rejected_replay", { nonce }); res.writeHead(409).end(); return; }
  seenNonces.set(nonce, Date.now());
  for (const [n, t] of seenNonces) if (Date.now() - t > 10 * 60_000) seenNonces.delete(n);

  res.writeHead(200).end("ok"); // ack fast; QuickNode pauses streams after repeated failures
  if (captured < 3) { // gitignored; used once to prove a replayed real delivery is rejected
    captured++;
    appendFileSync(join(SPIKES_DIR, ".raw", "qn-captures.jsonl"), JSON.stringify({ headers: { "x-qn-nonce": nonce, "x-qn-timestamp": ts, "x-qn-signature": sig }, body }) + "\n");
  }

  let payload: any;
  try { payload = JSON.parse(body); } catch { record("g07", "webhook_non_json", { bytes: body.length }); return; }
  const matches: any[] = payload?.matches ?? (Array.isArray(payload) ? payload.flatMap((p: any) => p?.matches ?? []) : []);
  for (const m of matches) {
    arrivals.set(m.signature, { receivedAt: receivedAt.toISOString(), slot: m.slot ?? null, blockTime: m.blockTime ?? null, match: m });
    record("g07", "webhook_match", {
      signature: m.signature, slot: m.slot ?? null, success: m.success, instruction: m.instruction ?? null,
      events: m.events ?? [], allowances_invoked: m.allowancesInvoked ?? null, post_usdc_balances: m.postUsdcBalances ?? [],
      received_at: receivedAt.toISOString(),
      latency_vs_block_time_ms: m.blockTime ? receivedAt.getTime() - m.blockTime * 1000 : null,
      stream_id: req.headers["stream-id"] ?? null, batch: payload?.batch ?? null, hmac_verified: true,
    });
  }
}).listen(PORT, () => console.log(`G0.7 webhook receiver on http://localhost:${PORT}/webhooks/quicknode`));
