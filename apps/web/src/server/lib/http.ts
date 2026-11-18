// Route helpers: zod-validated JSON in/out, bearer secrets (timing-safe), safe logging.
import "server-only";
import { timingSafeEqual, createHash } from "node:crypto";
import type { z } from "zod";
import { HttpError } from "../auth";

/** Parse a JSON request body against a schema → 400 on failure (never echoes the body). */
export async function readJson<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "invalid JSON body", "bad_request");
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(400, `invalid request: ${r.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}`, "bad_request");
  return r.data;
}

/** Validate an outgoing response body against its contract schema; a mismatch is a server bug (500). */
export function respond<S extends z.ZodTypeAny>(schema: S, body: z.input<S>, init?: ResponseInit): Response {
  const r = schema.safeParse(body);
  if (!r.success) {
    console.error("[api] response failed contract validation:", r.error.issues.map((i) => i.path.join(".")).join(", "));
    throw new HttpError(500, "internal error (response contract)");
  }
  return Response.json(r.data, init);
}

/** Constant-time `Authorization: Bearer <secret>` check. Missing secret config → 503 (fail closed). */
export function requireBearer(req: Request, secret: string | undefined, what: string): void {
  if (!secret) throw new HttpError(503, `${what} not configured`, "not_configured");
  const h = req.headers.get("authorization") ?? "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  if (!given || !timingSafeEqual(a, b)) throw new HttpError(401, "unauthorized", "unauthenticated");
}

/** Bodies that might carry a card number must never be logged (PCI). `pos.entry_mode.pan` is an enum, not a PAN. */
export const looksLikeCardData = (s: string) => /"pan"\s*:\s*"\d{12,19}"/.test(s) || /"cvv"\s*:\s*"\d{3,4}"/.test(s);

export { safeErr } from "./safe";
