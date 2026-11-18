import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { bytesToBase64 } from "@solsend/shared";
import bs58 from "bs58";
import { MemoryStore } from "../store";
import { cosign, createIntent, splitWire, takeIntent, verifySignedAgainstIntent } from "./intents";

const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

async function setup() {
  const store = new MemoryStore();
  const owner = Keypair.generate(), feePayer = Keypair.generate();
  const tx = new Transaction({ feePayer: feePayer.publicKey, blockhash: bs58.encode(new Uint8Array(32).fill(3)), lastValidBlockHeight: 10 })
    .add(new TransactionInstruction({ programId: MEMO, keys: [{ pubkey: owner.publicKey, isSigner: true, isWritable: false }], data: Buffer.from("solsend test") }));
  const prepared = await createIntent(store, { owner: owner.publicKey.toBase58(), kind: "create_card", cardPda: null, tx, nowMs: Date.now() });
  const intent = (await store.getIntent(prepared.intentId))!;
  return { store, owner, feePayer, prepared, intent };
}
/** Simulate Privy: partial-sign the exact wire bytes we handed out (no re-serialization). */
function ownerSign(txBase64: string, owner: Keypair, mutate?: (msg: Uint8Array) => void) {
  const wire = Uint8Array.from(Buffer.from(txBase64, "base64"));
  const { sigOffset, message } = splitWire(wire);
  mutate?.(message);
  const sig = nacl.sign.detached(message, owner.secretKey);
  wire.set(sig, sigOffset + 64); // owner is signer #1 (fee payer #0)
  return bytesToBase64(wire);
}

describe("fee-payer cosign gate (byte-identical intent, CP0b G0.8)", () => {
  it("accepts the exact prepared message with a valid owner signature; cosign verifies", async () => {
    const { owner, feePayer, prepared, intent } = await setup();
    const v = verifySignedAgainstIntent(intent, ownerSign(prepared.txBase64, owner), { owner: owner.publicKey.toBase58(), feePayer: feePayer.publicKey, nowMs: Date.now() });
    const { wire } = cosign(v, feePayer);
    const tx = Transaction.from(Buffer.from(wire));
    expect(tx.verifySignatures(true)).toBe(true);
  });
  it("rejects a modified message (even one byte), with the owner's valid signature over it", async () => {
    const { owner, feePayer, prepared, intent } = await setup();
    const tampered = ownerSign(prepared.txBase64, owner, (m) => { m[m.length - 1] ^= 1; });
    expect(() => verifySignedAgainstIntent(intent, tampered, { owner: owner.publicKey.toBase58(), feePayer: feePayer.publicKey, nowMs: Date.now() })).toThrow(/does not match/);
  });
  it("rejects a missing/invalid owner signature, another wallet, an expired intent", async () => {
    const { owner, feePayer, prepared, intent } = await setup();
    const p = { owner: owner.publicKey.toBase58(), feePayer: feePayer.publicKey, nowMs: Date.now() };
    expect(() => verifySignedAgainstIntent(intent, prepared.txBase64, p)).toThrow(/owner signature invalid/);
    expect(() => verifySignedAgainstIntent(intent, ownerSign(prepared.txBase64, Keypair.generate()), p)).toThrow(/owner signature invalid/);
    expect(() => verifySignedAgainstIntent(intent, ownerSign(prepared.txBase64, owner), { ...p, owner: Keypair.generate().publicKey.toBase58() })).toThrow(/another wallet/);
    expect(() => verifySignedAgainstIntent(intent, ownerSign(prepared.txBase64, owner), { ...p, nowMs: Date.now() + 3 * 60_000 })).toThrow(/expired/);
  });
  it("rejects a tx whose fee payer differs from ours", async () => {
    const { owner, prepared, intent } = await setup();
    expect(() => verifySignedAgainstIntent(intent, ownerSign(prepared.txBase64, owner), { owner: owner.publicKey.toBase58(), feePayer: SystemProgram.programId, nowMs: Date.now() })).toThrow(/fee payer/);
  });
  it("intent is consumed atomically: second submit is refused", async () => {
    const { store, owner, feePayer, prepared } = await setup();
    const signed = ownerSign(prepared.txBase64, owner);
    const p = { owner: owner.publicKey.toBase58(), feePayer: feePayer.publicKey, nowMs: Date.now() };
    await takeIntent(store, prepared.intentId, signed, p);
    await expect(takeIntent(store, prepared.intentId, signed, p)).rejects.toThrow(/already used/);
  });
});
