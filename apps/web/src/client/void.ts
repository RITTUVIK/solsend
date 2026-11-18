import { explorerTx } from "@solsend/shared";
import type { api } from "@solsend/shared";
import type { z } from "zod";
import { ApiCallError, client, humanError } from "./api";

export type Voided = z.infer<typeof api.DemoVoidResponse>;

/** POST /api/demo-merchant/void. A 409 already_voided is not a failure: surface the existing refund if the server returned it. */
export async function voidPurchase(lithicToken: string): Promise<Voided> {
  try {
    return await client.void(lithicToken);
  } catch (e) {
    if (e instanceof ApiCallError && e.code === "already_voided") {
      const b = e.body as { refundSignature?: unknown } | null | undefined;
      const sig = typeof b?.refundSignature === "string" ? b.refundSignature : null;
      return { lithicStatus: "VOIDED", refundSignature: sig, explorer: sig ? explorerTx(sig) : null, note: "This purchase was already voided." };
    }
    throw e;
  }
}

export function voidErrorCopy(e: unknown): string {
  if (e instanceof ApiCallError) {
    if (e.code === "not_voidable") return "This purchase can't be voided anymore (already settled by the store).";
    if (e.status === 429) return "Too many void requests. Please wait a moment and try again.";
    if (e.code === "demo_paused_low_sol") return "The demo store is paused for a moment (our devnet fee account is low). Try again in a few minutes.";
  }
  return humanError(e);
}
