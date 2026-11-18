// G0.7 offline self-test (no QuickNode needed):
//  (a) filter.js against a synthetic programs_with_logs payload carrying a real CardSettled event encoding
//  (b) webhook receiver: valid signature accepted; bad signature, replayed nonce,
//      and stale timestamp rejected.
// Usage: QN_STREAM_SECURITY_TOKEN=<any 32+ chars> G07_PORT=8799 pnpm exec tsx src/g07-selftest.ts
import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { PublicKey } from "@solana/web3.js";
import { SPIKES_DIR } from "./lib/env.js";
import { record } from "./lib/evidence.js";

const OUR = "8uSYgZn5rvEbrpc3NgQFvqcqMA7snptsmiey5457ddR9";
const ALLOW = "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44";
const src = readFileSync(join(SPIKES_DIR, "quicknode/filter.js"), "utf8").replaceAll("__OUR_PROGRAM__", JSON.stringify(OUR));
const ctx = vm.createContext({ BigInt });
vm.runInContext(src, ctx);
const main = ctx.main as (s: unknown) => any;

// CardSettled { card, owner, amount=10_000, remaining_allowance=990_000, auth_hash=0xab.., total_settled=10_000 }
const u64le = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const card = new PublicKey("6SJw6eTyDTghJoVWEtkjNHM1kge9jKdL1bUzPaVFQhgK");
const owner = new PublicKey("DEGx8bvPLZQDS65xbw79My2tV97cfqsKQfGos6Nq3nWe");
const ev = Buffer.concat([Buffer.from([34, 206, 169, 204, 178, 170, 227, 94]), card.toBuffer(), owner.toBuffer(), u64le(10_000n), u64le(990_000n), Buffer.alloc(32, 0xab), u64le(10_000n)]);
const decoy = Buffer.concat([Buffer.from([34, 206, 169, 204, 178, 170, 227, 94]), Buffer.alloc(120, 1)]); // same disc, emitted by ANOTHER program
const logs = [
  `Program ${OUR} invoke [1]`, "Program log: Instruction: Settle",
  `Program ${ALLOW} invoke [2]`, `Program data: ${decoy.toString("base64")}`, `Program ${ALLOW} success`,
  `Program data: ${ev.toString("base64")}`, `Program ${OUR} success`,
];
const pwl = {
  metadata: { dataset: "programs_with_logs", batch_start_range: 100, batch_end_range: 100 },
  data: [[
    { signature: "sigOurs", slot: 100, blockTime: 1, success: true, logs,
      programInvocations: [{ programId: OUR, instruction: { index: 1, accounts: [], data: "x", tokenBalances: [{ accountIndex: 5, mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", owner: owner.toBase58(), uiTokenAmount: { amount: "1000" } }] } }] },
    { signature: "sigOther", slot: 100, blockTime: 1, success: true, logs: [], programInvocations: [{ programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", instruction: { accounts: [], data: "3" } }] },
  ]],
};
const r1 = main(pwl);
const r3 = main({ metadata: {}, data: [[]] });
const e = r1?.matches?.[0]?.events?.[0];
const filterOk = r1?.matches?.length === 1 && r1.matches[0].instruction === "Settle" && r1.matches[0].allowancesInvoked === true
  && r1.matches[0].events.length === 1 && e?.name === "CardSettled" && e.card === card.toBase58() && e.owner === owner.toBase58()
  && e.amount === "10000" && e.remainingAllowance === "990000" && e.authHash === "ab".repeat(32) && r3 === null;
record("g07", filterOk ? "selftest_filter_PASS" : "selftest_filter_FAIL", { programs_with_logs: r1, empty: r3, decoy_from_other_program_ignored: r1?.matches?.[0]?.events?.length === 1 });

// (b) webhook receiver
const token = process.env.QN_STREAM_SECURITY_TOKEN!;
const port = Number(process.env.G07_PORT ?? 8799);
const server = spawn("pnpm", ["exec", "tsx", "src/g07-webhook-server.ts"], { cwd: SPIKES_DIR, env: { ...process.env, G07_PORT: String(port) }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));

async function post(body: string, { nonce = randomUUID(), ts = String(Math.floor(Date.now() / 1000)), key = token } = {}) {
  const sig = createHmac("sha256", Buffer.from(key)).update(Buffer.from(nonce + ts + body)).digest("hex");
  const res = await fetch(`http://127.0.0.1:${port}/webhooks/quicknode`, {
    method: "POST", headers: { "x-qn-nonce": nonce, "x-qn-timestamp": ts, "x-qn-signature": sig, "content-type": "application/json" }, body,
  });
  return res.status;
}
const body = JSON.stringify(r1);
const fixedNonce = randomUUID();
const results = {
  valid: await post(body, { nonce: fixedNonce }),
  replayed_nonce: await post(body, { nonce: fixedNonce }),
  wrong_key: await post(body, { key: "not-the-token-not-the-token-xxxx" }),
  stale_timestamp: await post(body, { ts: String(Math.floor(Date.now() / 1000) - 3600) }),
};
server.kill();
const webhookOk = results.valid === 200 && results.replayed_nonce === 409 && results.wrong_key === 401 && results.stale_timestamp === 401;
record("g07", webhookOk ? "selftest_webhook_PASS" : "selftest_webhook_FAIL", { http_status: results });
process.exit(filterOk && webhookOk ? 0 : 1);
