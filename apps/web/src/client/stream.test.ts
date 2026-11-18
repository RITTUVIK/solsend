// QuickNode evidence must come only from recorded deliveries (final review, 2026-11-18: badges were unconditional).
import { describe, expect, it } from "vitest";
import { QN_LATE_MS, streamedBy, streamSummary } from "./stream";
import type { FeedRow } from "./format";

const T0 = Date.parse("2026-11-18T18:00:00Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
let n = 0;
const row = (p: Partial<FeedRow> & Pick<FeedRow, "kind" | "source">): FeedRow => ({
  id: `r${n++}`, cardPda: null, at: iso(0), amountBase: null, remainingBase: null, signature: null, explorer: null,
  lithicToken: null, merchant: null, reason: null, sandbox: true, ...p,
});

describe("streamedBy", () => {
  it("is true only when a quicknode-sourced row carries the signature", () => {
    const approved = row({ kind: "authorization_approved", source: "lithic", signature: "SIG1" });
    expect(streamedBy([approved], "SIG1")).toBe(false);
    expect(streamedBy([approved, row({ kind: "settled", source: "quicknode", signature: "SIG1" })], "SIG1")).toBe(true);
    expect(streamedBy([row({ kind: "settled", source: "quicknode", signature: "OTHER" })], "SIG1")).toBe(false);
    expect(streamedBy([], null)).toBe(false);
  });
});

describe("streamSummary", () => {
  it("none: no program events (faucet and card-network declines never stream)", () => {
    const rows = [row({ kind: "faucet", source: "app", signature: "F" }), row({ kind: "authorization_declined", source: "lithic", signature: "FAILED" })];
    expect(streamSummary(rows, T0 + 60_000)).toEqual({ state: "none", lastDeliveryAt: null });
  });
  it("delivered: the newest program event has a QuickNode delivery", () => {
    const rows = [row({ kind: "authorization_approved", source: "lithic", signature: "S", at: iso(1_000) }), row({ kind: "settled", source: "quicknode", signature: "S", at: iso(500) })];
    expect(streamSummary(rows, T0 + 2_000)).toEqual({ state: "delivered", lastDeliveryAt: iso(500) });
  });
  it("pending, then not_delivered once QN_LATE_MS passes without a delivery (stream paused)", () => {
    const rows = [row({ kind: "authorization_approved", source: "lithic", signature: "S", at: iso(0) })];
    expect(streamSummary(rows, T0 + QN_LATE_MS - 1).state).toBe("pending");
    expect(streamSummary(rows, T0 + QN_LATE_MS + 1).state).toBe("not_delivered");
  });
  it("an older delivery does not vouch for a newer undelivered event", () => {
    const rows = [
      row({ kind: "registered", source: "quicknode", signature: "OLD", at: iso(0) }),
      row({ kind: "registered", source: "app", signature: "NEW", at: iso(60_000) }),
    ];
    const s = streamSummary(rows, T0 + 120_000);
    expect(s.state).toBe("not_delivered");
    expect(s.lastDeliveryAt).toBe(iso(0));
  });
  it("an app row enriched by the webhook (same row, source → quicknode) counts as delivered", () => {
    expect(streamSummary([row({ kind: "frozen", source: "quicknode", signature: "FZ", at: iso(0) })], T0 + 999_999).state).toBe("delivered");
  });
});
