// **MOCK** ASA latency harness (Lithic NOT involved). Sends Lithic-shaped ASA requests, signed with OUR
// HMAC using the real ASA secret from apps/web/.env.local, to a local or hosted SolSend for a REAL devnet
// card. Each APPROVED reply = a REAL devnet settle confirmed before the reply.
//   npx tsx@4.23.15 scripts/ops/asa-latency.ts --owner <pubkey> --card-id <u64> [--url http://localhost:3000]
//        [--n 20] [--pace 1500] [--cents 1] [--acceptor SOLSENDMOCK01] [--descriptor "MOCK STORE (SANDBOX)"]
//        [--dup] [--status AUTHORIZATION] [--token <replay an existing token>] [--verify] [--out file.json]
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { cardPda, settlementRecordPda, toHex } from "../../packages/shared/src/index";
import { PublicKey } from "../../apps/web/node_modules/@solana/web3.js/lib/index.cjs.js";
import { authCommitment } from "../../apps/web/src/server/lib/commitments";
import { signLikeLithic } from "../../apps/web/src/server/lithic/webhook";
import { appEnv, rpcLabel } from "./_lib";

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1]! : d; };
const flag = (n: string) => args.includes(`--${n}`);
const env = appEnv();
const secret = env.get("LITHIC_ASA_SECRET");
if (!secret) throw new Error("LITHIC_ASA_SECRET missing (run make-env-local first)");
const url = `${(opt("url", "http://localhost:3000")!).replace(/\/+$/, "")}/api/lithic/asa`;
const owner = new PublicKey(opt("owner") ?? (() => { throw new Error("--owner required"); })());
const cardId = BigInt(opt("card-id") ?? (() => { throw new Error("--card-id required"); })());
const N = Number(opt("n", "20")), PACE = Number(opt("pace", "1500")), CENTS = Number(opt("cents", "1"));
const acceptor = opt("acceptor", "SOLSENDMOCK01")!, descriptor = opt("descriptor", "MOCK STORE (SANDBOX)")!;
const status = opt("status", "AUTHORIZATION")!;
const pda = cardPda(owner, cardId);
const tags = { solsend_card: pda.toBase58(), solsend_owner: owner.toBase58(), solsend_card_id: cardId.toString() };

function payload(token = randomUUID()) {
  return {
    token, status, created: new Date().toISOString(), amount: CENTS,
    amounts: { cardholder: { amount: CENTS, currency: "USD" }, hold: { amount: CENTS, currency: "USD" }, merchant: { amount: CENTS, currency: "USD" }, settlement: { amount: CENTS, currency: "USD" } },
    card: { token: `mock-${randomUUID()}`, last_four: "0000", state: "OPEN", type: "VIRTUAL", tags },
    merchant: { descriptor, acceptor_id: acceptor, mcc: "5999", city: "Halifax", state: "NS", country: "CAN" },
    pos: { entry_mode: { pan: "KEY_ENTERED", card: "NOT_PRESENT", cardholder: "NOT_PRESENT" } }, // an enum, not a card number
    mock: "MOCK (Lithic not involved)",
  };
}
async function post(p: unknown) {
  const body = JSON.stringify(p);
  const id = `msg_mock_${randomUUID()}`, ts = String(Math.floor(Date.now() / 1000));
  const t0 = performance.now();
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": signLikeLithic(secret!, id, ts, body) }, body });
  const ms = Math.round(performance.now() - t0);
  const result = res.status === 200 ? ((await res.json()) as { result: string }).result : `HTTP_${res.status}`;
  return { result, ms };
}
const pct = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!; };

console.log(`MOCK ASA latency → ${url} | card ${pda.toBase58()} | n=${N} pace=${PACE}ms cents=${CENTS}${flag("dup") ? " (concurrent duplicate pairs)" : ""}`);
const rows: { i: number; token: string; result: string; ms: number; dup?: string }[] = [];
for (let i = 0; i < N; i++) {
  const p = payload(opt("token") ?? randomUUID());
  if (flag("dup")) {
    const [a, b] = await Promise.all([post(p), post(p)]);
    rows.push({ i, token: p.token, result: a.result, ms: a.ms, dup: b.result });
  } else {
    const r = await post(p);
    rows.push({ i, token: p.token, ...r });
  }
  console.log(`MOCK #${i} ${rows[i]!.result}${rows[i]!.dup ? `/${rows[i]!.dup}` : ""} ${rows[i]!.ms} ms token=${p.token}`);
  if (i < N - 1) await new Promise((r) => setTimeout(r, PACE));
}
const ms = rows.map((r) => r.ms), warm = ms.slice(1);
const decisions = rows.reduce<Record<string, number>>((m, r) => ((m[r.result] = (m[r.result] ?? 0) + 1), m), {});
let onchain: { records_found: number; amounts: string[] } | null = null;
if (flag("verify")) {
  const rpc = env.get("SOLANA_RPC_URL")!;
  const keys = rows.map((r) => settlementRecordPda(pda, authCommitment(r.token)).toBase58());
  const found: string[] = [];
  for (let i = 0; i < keys.length; i += 5) {
    const j = await (await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [keys.slice(i, i + 5), { encoding: "base64", commitment: "confirmed" }] }) })).json() as { result?: { value: ({ data: [string, string] } | null)[] } };
    for (const v of j.result?.value ?? []) if (v) found.push(Buffer.from(v.data[0], "base64").readBigUInt64LE(72).toString());
    await new Promise((r) => setTimeout(r, 120));
  }
  onchain = { records_found: found.length, amounts: [...new Set(found)] };
}
const summary = {
  label: "MOCK (Lithic not involved): locally signed ASA requests → REAL devnet settles", target: url.replace(/^(https?:\/\/[^/]+).*/, "$1"), rpc: rpcLabel(env.get("SOLANA_RPC_URL") ?? ""),
  card_pda: pda.toBase58(), n: N, pace_ms: PACE, cents: CENTS, decisions,
  request_to_reply_ms: { cold_first: ms[0] ?? null, warm_p50: pct(warm, 50), warm_p95: pct(warm, 95), warm_p99: pct(warm, 99), all_p50: pct(ms, 50), all_p95: pct(ms, 95), all_p99: pct(ms, 99), max: Math.max(...ms), min: Math.min(...ms) },
  onchain, tokens: rows.map((r) => ({ token: r.token, auth_hash: toHex(authCommitment(r.token)), result: r.result, ms: r.ms, ...(r.dup ? { dup: r.dup } : {}) })),
};
console.log("MOCK SUMMARY", JSON.stringify({ ...summary, tokens: undefined }, null, 2));
const out = opt("out");
if (out) writeFileSync(out, JSON.stringify(summary, null, 2));
