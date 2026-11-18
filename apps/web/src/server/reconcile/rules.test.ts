import { describe, expect, it } from "vitest";
import { decideReconcile, NOT_FOUND_GRACE_SECS, PENDING_SWEEP_WINDOW_SECS } from "./rules";

const rec = (amount: bigint, refunded = 0n) => ({ amount, refunded });
const D = (decision: string, lithicStatus: string | null, record: ReturnType<typeof rec> | null, ageSecs = 120) => decideReconcile({ decision, lithicStatus, record, ageSecs });

describe("reconciler rule matrix (Lithic status is the source of truth)", () => {
  it.each(["DECLINED", "VOIDED", "EXPIRED"])("%s + record with remainder → refund the remainder, whatever we replied", (s) => {
    expect(D("APPROVED", s, rec(1_140_000n))).toEqual({ action: "refund", amount: 1_140_000n }); // void of an approved auth
    expect(D("INSUFFICIENT_FUNDS", s, rec(770_000n))).toEqual({ action: "refund", amount: 770_000n }); // late settle after our decline
    expect(D("APPROVED", s, rec(1_000_000n, 400_000n))).toEqual({ action: "refund", amount: 600_000n }); // partial already refunded
  });
  it.each(["DECLINED", "VOIDED", "EXPIRED"])("%s + no record / fully refunded → done, no refund", (s) => {
    expect(D("INSUFFICIENT_FUNDS", s, null)).toEqual({ action: "done", tag: "none" });
    expect(D("APPROVED", s, rec(5n, 5n))).toEqual({ action: "done", tag: "already_refunded" });
  });
  it("result stays APPROVED after a void: status drives the decision (CP0b S2 T3)", () => {
    expect(D("APPROVED", "VOIDED", rec(1_140_000n)).action).toBe("refund");
  });
  it("SETTLED → done; SETTLED without record → anomaly", () => {
    expect(D("APPROVED", "SETTLED", rec(1n))).toEqual({ action: "done", tag: "settled" });
    expect(D("APPROVED", "SETTLED", null)).toEqual({ action: "anomaly", tag: "anomaly_approved_without_record" });
  });
  it("PENDING → wait; APPROVED without record → anomaly; old approved pending leaves the sweep", () => {
    expect(D("APPROVED", "PENDING", rec(1n)).action).toBe("wait");
    expect(D("APPROVED", "PENDING", null)).toEqual({ action: "anomaly", tag: "anomaly_approved_without_record" });
    expect(D("APPROVED", "PENDING", rec(1n), PENDING_SWEEP_WINDOW_SECS + 1)).toEqual({ action: "done", tag: "approved_pending_settlement" });
    expect(D("INSUFFICIENT_FUNDS", "PENDING", rec(1n)).action).toBe("wait");
  });
  it("unknown Lithic status (lookup failed) → wait, never refund blindly", () => {
    expect(D("INSUFFICIENT_FUNDS", null, rec(9n)).action).toBe("wait");
    expect(D("APPROVED", "SOMETHING_NEW", rec(9n)).action).toBe("wait");
  });
  it("NOT_FOUND (MOCK): grace period, then refund late settles of declines; approved stays", () => {
    expect(D("INSUFFICIENT_FUNDS", "NOT_FOUND", rec(9n), NOT_FOUND_GRACE_SECS - 1).action).toBe("wait");
    expect(D("INSUFFICIENT_FUNDS", "NOT_FOUND", rec(9n))).toEqual({ action: "refund", amount: 9n });
    expect(D("APPROVED", "NOT_FOUND", rec(9n))).toEqual({ action: "done", tag: "not_in_lithic_approved" });
    expect(D("APPROVED", "NOT_FOUND", null).action).toBe("anomaly");
  });
});
