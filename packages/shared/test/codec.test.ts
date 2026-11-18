import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  IDL, ixSettle, ixRefund, ixRegisterCard, decodeCard, decodeSolsendEventBytes, decodeSolsendEventsFromLogs, cardPda, cardDelegation,
  subscriptionAuthorityPda, settlementRecordPda, bytesToBase64, concat, u64le, label32, label32ToString, centsToBase, formatUsdc, SOLSEND_PROGRAM_ID,
} from "../src/index.js";

const disc = (n: string) => IDL.instructions.find((i) => i.name === n)!.discriminator;
const ev = (n: string) => IDL.events!.find((e) => e.name === n)!.discriminator;

describe("IDL contract matches CP0b-proven values", () => {
  it("instruction + event discriminators unchanged from the validated spike", () => {
    expect(disc("settle")).toEqual([175, 42, 185, 87, 144, 131, 102, 212]);
    expect(disc("refund")).toEqual([2, 96, 183, 251, 63, 208, 46, 46]);
    expect(disc("register_card")).toEqual([33, 25, 154, 111, 155, 31, 45, 36]);
    expect(ev("CardSettled")).toEqual([34, 206, 169, 204, 178, 170, 227, 94]);
    expect(ev("CardRefunded")).toEqual([212, 19, 183, 194, 172, 112, 247, 175]);
  });
  it("settle ix: data layout + account order follow the IDL", () => {
    const settler = Keypair.generate().publicKey, owner = Keypair.generate().publicKey;
    const h = new Uint8Array(32).fill(7), m = new Uint8Array(32).fill(9);
    const ix = ixSettle({ settler, owner, cardId: 5n, amount: 2_317_000n, authHash: h, merchantHash: m });
    expect(ix.programId.equals(SOLSEND_PROGRAM_ID)).toBe(true);
    expect([...ix.data]).toEqual([...disc("settle"), ...u64le(2_317_000n), ...h, ...m]);
    const card = cardPda(owner, 5n);
    expect(ix.keys[0]!.pubkey.equals(settler) && ix.keys[0]!.isSigner).toBe(true);
    expect(ix.keys[2]!.pubkey.equals(card)).toBe(true);
    expect(ix.keys[3]!.pubkey.equals(settlementRecordPda(h))).toBe(true);
    expect(ix.keys[4]!.pubkey.equals(cardDelegation(owner, 5n))).toBe(true);
    expect(ix.keys[5]!.pubkey.equals(subscriptionAuthorityPda(owner))).toBe(true);
    expect(ix.keys.length).toBe(IDL.instructions.find((i) => i.name === "settle")!.accounts.length);
  });
  it("refund + register builders encode", () => {
    const owner = Keypair.generate().publicKey;
    expect(ixRefund({ settler: owner, owner, cardId: 1n, amount: 1n, authHash: new Uint8Array(32) }).data.length).toBe(8 + 8 + 32);
    expect(ixRegisterCard({ owner, payer: owner, cardId: 1n, kind: 0, label: "Temu" }).data.length).toBe(8 + 8 + 1 + 8 + 32 + 32);
    const lock = new Uint8Array(32).fill(5);
    expect([...ixRegisterCard({ owner, payer: owner, cardId: 1n, kind: 0, label: "Temu", merchantLock: lock }).data.slice(-32)]).toEqual([...lock]);
  });
  it("events decode from logs, scoped to our program only", () => {
    const card = Keypair.generate().publicKey, owner = Keypair.generate().publicKey;
    const payload = concat(Uint8Array.from(ev("CardSettled")), card.toBytes(), owner.toBytes(), u64le(100n), u64le(900n),
      new Uint8Array(32).fill(1), new Uint8Array(32).fill(2), u64le(100n), Uint8Array.of(0));
    const line = `Program data: ${bytesToBase64(payload)}`;
    const P = SOLSEND_PROGRAM_ID.toBase58(), A = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
    const logs = [`Program ${P} invoke [1]`, `Program ${A} invoke [2]`, line /* decoy inside CPI */, `Program ${A} success`, line, `Program ${P} success`];
    const out = decodeSolsendEventsFromLogs(logs);
    expect(out.length).toBe(1);
    expect(out[0]!.name).toBe("CardSettled");
    expect((out[0]!.data.amount as bigint)).toBe(100n);
    expect((out[0]!.data.card as PublicKey).equals(card)).toBe(true);
    expect(decodeSolsendEventBytes(new Uint8Array(40))).toBeNull();
  });
  it("account decode rejects wrong discriminator; helpers", () => {
    expect(decodeCard(new Uint8Array(300))).toBeNull();
    expect(label32ToString(label32("Temu card ✓"))).toBe("Temu card ✓");
    expect(centsToBase(2317)).toBe(23_170_000n);
    expect(formatUsdc(23_170_000n)).toBe("23.17");
  });
});

import { authCommitmentHex, merchantCommitment, lithicCardConfig, ASA_SETTLE_STATUSES, toHex } from "../src/index.js";
import { createHash } from "node:crypto";
describe("security-review amendments", () => {
  it("commitments are domain-separated sha256 (verifiable with node crypto)", async () => {
    const t = "934ca60c-f410-47e7-ac06-41f9994d9e4b";
    expect(await authCommitmentHex(t)).toBe(createHash("sha256").update("solsend:auth:v1:" + t).digest("hex"));
    expect(toHex(await merchantCommitment("SOLSENDTEMU01"))).toBe(createHash("sha256").update("solsend:merchant:v1:SOLSENDTEMU01").digest("hex"));
    expect(await authCommitmentHex(t)).not.toBe(createHash("sha256").update(t).digest("hex"));
  });
  it("Lithic outer limits are 2x onchain and never MERCHANT_LOCKED", () => {
    expect(lithicCardConfig("STORE_LOCKED", 4000)).toEqual({ type: "VIRTUAL", spend_limit: 8000, spend_limit_duration: "FOREVER" });
    expect(lithicCardConfig("ONE_TIME", 2500).type).toBe("SINGLE_USE");
    expect(lithicCardConfig("SUBSCRIPTION", 1549).spend_limit_duration).toBe("MONTHLY");
    expect(ASA_SETTLE_STATUSES.has("BALANCE_INQUIRY")).toBe(false);
    expect(ASA_SETTLE_STATUSES.has("CREDIT_AUTHORIZATION")).toBe(false);
  });
  it("close_settlement_record builder is gone", async () => {
    const mod = await import("../src/index.js");
    expect("ixCloseSettlementRecord" in mod).toBe(false);
  });
});

import { ixRevokeDelegation, readDelegation } from "../src/index.js";
describe("W1 finding: sponsored delegation revoke needs the sponsor as writable receiver", () => {
  it("adds receiver only when it differs from owner; readDelegation exposes payer", () => {
    const owner = Keypair.generate().publicKey, d = Keypair.generate().publicKey, sponsor = Keypair.generate().publicKey;
    const ix = ixRevokeDelegation(owner, d, sponsor);
    expect(ix.keys.length).toBe(3);
    expect(ix.keys[2]!.pubkey.equals(sponsor) && ix.keys[2]!.isWritable && !ix.keys[2]!.isSigner).toBe(true);
    expect(ixRevokeDelegation(owner, d, owner).keys.length).toBe(2);
    const data = new Uint8Array(187); data.set(owner.toBytes(), 3); data.set(d.toBytes(), 35); data.set(sponsor.toBytes(), 67);
    expect(readDelegation(data)!.payer.equals(sponsor)).toBe(true);
  });
});
