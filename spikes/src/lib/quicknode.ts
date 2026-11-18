// QuickNode Streams REST helpers (management API). The API key is read from env and never logged.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPIKES_DIR, env } from "./env.js";
import { POLICY } from "./allowances.js";

export const QN_API = "https://api.quicknode.com/streams/rest/v1";
export const STREAM_NAME = "solsend-cp0b-devnet";

export async function qn(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${QN_API}${path}`, {
    method,
    headers: { "x-api-key": env("QUICKNODE_API_KEY"), "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 500) }; }
  return { status: res.status, json };
}

export function filterB64(): string {
  const src = readFileSync(join(SPIKES_DIR, "quicknode/filter.js"), "utf8").replaceAll("__OUR_PROGRAM__", JSON.stringify(POLICY.toBase58()));
  return Buffer.from(src).toString("base64");
}

export async function listOurStreams(): Promise<any[]> {
  const r = await qn("GET", "/streams?limit=50");
  const all: any[] = Array.isArray(r.json) ? r.json : r.json?.data ?? [];
  return all.filter((s) => s.name === STREAM_NAME);
}

/** Pause to stop credit consumption (QuickNode: paused streams consume no API credits). */
export async function pauseStream(id: string) {
  let r = await qn("POST", `/streams/${id}/pause`);
  if (r.status >= 300) r = await qn("PATCH", `/streams/${id}`, { status: "paused" });
  return r;
}

export async function activateStream(id: string) {
  let r = await qn("POST", `/streams/${id}/activate`);
  if (r.status >= 300) r = await qn("PATCH", `/streams/${id}`, { status: "active" });
  return r;
}
