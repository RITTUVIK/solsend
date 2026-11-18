// Free-trial cards: onchain delegation expiry (prepare → CardView → ASA mapping) + remaining on the approved feed row.
import { describe, expect, it } from "vitest";
import { Keypair, Transaction } from "@solana/web3.js";
import {
  ALLOWANCES_PROGRAM_ID, SOLSEND_PROGRAM_ID, cardDelegation, cardPda, concat, i64le, subscriptionAuthorityPda, u64le, usdcAta, USDC_MINT, type CardRow,
} from "@solsend/shared";
import { MemoryStore } from "../store";
import { realClock } from "../solana/rpc";
import { MockRpc, encodeCard, encodeFixedDelegation } from "../__test__/mockRpc";
import { mapSettleError, reasonForRow, reasonText } from "../asa/errors";
import { afterAsaReply, remainingAfterSettle } from "../asa/after";
import type { AsaDecision } from "../asa/engine";
import type { LithicApi } from "../lithic/client";
import { delegationExpiry, isUsable, prepareCard, toCardView } from "./service";
import { readChainCards } from "./chain";

const lithic = { createCard: async () => ({ token: "lc", lastFour: "1", state: "OPEN" }), setCardState: async () => {}, getTransaction: async () => null, createEmbed: async () => { throw new Error("n/a"); } } as LithicApi;

function withExpiry(data: Uint8Array, expiryTs: bigint) { const d = Uint8Array.from(data); d.set(i64le(expiryTs), 179); return d; }

describe("free-trial expiry: ASA mapping", () => {
  it("Allowances 128 delegationExpired → CARD_PAUSED 'card expired (free trial ended)'", () => {
    const m = mapSettleError({ InstructionError: [1, { Custom: 128 }] });
    expect(m).toEqual({ duplicate: false, result: "CARD_PAUSED", reason: "card_expired" });
    expect(reasonText("card_expired")).toBe("card expired (free trial ended)");
    expect(reasonForRow("card_expired")).toBe("card expired (free trial ended)"); // authorizations.reason → Demo Merchant reason
  });
  it("merchant-lock reason is honest about where the store ID comes from", () => {
    expect(reasonForRow("merchant_mismatch")).toBe("Card locked to another store (store ID reported by the card network, enforced onchain)");
  });
});

describe("free-trial expiry: CardView", () => {
  const owner = Keypair.generate().publicKey, cardId = 3n, pda = cardPda(owner, cardId);
  async function view(expiryTs: bigint, nowMs: number) {
    const rpc = new MockRpc();
    rpc.setAccount(pda, SOLSEND_PROGRAM_ID, encodeCard({ owner, cardId, delegation: cardDelegation(owner, cardId), source: usdcAta(owner) }));
    rpc.setAccount(cardDelegation(owner, cardId), ALLOWANCES_PROGRAM_ID, withExpiry(encodeFixedDelegation({ delegator: owner, delegatee: pda, payer: owner, remaining: 1_000_000n }), expiryTs));
    const [c] = await readChainCards(rpc.asRpc(), [{ owner, cardId }]);
    const row: CardRow = { card_pda: pda.toBase58(), owner_wallet: owner.toBase58(), card_id: "3", kind: "STORE_LOCKED", label: "trial", merchant_name: "Netflix", limit_base: "1000000",
      period_secs: null, issue_state: "issued", register_signature: null, lithic_card_token: "lc", lithic_last_four: "1", lithic_error: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    return toCardView(row, c, nowMs);
  }
  it("no expiry (0) → expiresAt null, not expired", async () => {
    expect(await view(0n, Date.now())).toMatchObject({ expiresAt: null, expired: false });
  });
  it("future expiry → ISO expiresAt, usable; at/after expiry → expired, NOT usable", async () => {
    const exp = BigInt(Math.floor(Date.now() / 1000)) + 120n;
    const before = await view(exp, Date.now());
    expect(before).toMatchObject({ expiresAt: new Date(Number(exp) * 1000).toISOString(), expired: false });
    expect(isUsable(before)).toBe(true);
    const after = await view(exp, Number(exp) * 1000);
    expect(after.expired).toBe(true);
    expect(isUsable(after)).toBe(false);
  });
  it("revoked delegation → no expiry info", () => {
    expect(delegationExpiry({ card: null, delegation: null, delegationLive: false, delegationPayer: null }, Date.now())).toEqual({ expiresAt: null, expired: false });
  });
});

describe("free-trial expiry: prepareCard writes expiry_ts onchain", () => {
  async function prepared(expiresInMinutes?: number, kind: "STORE_LOCKED" | "SUBSCRIPTION" = "STORE_LOCKED") {
    const rpc = new MockRpc(), store = new MemoryStore(), owner = Keypair.generate().publicKey, feePayer = Keypair.generate();
    const sa = subscriptionAuthorityPda(owner);
    rpc.setAccount(owner, Keypair.generate().publicKey, new Uint8Array(0));
    const ata = new Uint8Array(165); ata.set(USDC_MINT.toBytes(), 0); ata.set(owner.toBytes(), 32); ata.set(u64le(5_000_000n), 64);
    ata.set(Uint8Array.of(1, 0, 0, 0), 72); ata.set(sa.toBytes(), 76); ata.set(u64le(2n ** 64n - 1n), 121); ata[108] = 1;
    rpc.setAccount(usdcAta(owner), Keypair.generate().publicKey, ata);
    rpc.setAccount(sa, ALLOWANCES_PROGRAM_ID, concat(new Uint8Array(98), i64le(42n)));
    const now = Date.now();
    const r = await prepareCard({ rpc: rpc.asRpc(), store, feePayer, lithic, clock: realClock }, owner.toBase58(),
      { kind, label: "trial", merchantName: "Netflix", limitCents: 1599, ...(kind === "SUBSCRIPTION" ? { periodDays: 30 } : {}), ...(expiresInMinutes ? { expiresInMinutes } : {}) });
    const tx = Transaction.from(Buffer.from(r.txBase64, "base64"));
    const ix = tx.instructions.find((i) => i.programId.equals(ALLOWANCES_PROGRAM_ID) && (i.data[0] === 1 || i.data[0] === 2))!;
    const off = ix.data[0] === 1 ? 17 : 33; // fixed: tag1 nonce8 amount8 → expiry; recurring: + period8 + start8
    return { expiry: ix.data.readBigInt64LE(off), now };
  }
  it("fixed: expiresInMinutes → expiry_ts = now + minutes·60; unset → 0 (no expiry)", async () => {
    const { expiry, now } = await prepared(2);
    expect(Number(expiry) - Math.floor(now / 1000)).toBeGreaterThanOrEqual(119);
    expect(Number(expiry) - Math.floor(now / 1000)).toBeLessThanOrEqual(121);
    expect((await prepared()).expiry).toBe(0n);
  });
  it("recurring: trial expiry replaces the 5-year default", async () => {
    const { expiry, now } = await prepared(60 * 24 * 7, "SUBSCRIPTION");
    expect(Math.abs(Number(expiry) - (Math.floor(now / 1000) + 7 * 86_400))).toBeLessThanOrEqual(1);
  });
});

describe("remaining limit on the approved feed row (no QuickNode needed)", () => {
  it("after-hook reads the delegation once and sets remaining_base; USED one-time card → 0", async () => {
    const rpc = new MockRpc(), store = new MemoryStore(), owner = Keypair.generate().publicKey, cardId = 9n, pda = cardPda(owner, cardId);
    rpc.setAccount(pda, SOLSEND_PROGRAM_ID, encodeCard({ owner, cardId, delegation: cardDelegation(owner, cardId), source: usdcAta(owner) }));
    rpc.setAccount(cardDelegation(owner, cardId), ALLOWANCES_PROGRAM_ID, encodeFixedDelegation({ delegator: owner, delegatee: pda, payer: owner, remaining: 3_860_000n }));
    const d: AsaDecision = { result: "APPROVED", reason: "settled_confirmed", token: "tok-1", card: { pda, owner, cardId }, lithicCardToken: null, amountCents: 114, amountBase: 1_140_000n,
      authHashHex: "ab", merchant: { descriptor: "TEMU (SANDBOX)", acceptorId: "A" }, signature: "5sig", confirmedAt: new Date().toISOString(), settleSent: true, timings: { total_ms: 900 } };
    const deps = { rpc: rpc.asRpc(), settler: Keypair.generate(), store, lithic, clock: realClock, blockhash: async () => "11111111111111111111111111111111" };
    await afterAsaReply(deps, d, new Date().toISOString(), { deduped: false });
    expect(store.feed.find((f) => f.kind === "authorization_approved")).toMatchObject({ remaining_base: "3860000", lithic_token: "tok-1" });
    rpc.setAccount(pda, SOLSEND_PROGRAM_ID, encodeCard({ owner, cardId, kind: 1, status: 2, delegation: cardDelegation(owner, cardId), source: usdcAta(owner) }));
    expect(await remainingAfterSettle(deps, { pda, owner, cardId }, Date.now())).toBe("0");
  });
});
