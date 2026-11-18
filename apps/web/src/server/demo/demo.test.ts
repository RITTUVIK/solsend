import { describe, expect, it } from "vitest";
import { MemoryStore } from "../store";
import { demoCheckout, demoVoid, VOID_NOTE, type DemoDeps } from "./checkout";
import { LithicSim, scrubText } from "./lithic-sim";

const PAN = ["4111", "1111", "1111", "1111"].join(""); // built at runtime: keeps raw-PAN scanners quiet
const PAN_SPACED = ["4111", "1111", "1111", "1111"].join(" ");
const WALLET = "W".repeat(44), OTHER = "X".repeat(44);
const PDA = "C".repeat(44);
const SIG = "5a".repeat(43) + "5";
const sixteen = /(?:\d[ -]?){16}/;

type Call = { method: string; url: string; body?: string };
function fakeFetch(calls: Call[], opts: { authorizeStatus?: number; authorizeBody?: string; txResult?: string } = {}) {
  return async (url: string, init: { method: string; body?: string }) => {
    calls.push({ method: init.method, url, body: init.body });
    const reply = (status: number, body: unknown) => ({ status, ok: status < 300, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
    if (url.endsWith("/v1/cards/lcard-1")) return reply(200, { token: "lcard-1", pan: PAN, cvv: "123", last_four: "1111" });
    if (url.endsWith("/v1/simulate/authorize")) return opts.authorizeStatus ? reply(opts.authorizeStatus, opts.authorizeBody ?? { message: "bad pan " + PAN }) : reply(200, { token: "tx-1" });
    if (url.endsWith("/v1/simulate/void")) return reply(200, {});
    if (url.includes("/v1/transactions/")) return reply(200, { token: "tx-1", status: "VOIDED", result: opts.txResult ?? "APPROVED", events: [] });
    return reply(404, {});
  };
}

async function setup(over: Partial<DemoDeps> = {}, fetchOpts = {}) {
  const store = new MemoryStore();
  await store.insertCard({ card_pda: PDA, owner_wallet: WALLET, card_id: "1", kind: "STORE_LOCKED", label: "l", merchant_name: "TEMU", limit_base: "1000000", period_secs: null, issue_state: "issued", register_signature: null, lithic_card_token: "lcard-1", lithic_last_four: "1111", lithic_error: null });
  const calls: Call[] = [];
  const sim = new LithicSim("test-key-123456", { fetchImpl: fakeFetch(calls, fetchOpts) });
  let t = 0;
  const deps: DemoDeps = { store, sim, wallet: WALLET, enabled: true, maxCents: 5000, sleep: async () => { t += 250; }, now: () => t, ...over };
  return { store, calls, deps };
}
const req = { cardPda: PDA, merchant: "TEMU", amountCents: 150 };

describe("demo merchant checkout", () => {
  it("approved: reads the ASA row, returns SANDBOX response with the explorer link; PAN only goes to simulate/authorize", async () => {
    const { store, calls, deps } = await setup();
    await store.upsertAuthorization({ lithic_token: "tx-1", decision: "APPROVED", settle_signature: SIG, card_pda: PDA });
    await store.insertFeedEvent({ owner_wallet: WALLET, card_pda: PDA, kind: "settled", amount_base: "1500000", remaining_base: "8500000", signature: SIG, lithic_token: "tx-1", merchant: null, reason: null, source: "quicknode", slot: 1 });
    const r = await demoCheckout(req, deps);
    expect(r).toMatchObject({ decision: "APPROVED", label: "SANDBOX", settleSignature: SIG, remainingBase: "8500000", lithicToken: "tx-1" });
    expect(r.explorer).toContain(SIG);
    const auth = calls.find((c) => c.url.endsWith("/simulate/authorize"))!;
    expect(JSON.parse(auth.body!)).toMatchObject({ amount: 150, descriptor: "TEMU (SANDBOX)", mcc: "5399", merchant_acceptor_id: "SOLSENDDEMOTEMU01" });
    expect(sixteen.test(JSON.stringify(r))).toBe(false);
    expect(calls.every((c) => c.url.startsWith("https://sandbox.lithic.com/"))).toBe(true);
  });
  it("declined row -> DECLINED with the reason", async () => {
    const { store, deps } = await setup();
    await store.upsertAuthorization({ lithic_token: "tx-1", decision: "INSUFFICIENT_FUNDS", reason: "over cap" });
    expect(await demoCheckout(req, deps)).toMatchObject({ decision: "DECLINED", reason: "over cap", settleSignature: null });
  });
  it("no row within the poll window -> falls back to the Lithic transaction", async () => {
    const { deps } = await setup({}, { txResult: "APPROVED" });
    expect(await demoCheckout(req, deps)).toMatchObject({ decision: "APPROVED", lithicResult: "APPROVED", settleSignature: null });
  });
  it("PAN never appears in errors or responses (Lithic error echoing the PAN is scrubbed)", async () => {
    const { deps } = await setup({}, { authorizeStatus: 400, authorizeBody: JSON.stringify({ code: `INVALID_PAN ${PAN} ${PAN_SPACED}`, message: PAN }) });
    const err = await demoCheckout(req, deps).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(PAN);
    expect(sixteen.test((err as Error).message)).toBe(false);
    expect(sixteen.test(JSON.stringify(err))).toBe(false);
    expect(sixteen.test(String((err as Error).stack ?? "").split("\n")[0]!)).toBe(false);
    expect(scrubText(`x ${PAN} y ${PAN_SPACED.replaceAll(" ", "-")}`, PAN)).not.toMatch(sixteen);
  });
  it("network failure text carries no PAN", async () => {
    const { store } = await setup();
    const sim = new LithicSim("k-12345678901", { fetchImpl: async (u) => { if (u.includes("/cards/")) return { status: 200, ok: true, text: async () => JSON.stringify({ pan: PAN }) }; throw new Error("connect ECONNREFUSED " + PAN); } });
    const err = await demoCheckout(req, { store, sim, wallet: WALLET, enabled: true, maxCents: 5000 }).catch((e: Error) => e);
    expect((err as Error).message).not.toMatch(sixteen);
  });
  it("guards: disabled 403, too large 400, foreign card 404, not issued 409, bad input 400", async () => {
    const { store, deps } = await setup();
    await expect(demoCheckout(req, { ...deps, enabled: false })).rejects.toMatchObject({ status: 403 });
    await expect(demoCheckout({ ...req, amountCents: 3000 }, { ...deps, maxCents: 2000 })).rejects.toMatchObject({ status: 400 });
    await expect(demoCheckout({ ...req, amountCents: 9999 }, deps)).rejects.toMatchObject({ status: 400 });
    await expect(demoCheckout(req, { ...deps, wallet: OTHER })).rejects.toMatchObject({ status: 404 });
    await store.updateCard(PDA, { issue_state: "lithic_failed" });
    await expect(demoCheckout(req, deps)).rejects.toMatchObject({ status: 409 });
    await expect(demoCheckout({ nope: 1 }, deps)).rejects.toMatchObject({ status: 400 });
  });
  it("rate limits: 11th request in a minute for one wallet -> 429", async () => {
    const { store, deps } = await setup();
    await store.upsertAuthorization({ lithic_token: "tx-1", decision: "APPROVED" });
    for (let i = 0; i < 10; i++) await demoCheckout(req, deps);
    await expect(demoCheckout(req, deps)).rejects.toMatchObject({ status: 429 });
  });
  it("refuses any non-sandbox host", () => {
    expect(() => new LithicSim("k-12345678901", { base: "https://api.lithic.com" })).toThrow(/sandbox/);
  });
});

describe("demo merchant void", () => {
  it("returns the refund signature once the reconciler writes it; fixed note", async () => {
    const { store, calls, deps } = await setup();
    await store.upsertAuthorization({ lithic_token: "tx-1", decision: "APPROVED", card_pda: PDA, settle_signature: SIG });
    let polls = 0;
    const sleep = async () => { if (++polls === 2) await store.upsertAuthorization({ lithic_token: "tx-1", refund_signature: "R".repeat(87) }); };
    const r = await demoVoid({ lithicToken: "tx-1" }, { ...deps, sleep });
    expect(r.refundSignature).toBe("R".repeat(87));
    expect(r.note).toBe(VOID_NOTE);
    expect(r.lithicStatus).toBe("VOIDED");
    expect(calls.some((c) => c.url.endsWith("/simulate/void"))).toBe(true);
  });
  it("no refund within the window -> refundSignature null; foreign authorization 404", async () => {
    const { store, deps } = await setup();
    await store.upsertAuthorization({ lithic_token: "tx-1", decision: "APPROVED", card_pda: PDA });
    expect((await demoVoid({ lithicToken: "tx-1" }, deps)).refundSignature).toBeNull();
    await expect(demoVoid({ lithicToken: "tx-1" }, { ...deps, wallet: OTHER })).rejects.toMatchObject({ status: 404 });
    await expect(demoVoid({ lithicToken: "missing" }, deps)).rejects.toMatchObject({ status: 404 });
  });
});
