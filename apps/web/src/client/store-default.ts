// Which demo-store product to preselect for a card.
// The usual pick is the second product (Temu: Earbuds $12). A brand-new wallet holds one faucet claim (5 test USDC by
// default), so that pick would decline for wallet balance on a judge's very first try. When the wallet can't cover the
// usual pick, preselect the priciest product it can cover instead. An empty or unknown wallet keeps the usual pick, and
// the decline sheet explains how to add test USDC.

/** "12" or "15.49" dollars as USDC base units (6 decimals). */
const toBase = (dollars: string): bigint => BigInt(Math.round(Number(dollars) * 100)) * 10_000n;

export function defaultProductIndex(dollars: readonly string[], walletBase: bigint | null): number {
  if (dollars.length === 0) return 0;
  const usual = Math.min(1, dollars.length - 1);
  if (walletBase === null || toBase(dollars[usual]!) <= walletBase) return usual;
  let best = -1;
  dollars.forEach((d, i) => {
    if (toBase(d) <= walletBase && (best < 0 || toBase(d) > toBase(dollars[best]!))) best = i;
  });
  return best >= 0 ? best : usual;
}
