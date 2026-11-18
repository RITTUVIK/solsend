// Units: Lithic amounts are USD cents; USDC base units have 6 decimals → 1 cent = 10_000 base units.
export const CENT_IN_BASE = 10_000n;
export const centsToBase = (cents: number): bigint => {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`invalid cents: ${cents}`);
  return BigInt(cents) * CENT_IN_BASE;
};
export const baseToCents = (base: bigint): number => Number(base / CENT_IN_BASE);
export const formatUsdc = (base: bigint | string | number): string => {
  const b = BigInt(base);
  const whole = b / 1_000_000n;
  const frac = (b % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole.toString()}.${frac}`;
};
export const formatUsd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
