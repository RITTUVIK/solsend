// Rehearsal 2026-11-18: cancelling Privy's signing window showed "Failed to connect to wallet".
import { describe, expect, it } from "vitest";
import { causeMessages, isUserCancel, isWalletSignFailure } from "./wallet-errors";

// Shape thrown by @privy-io/react-auth 3.51.0 when the user closes the signTransaction window.
const privyExit = Object.assign(new Error("Failed to connect to wallet", { cause: new Error("User exited the modal before submitting the transaction") }), { privyErrorCode: "transaction_failure" });

describe("wallet error classification", () => {
  it("Privy's wrapped exit is a cancel (reason is in the cause, not the message)", () => {
    expect(causeMessages(privyExit)).toEqual(["Failed to connect to wallet", "User exited the modal before submitting the transaction"]);
    expect(isUserCancel(privyExit)).toBe(true);
  });
  it("direct rejections are cancels", () => {
    expect(isUserCancel(new Error("The user rejected the request."))).toBe(true);
    expect(isUserCancel(new Error("User exited flow"))).toBe(true);
  });
  it("a genuine wallet failure is not a cancel, but is recognised as a sign failure", () => {
    const e = new Error("Failed to connect to wallet", { cause: new Error("iframe timeout") });
    expect(isUserCancel(e)).toBe(false);
    expect(isWalletSignFailure(e)).toBe(true);
  });
  it("unrelated errors are neither", () => {
    expect(isUserCancel(new Error("network down"))).toBe(false);
    expect(isWalletSignFailure("nope")).toBe(false);
  });
});
