// Minimal Lithic SANDBOX client for CP0b. Guards:
//  - sandbox host only (refuses api.lithic.com)
//  - hard cap on real API calls per process (Lithic's sandbox policy prohibits load/automated testing at scale)
//  - write pacing (sandbox: ~1 RPS on /simulate*, 2 RPS card writes)
//  - responses are scrubbed of pan/cvv before any logging
import { env, optEnv } from "./env.js";
import { saveRaw, scrub } from "./evidence.js";

const BASE = optEnv("LITHIC_BASE_URL") ?? "https://sandbox.lithic.com";
if (BASE !== "https://sandbox.lithic.com") throw new Error("Refusing to run: LITHIC_BASE_URL must be https://sandbox.lithic.com");
const MAX_CALLS = Number(optEnv("LITHIC_MAX_CALLS_PER_RUN") ?? 30);
let calls = 0;
let lastWrite = 0;

export class LithicError extends Error {
  constructor(readonly status: number, readonly body: unknown) { super(`lithic HTTP ${status}: ${JSON.stringify(scrub(body)).slice(0, 400)}`); }
}

export async function lithic<T = any>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, label = path): Promise<T> {
  if (++calls > MAX_CALLS) throw new Error(`Refusing: more than ${MAX_CALLS} real Lithic sandbox calls in one run (sandbox policy).`);
  if (method !== "GET") {
    const wait = lastWrite + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastWrite = Date.now();
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: env("LITHIC_API_KEY"), "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  saveRaw(`lithic-${label.replace(/\W+/g, "_")}`, { method, path, status: res.status, json: scrub(json) });
  if (!res.ok) throw new LithicError(res.status, json);
  return json as T;
}

export const lithicCallsUsed = () => calls;
