import { describe, expect, it } from "vitest";
import { defaultProductIndex } from "./store-default";

const usdc = (dollars: number) => BigInt(Math.round(dollars * 100)) * 10_000n;
const TEMU = ["5", "12", "45"];
const NETFLIX = ["15.49", "22.99"];

describe("defaultProductIndex", () => {
  it("keeps the usual second product when the wallet covers it", () => {
    expect(defaultProductIndex(TEMU, usdc(13))).toBe(1);
    expect(defaultProductIndex(TEMU, usdc(12))).toBe(1);
    expect(defaultProductIndex(TEMU, usdc(100))).toBe(1);
  });

  it("a new wallet with one $5 faucet claim gets the $5 product, not a decline for funds", () => {
    expect(defaultProductIndex(TEMU, usdc(5))).toBe(0);
    expect(defaultProductIndex(TEMU, usdc(11.99))).toBe(0);
  });

  it("keeps the usual product when the balance is unknown or covers nothing", () => {
    expect(defaultProductIndex(TEMU, null)).toBe(1);
    expect(defaultProductIndex(TEMU, 0n)).toBe(1);
    expect(defaultProductIndex(TEMU, usdc(4.99))).toBe(1);
  });

  it("handles cents and short product lists", () => {
    expect(defaultProductIndex(NETFLIX, usdc(15.49))).toBe(0);
    expect(defaultProductIndex(NETFLIX, usdc(22.99))).toBe(1);
    expect(defaultProductIndex(NETFLIX, usdc(16))).toBe(0);
    expect(defaultProductIndex(["9"], usdc(1))).toBe(0);
    expect(defaultProductIndex([], usdc(1))).toBe(0);
  });
});
