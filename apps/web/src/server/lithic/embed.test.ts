// Lithic embed session (rehearsal bug 2026-11-18: modern iframes render MASKED until the SDK's toggleMasking(), so the
// browser needs the session itself). No network: fake fetch. Values here are fake; no real session/PAN is involved.
import { describe, expect, it } from "vitest";
import { api } from "@solsend/shared";
import { LithicClient } from "./client";

const FAKE_SESSION = "fake-session-token-for-tests";
function fakeFetch(status: number, json: object) {
  const calls: { url: string; body: unknown }[] = [];
  const f = async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  };
  return { f, calls };
}

describe("LithicClient.createEmbed", () => {
  it("modern flow: CARD_EMBED session with target_origin; returns the session for the SDK plus per-field URLs", async () => {
    const { f, calls } = fakeFetch(200, { session: FAKE_SESSION });
    const c = new LithicClient("test-key", { fetch: f, writeGapMs: 0 });
    const s = await c.createEmbed("card-token", { targetOrigin: "https://solsend.example", ttlSecs: 300, nowMs: 1_700_000_000_000 });
    expect(calls[0]!.url).toBe("https://sandbox.lithic.com/v1/cards/card-token/embed");
    expect(calls[0]!.body).toEqual({ type: "CARD_EMBED", expiration: 1_700_000_300, target_origin: "https://solsend.example" });
    expect(s.flow).toBe("session");
    expect(s.session).toBe(FAKE_SESSION);
    expect(new URL(s.iframes.pan).searchParams.get("type")).toBe("PAN");
    // The wire schema keeps the session (zod strips unknown keys, so it must be declared) and the flow.
    const wire = api.EmbedSessionResponse.parse({ iframeUrl: s.iframeUrl, expiresAt: s.expiresAt, iframes: s.iframes, flow: s.flow, session: s.session });
    expect(wire.session).toBe(FAKE_SESSION);
    expect(wire.flow).toBe("session");
  });

  it("legacy fallback (session endpoint 404): no session; one unmasked hosted card frame", async () => {
    const { f } = fakeFetch(404, { message: "not found" });
    const c = new LithicClient("test-key", { fetch: f, writeGapMs: 0 });
    const s = await c.createEmbed("card-token", { targetOrigin: null, ttlSecs: 300, nowMs: 1_700_000_000_000 });
    expect(s.flow).toBe("legacy_hmac");
    expect(s.session).toBeUndefined();
    expect(new URL(s.iframeUrl).pathname).toBe("/v1/embed/card");
  });

  it("ttl is clamped to Lithic's 10-minute maximum", async () => {
    const { f, calls } = fakeFetch(200, { session: FAKE_SESSION });
    await new LithicClient("k", { fetch: f, writeGapMs: 0 }).createEmbed("t", { targetOrigin: null, ttlSecs: 3600, nowMs: 0 });
    expect((calls[0]!.body as { expiration: number }).expiration).toBe(600);
  });
});
