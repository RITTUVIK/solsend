// Wallet (Privy) signing errors. Privy wraps the real reason: closing its signing window rejects with
//   PrivyClientError("Failed to connect to wallet", cause: Error("User exited the modal before submitting the transaction"),
//                    privyErrorCode: "transaction_failure")      (@privy-io/react-auth 3.51.0, signTransaction modal path)
// so the top-level message alone is misleading. Always inspect the cause chain.

/** Messages along an error's `cause` chain (outermost first, max 4 levels). */
export function causeMessages(e: unknown): string[] {
  const out: string[] = [];
  let x: unknown = e;
  for (let i = 0; i < 4 && x instanceof Error; i++) {
    if (x.message) out.push(x.message);
    x = (x as { cause?: unknown }).cause;
  }
  return out;
}

/** The owner closed or rejected the wallet's approval window (nothing was signed). */
export function isUserCancel(e: unknown): boolean {
  return causeMessages(e).some((m) => /reject|denied|cancel|user exited/i.test(m));
}

/** Privy's generic wrapper for a signing failure that is NOT a cancel (no signature was produced). */
export function isWalletSignFailure(e: unknown): boolean {
  return causeMessages(e).some((m) => /failed to connect to wallet|failed to sign transaction/i.test(m));
}
