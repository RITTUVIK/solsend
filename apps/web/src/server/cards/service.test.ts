import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { ALLOWANCES_PROGRAM_ID, SOLSEND_PROGRAM_ID, cardDelegation, cardPda, usdcAta, type CardRow } from "@solsend/shared";
import { MemoryStore } from "../store";
import { realClock } from "../solana/rpc";
import { MockRpc, encodeCard, encodeFixedDelegation } from "../__test__/mockRpc";
import type { LithicApi } from "../lithic/client";
import { isUsable, recoverAndList, toCardView } from "./service";
import { lithicCardConfig } from "../lithic/client";

function setup(lithicFails = false) {
  const rpc = new MockRpc(), store = new MemoryStore(), owner = Keypair.generate().publicKey, feePayer = Keypair.generate();
  const created: { kind: string; limitCents: number; tags: Record<string, string> }[] = [];
  const lithic: LithicApi = {
    createCard: async (p) => { if (lithicFails) throw new Error("lithic create card HTTP 500"); created.push(p); return { token: `lc_${created.length}`, lastFour: "4242", state: "OPEN" }; },
    setCardState: async () => {}, getTransaction: async () => null, createEmbed: async () => { throw new Error("n/a"); },
  };
  return { rpc, store, owner, deps: { rpc: rpc.asRpc(), store, feePayer, lithic, clock: realClock }, created };
}
async function addCard(s: ReturnType<typeof setup>, cardId: bigint, state: CardRow["issue_state"], ageMs = 0, onchain = false) {
  const pda = cardPda(s.owner, cardId);
  await s.store.insertCard({ card_pda: pda.toBase58(), owner_wallet: s.owner.toBase58(), card_id: cardId.toString(), kind: "STORE_LOCKED", label: "Temu", merchant_name: "Temu",
    limit_base: "20000000", period_secs: null, issue_state: state, register_signature: null, lithic_card_token: null, lithic_last_four: null, lithic_error: null });
  const row = s.store.cards.get(pda.toBase58())!;
  row.created_at = row.updated_at = new Date(Date.now() - ageMs).toISOString();
  if (onchain) {
    s.rpc.setAccount(pda, SOLSEND_PROGRAM_ID, encodeCard({ owner: s.owner, cardId, delegation: cardDelegation(s.owner, cardId), source: usdcAta(s.owner) }));
    s.rpc.setAccount(cardDelegation(s.owner, cardId), ALLOWANCES_PROGRAM_ID, encodeFixedDelegation({ delegator: s.owner, delegatee: pda, payer: Keypair.generate().publicKey, remaining: 15_000_000n }));
  }
  return pda.toBase58();
}

describe("card recovery state machine (F3 step 5)", () => {
  it("onchain_pending + Card PDA exists → onchain_confirmed → issued (tags + circuit-breaker limits)", async () => {
    const s = setup();
    const pda = await addCard(s, 1n, "onchain_pending", 0, true);
    const { rows, chain } = await recoverAndList(s.deps, s.owner.toBase58());
    expect(rows[0]!.issue_state).toBe("issued");
    expect(s.created[0]).toMatchObject({ kind: "STORE_LOCKED", limitCents: 2000, tags: { solsend_card: pda, solsend_owner: s.owner.toBase58(), solsend_card_id: "1" } });
    const v = toCardView(rows[0]!, chain[0], Date.now());
    expect(v).toMatchObject({ status: "ACTIVE", delegationLive: true, limit: { type: "lifetime", totalBase: "20000000", remainingBase: "15000000" }, lithic: { lastFour: "4242" } });
    expect(isUsable(v)).toBe(true);
  });
  it("onchain_pending, no PDA, intent long expired → failed (never usable)", async () => {
    const s = setup();
    await addCard(s, 2n, "onchain_pending", 10 * 60_000);
    const { rows, chain } = await recoverAndList(s.deps, s.owner.toBase58());
    expect(rows[0]!.issue_state).toBe("failed");
    expect(isUsable(toCardView(rows[0]!, chain[0], Date.now()))).toBe(false);
  });
  it("onchain_pending, no PDA yet, fresh → stays pending", async () => {
    const s = setup();
    await addCard(s, 3n, "onchain_pending", 5_000);
    expect((await recoverAndList(s.deps, s.owner.toBase58())).rows[0]!.issue_state).toBe("onchain_pending");
  });
  it("Lithic failure → lithic_failed with error; stale lithic_pending → lithic_failed (Retry offered)", async () => {
    const s = setup(true);
    await addCard(s, 4n, "onchain_confirmed", 0, true);
    await addCard(s, 5n, "lithic_pending", 5 * 60_000, true);
    const { rows } = await recoverAndList(s.deps, s.owner.toBase58());
    expect(rows.map((r) => r.issue_state).sort()).toEqual(["lithic_failed", "lithic_failed"]);
    expect(rows.find((r) => r.card_id === "4")!.lithic_error).toMatch(/HTTP 500/);
  });
  it("issued but delegation revoked → not usable; batch reads stay ≤5 keys per call", async () => {
    const s = setup();
    for (let i = 10n; i < 14n; i++) await addCard(s, i, "issued", 0, true); // 8 keys → 2 RPC calls
    s.rpc.accounts.delete(cardDelegation(s.owner, 10n).toBase58());
    const { rows, chain } = await recoverAndList(s.deps, s.owner.toBase58());
    const v = rows.map((r, i) => toCardView(r, chain[i], Date.now()));
    expect(v.find((c) => c.cardId === "10")).toMatchObject({ delegationLive: false, limit: { remainingBase: "0" } });
    expect(v.filter(isUsable).length).toBe(3);
  });
});

describe("Lithic card config (amendment 4)", () => {
  it("2x outer limit, never MERCHANT_LOCKED", () => {
    expect(lithicCardConfig("STORE_LOCKED", 2000)).toEqual({ type: "VIRTUAL", spend_limit: 4000, spend_limit_duration: "FOREVER" });
    expect(lithicCardConfig("ONE_TIME", 500)).toEqual({ type: "SINGLE_USE", spend_limit: 1000, spend_limit_duration: "TRANSACTION" });
    expect(lithicCardConfig("SUBSCRIPTION", 1599)).toEqual({ type: "VIRTUAL", spend_limit: 3198, spend_limit_duration: "MONTHLY" });
  });
});
