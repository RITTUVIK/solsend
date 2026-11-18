import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { api, concat, DEVNET_GENESIS_HASH, IDL, SOLSEND_PROGRAM_ID, u64le } from "@solsend/shared";
import { MemoryStore } from "../store";
import { lithicPing, runChecks, __resetLithicCache, type RpcLike } from "./checks";

const disc = Uint8Array.from((IDL.accounts ?? []).find((a) => a.name === "Config")!.discriminator);
const k = () => Keypair.generate().publicKey.toBytes();
const configData = (paused: boolean) => concat(disc, k(), k(), k(), k(), u64le(1n), u64le(60n), Uint8Array.of(paused ? 1 : 0), Uint8Array.of(1), Uint8Array.of(1));

const rpc = (o: { genesis?: string; deployed?: boolean; paused?: boolean; lamports?: number; treasury?: boolean } = {}): RpcLike => ({
  getGenesisHash: async () => o.genesis ?? DEVNET_GENESIS_HASH,
  getAccountInfo: async (key) => (key.equals(SOLSEND_PROGRAM_ID) ? (o.deployed === false ? null : { executable: true, data: new Uint8Array() }) : { executable: false, data: configData(!!o.paused) }),
  getBalance: async () => o.lamports ?? 1_000_000_000,
  getTokenAccountBalance: async () => { if (o.treasury === false) throw new Error("nf"); return { value: { uiAmountString: "12.5" } }; },
});
const base = (over = {}) => ({ rpc: rpc(), settler: Keypair.generate().publicKey, feePayer: Keypair.generate().publicKey, store: new MemoryStore(), lithicPing: async () => true, ...over });

describe("status checks", () => {
  it("all green yields a valid StatusResponse", async () => {
    const r = await runChecks(base());
    expect(api.StatusResponse.parse(r).ok).toBe(true);
    expect(r.checks.map((c) => c.name)).toEqual(expect.arrayContaining(["devnet genesis", "program", "settler SOL", "fee payer SOL", "treasury USDC", "lithic sandbox", "store", "quicknode last delivery", "unreconciled authorizations"]));
  });
  it("flags wrong cluster, undeployed program, paused config, low SOL, missing treasury, lithic down", async () => {
    expect((await runChecks(base({ rpc: rpc({ genesis: "x" }) }))).checks.find((c) => c.name === "devnet genesis")!.ok).toBe(false);
    expect((await runChecks(base({ rpc: rpc({ deployed: false }) }))).checks.find((c) => c.name === "program")!.ok).toBe(false);
    const paused = (await runChecks(base({ rpc: rpc({ paused: true }) }))).checks.find((c) => c.name === "program")!;
    expect(paused.ok).toBe(false); expect(paused.detail).toMatch(/PAUSED/);
    expect((await runChecks(base({ rpc: rpc({ lamports: 1000 }) }))).checks.find((c) => c.name === "settler SOL")!.ok).toBe(false);
    expect((await runChecks(base({ rpc: rpc({ treasury: false }) }))).checks.find((c) => c.name === "treasury USDC")!.ok).toBe(false);
    expect((await runChecks(base({ lithicPing: async () => false }))).ok).toBe(false);
  });
  it("reports last quicknode delivery age and unreconciled authorizations", async () => {
    const store = new MemoryStore();
    const now = Date.now();
    await store.insertFeedEvent({ owner_wallet: null, card_pda: "c", kind: "settled", amount_base: null, remaining_base: null, signature: "s", lithic_token: null, merchant: null, reason: null, source: "quicknode", slot: 1, at: new Date(now - 30_000).toISOString() });
    await store.upsertAuthorization({ lithic_token: "old", decision: "APPROVED" });
    store.auths.get("old")!.created_at = new Date(now - 600_000).toISOString();
    const r = await runChecks(base({ store, now: () => now }));
    expect(r.checks.find((c) => c.name === "quicknode last delivery")!.detail).toMatch(/30s ago/);
    expect(r.checks.find((c) => c.name === "unreconciled authorizations")!.ok).toBe(false);
  });
  it("a throwing check is isolated and leaks no secret-looking text", async () => {
    const bad = { ...rpc(), getBalance: async () => { throw new Error("https://x.quiknode.pro/SECRETTOKEN123"); } };
    const r = await runChecks(base({ rpc: bad }));
    expect(JSON.stringify(r)).not.toMatch(/SECRETTOKEN|quiknode/);
    expect(r.checks.find((c) => c.name === "settler SOL")!.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "store")!.ok).toBe(true);
  });
  it("lithic ping is cached for 60 s", async () => {
    __resetLithicCache();
    let n = 0;
    const f = (async () => { n++; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    expect(await lithicPing("k", f, 1000)).toBe(true);
    expect(await lithicPing("k", f, 30_000)).toBe(true);
    expect(n).toBe(1);
    await lithicPing("k", f, 70_000);
    expect(n).toBe(2);
  });
});
