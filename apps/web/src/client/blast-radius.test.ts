import { describe, expect, it } from "vitest";
import { blastRadius, capRenews, type CardView } from "./format";

const MONTH = 30 * 24 * 3600;
const created = new Date().toISOString(); // cards made "now", so short expiries below are still in the future
const after = (secs: number) => new Date(Date.parse(created) + secs * 1000).toISOString();

function card(over: Partial<CardView> & { limit?: Partial<CardView["limit"]> } = {}): CardView {
  const { limit, ...rest } = over;
  return {
    cardPda: "Card1111111111111111111111111111111111111111", cardId: "1", label: "Temu card", merchantName: "Temu", kind: "STORE", status: "ACTIVE", issueState: "issued",
    lithic: { cardToken: "tok", lastFour: "4242", state: "OPEN" },
    limit: { type: "lifetime", totalBase: "40000000", remainingBase: "28000000", periodSecs: null, ...limit },
    totals: { settledBase: "12000000", refundedBase: "0" }, merchantLocked: true, delegationLive: true,
    expiresAt: null, expired: false, delegation: "De1eg111111111111111111111111111111111111111", createdAt: created, registerSignature: null,
    ...rest,
  } as CardView;
}
const monthly = (over: Partial<CardView> = {}) => card({ limit: { type: "per_period", totalBase: "15490000", remainingBase: "15490000", periodSecs: MONTH }, ...over });

describe("capRenews", () => {
  it("a lifetime cap never comes back", () => {
    expect(capRenews(card())).toBe(false);
    expect(capRenews(card({ expiresAt: after(7 * 24 * 3600) }))).toBe(false);
  });
  it("a monthly card with no expiry renews", () => {
    expect(capRenews(monthly())).toBe(true);
  });
  it("a free-trial card that expires inside its first period does not renew", () => {
    expect(capRenews(monthly({ expiresAt: after(120) }))).toBe(false);
    expect(capRenews(monthly({ expiresAt: after(7 * 24 * 3600) }))).toBe(false);
    expect(capRenews(monthly({ expiresAt: after(MONTH) }))).toBe(false);
  });
  it("a monthly card that outlives its period renews", () => {
    expect(capRenews(monthly({ expiresAt: after(MONTH + 1) }))).toBe(true);
  });
});

describe("blastRadius", () => {
  it("sums live cards; 'ever' holds when no cap renews", () => {
    expect(blastRadius([card(), monthly({ expiresAt: after(120) })])).toEqual({ base: 43_490_000n, count: 2, renews: false });
  });
  it("flags a renewing monthly cap, so the UI says 'this month' instead of 'ever'", () => {
    expect(blastRadius([card(), monthly()])).toEqual({ base: 43_490_000n, count: 2, renews: true });
  });
  it("ignores frozen, revoked and unissued cards, including a renewing one", () => {
    const dead = [monthly({ status: "FROZEN" as CardView["status"] }), monthly({ delegationLive: false }), monthly({ issueState: "pending" as CardView["issueState"] })];
    expect(blastRadius(dead)).toEqual({ base: 0n, count: 0, renews: false });
    expect(blastRadius(null)).toEqual({ base: 0n, count: 0, renews: false });
  });
});
