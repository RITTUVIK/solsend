// Offline self-test of the generated QuickNode filter. Encodes synthetic SolSend events with the IDL discriminators,
// wraps them in fake `programs_with_logs` transactions (including a decoy `Program data:` line emitted inside a CPI
// to ANOTHER program), runs filter.dist.js in a sandboxed `vm` context (no require/process/fetch, like QuickNode),
// asserts the output parses with api.QnPayload, and cross-checks against the shared TS decoder.
// Usage: tsx infra/quicknode/selftest.ts   (also executed by apps/web vitest: server/qn/filter.test.ts)
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { z } from "zod";
import { api, bytesToBase64, concat, decodeSolsendEventsFromLogs, IDL, u64le, utf8 } from "../../packages/shared/src/index.js";
import { buildFilterSource } from "./build-filter.js";



// Tolerates both the old (memo) and amended (no memo) shared QnMatch.
const Payload = z.object({ solsend: z.literal("v1"), matches: z.array(api.QnMatch.extend({ memo: z.string().nullable().optional() })) });
const PROGRAM = IDL.address;
const OTHER = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
const key = (n: number) => new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (n * 7 + i * 3 + 1) & 0xff));
const CARD = key(1), OWNER = key(2), DELEG = key(3), DEST = key(4), SETTLER = key(5);
const AUTH_HASH = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const MERCH_HASH = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
const label = new Uint8Array(32); label.set(utf8("Temu burner"));

const disc = (name: string) => Uint8Array.from((IDL.events ?? []).find((e) => e.name === name)!.discriminator);
const pk = (k: PublicKey) => k.toBytes();
const ev = (name: string, ...parts: Uint8Array[]) => concat(disc(name), ...parts);
const line = (bytes: Uint8Array) => `Program data: ${bytesToBase64(bytes)}`;

const EVENT_BYTES = {
  CardRegistered: ev("CardRegistered", pk(CARD), pk(OWNER), u64le(42n), Uint8Array.of(0), pk(DELEG), label),
  CardSettled: ev("CardSettled", pk(CARD), pk(OWNER), u64le(10_000n), u64le(990_000n), AUTH_HASH, MERCH_HASH, u64le(10_000n), Uint8Array.of(0)),
  CardRefunded: ev("CardRefunded", pk(CARD), pk(OWNER), u64le(10_000n), AUTH_HASH, u64le(10_000n), pk(DEST)),
  CardFrozen: ev("CardFrozen", pk(CARD), pk(OWNER)),
  CardUnfrozen: ev("CardUnfrozen", pk(CARD)),
  CardClosed: ev("CardClosed", pk(CARD)),
  ConfigUpdated: ev("ConfigUpdated", Uint8Array.of(1), pk(SETTLER)),
} as const;

function fakeTx(sig: string, slot: number, eventNames: (keyof typeof EVENT_BYTES)[], opts: { decoy?: boolean; success?: boolean } = {}) {
  const logs: string[] = [`Program ComputeBudget111111111111111111111111111111 invoke [1]`, `Program ComputeBudget111111111111111111111111111111 success`];
  logs.push(`Program ${PROGRAM} invoke [1]`, "Program log: Instruction: Settle");
  logs.push(`Program ${OTHER} invoke [2]`);
  // Decoy: a valid-looking SolSend event line emitted while ANOTHER program executes -> must be ignored.
  if (opts.decoy) logs.push(line(EVENT_BYTES.CardSettled));
  logs.push(`Program ${OTHER} success`);
  for (const n of eventNames) logs.push(line(EVENT_BYTES[n]));
  logs.push(`Program ${PROGRAM} success`);
  const invocations: unknown[] = [{ programId: "ComputeBudget111111111111111111111111111111", instruction: { data: "3gJqkocMWaMm" } }];
  invocations.push({ programId: PROGRAM, instruction: { data: "2Z" } });
  return { signature: sig, slot, blockTime: 1_800_000_000 + slot, success: opts.success ?? true, logs, programInvocations: invocations };
}

export function runFilter(stream: unknown): unknown {
  const sandbox = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(buildFilterSource(), sandbox, { timeout: 2000 });
  // Round-trip through JSON in the sandbox realm, as QuickNode serializes the return value.
  return JSON.parse(vm.runInContext(`JSON.stringify(main(${JSON.stringify(stream)}))`, sandbox, { timeout: 2000 }));
}

export function selftest(): { events: number; matches: number } {
  const SIG = bs58.encode(Uint8Array.from({ length: 64 }, (_, i) => i + 1));
  const SIG2 = bs58.encode(Uint8Array.from({ length: 64 }, (_, i) => 200 - i));
  const all = Object.keys(EVENT_BYTES) as (keyof typeof EVENT_BYTES)[];
  const unrelated = { signature: "unrelated", slot: 1, blockTime: 1, success: true, logs: [`Program ${OTHER} invoke [1]`, line(EVENT_BYTES.CardSettled), `Program ${OTHER} success`], programInvocations: [{ programId: OTHER, instruction: { data: "x" } }] };
  const stream = { data: [[fakeTx(SIG, 100, ["CardSettled"], { decoy: true }), fakeTx(SIG2, 101, all), unrelated]], metadata: {} };

  const out = runFilter(stream);
  const parsed = Payload.parse(out);
  assert.equal(parsed.solsend, "v1");
  assert.equal(parsed.matches.length, 2, "unrelated tx must not match");

  const [m1, m2] = parsed.matches as [typeof parsed.matches[number], typeof parsed.matches[number]];
  assert.equal(m1.signature, SIG);
  assert.equal("memo" in m1, false, "no memo is published");
  assert.equal(m1.events.length, 1, "decoy CPI data line ignored");
  assert.deepEqual(m1.events[0], {
    name: "CardSettled", card: CARD.toBase58(), owner: OWNER.toBase58(), amount: "10000", remainingAllowance: "990000",
    authHash: Buffer.from(AUTH_HASH).toString("hex"), merchantHash: Buffer.from(MERCH_HASH).toString("hex"), totalSettled: "10000", statusAfter: 0,
  });
  assert.deepEqual(m2.events.map((e) => e.name), all, "all 7 events decoded");
  const reg = m2.events[0]!;
  assert.equal(reg.cardId, "42");
  assert.equal(reg.delegation, DELEG.toBase58());
  assert.equal(reg.label, Buffer.from(label).toString("hex"));
  const cfg = m2.events[6]!;
  assert.equal(cfg.paused, true);
  assert.equal(cfg.settlementAuthority, SETTLER.toBase58());

  // Cross-check against the shared TS decoder (same invoke-stack algorithm).
  const ts = decodeSolsendEventsFromLogs(fakeTx(SIG2, 101, all).logs);
  assert.deepEqual(ts.map((e) => e.name), m2.events.map((e) => e.name));
  assert.equal(String((ts[1]!.data as { amount: bigint }).amount), m2.events[1]!.amount);

  // Nothing matched -> null (QuickNode skips delivery).
  assert.equal(runFilter({ data: [[unrelated]] }), null);
  // Failed tx is reported with success=false.
  const failed = Payload.parse(runFilter({ data: [[fakeTx(SIG, 5, [], { success: false })]] }));
  assert.equal(failed.matches[0]!.success, false);
  return { events: m1.events.length + m2.events.length, matches: parsed.matches.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = selftest();
  console.log(`quicknode filter selftest OK (${r.matches} matches, ${r.events} events, decoy ignored, no memo)`);
}
