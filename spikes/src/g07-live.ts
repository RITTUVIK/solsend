// CP0b / G0.7 LIVE — real Solana devnet QuickNode Stream → authenticated webhook, with real product
// actions as the events. Lifecycle is self-contained so the stream never keeps burning trial credits:
//   start receiver + tunnel → (re)create stream from the tip → card setup, 3 settles, 1 refund (REAL devnet)
//   → measure confirmed→webhook latency and verify decoded events against onchain state
//   → replay a captured real delivery (must be rejected) → PAUSE the stream.
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ComputeBudgetProgram, Transaction, sendAndConfirmTransaction, type Keypair, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { SPIKES_DIR, optEnv, rpcLabel } from "./lib/env.js";
import { record } from "./lib/evidence.js";
import { MINT, devnet, explorerTx, loadKeypair } from "./lib/solana.js";
import {
  POLICY, authHash, cardPda, delegationPda, fixedRemaining, ixCreateFixedDelegation, ixRefund, ixRegisterCard, ixSettle, saInitId, subscriptionAuthority,
} from "./lib/allowances.js";
import { STREAM_NAME, filterB64, listOurStreams, pauseStream, qn } from "./lib/quicknode.js";

const PORT = 8787;
const conn = await devnet();
const owner = loadKeypair("card-a-owner");
const settler = loadKeypair("settlement-authority");
const ownerAta = getAssociatedTokenAddressSync(MINT, owner.publicKey).toBase58();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const children: ChildProcess[] = [];
let streamId: string | null = null;
async function shutdown() {
  if (streamId) {
    const p = await pauseStream(streamId).catch((e) => ({ status: -1, json: String(e) }));
    record("g07", "stream_paused", { stream_id: streamId, http: p.status, status_after: p.json?.status ?? null });
    streamId = null;
  }
  children.forEach((c) => { try { c.kill(); } catch { /* gone */ } });
}
process.on("SIGINT", () => { void shutdown().then(() => process.exit(130)); });

// security token: generated once, kept only in spikes/.env (gitignored)
let token = optEnv("QN_STREAM_SECURITY_TOKEN");
if (!token) {
  token = randomBytes(32).toString("hex");
  appendFileSync(join(SPIKES_DIR, ".env"), `\nQN_STREAM_SECURITY_TOKEN=${token}\n`);
}

try {
  // 1. receiver + tunnel
  const srv = spawn("pnpm", ["exec", "tsx", "src/g07-webhook-server.ts"], { cwd: SPIKES_DIR, env: { ...process.env, QN_STREAM_SECURITY_TOKEN: token, G07_PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(srv);
  await new Promise<void>((resolve) => srv.stdout!.on("data", (b: Buffer) => { if (b.toString().includes("webhook receiver")) resolve(); }));
  const ng = spawn("ngrok", ["http", String(PORT), "--log", "stdout"], { stdio: ["ignore", "ignore", "ignore"] });
  children.push(ng);
  let publicUrl: string | undefined;
  for (let i = 0; i < 40 && !publicUrl; i++) {
    await sleep(500);
    try {
      const tj = (await (await fetch("http://127.0.0.1:4040/api/tunnels")).json()) as { tunnels: { public_url: string }[] };
      publicUrl = tj.tunnels.find((x) => x.public_url.startsWith("https://"))?.public_url;
    } catch { /* not up */ }
  }
  if (!publicUrl) throw new Error("ngrok tunnel did not come up");

  // 2. (re)create the stream from the chain tip (free trial allows 1 Solana stream)
  for (const s of await listOurStreams()) await qn("DELETE", `/streams/${s.id}`);
  const startSlot = await conn.getSlot("confirmed");
  const body = (batch: number) => ({
    name: STREAM_NAME, network: "solana-devnet", dataset: "programs_with_logs", filter_function: filterB64(), filter_language: "javascript",
    region: "usa_east", dataset_batch_size: batch, elastic_batch_enabled: false, keep_distance_from_tip: 0, fix_block_reorgs: 0,
    destination: "webhook", status: "active", external_id: "solsend-cp0b-g07-devnet",
    destination_attributes: { url: `${publicUrl}/webhooks/quicknode`, compression: "none", headers: {}, max_retry: 3, retry_interval_sec: 1, post_timeout_sec: 10, security_token: token },
  });
  let created = await qn("POST", "/streams", body(1));
  const firstAttempt = { http: created.status, error: created.status >= 300 ? created.json : null };
  if (created.status >= 300) created = await qn("POST", "/streams", body(5));
  streamId = created.json?.id ?? null;
  record("g07", streamId ? "stream_created" : "stream_create_error", {
    stream_id: streamId, http: created.status, network: "solana-devnet", dataset: "programs_with_logs", filter_program: POLICY.toBase58(),
    batch_size: created.json?.dataset_batch_size ?? null, batch1_attempt: firstAttempt, start_slot_approx: startSlot,
    webhook: "ngrok free domain (redacted)", rpc: rpcLabel(), error: streamId ? null : created.json,
  });
  if (!streamId) throw new Error("stream creation failed");
  await sleep(8000);

  // 3. real product actions
  type Act = { label: string; signature: string; confirmedAt: number; expect: Record<string, unknown> };
  const acts: Act[] = [];
  async function act(label: string, ixs: TransactionInstruction[], signer: Keypair, expect: Record<string, unknown> = {}) {
    const signature = await sendAndConfirmTransaction(conn, new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }), ...ixs), [signer], { commitment: "confirmed" });
    acts.push({ label, signature, confirmedAt: Date.now(), expect });
    return signature;
  }
  const initId = (await saInitId(conn, owner.publicKey))!;
  const cardId = BigInt(Date.now()) * 1000n + 7n;
  const card = cardPda(owner.publicKey, cardId);
  const delegation = delegationPda(subscriptionAuthority(owner.publicKey), owner.publicKey, card, cardId);
  await act("register_card (1.00 USDC fixed allowance)", [ixCreateFixedDelegation(owner.publicKey, card, cardId, 1_000_000n, 0n, initId), ixRegisterCard(owner.publicKey, cardId, 0, cardId)], owner, { instruction: "RegisterCard" });
  const hashes: Buffer[] = [];
  for (let i = 0; i < 3; i++) {
    const h = authHash(`g07-live-${cardId}-${i}`);
    hashes.push(h);
    await act(`settle #${i + 1} (0.01)`, [ixSettle(settler.publicKey, owner.publicKey, cardId, cardId, 10_000n, h)], settler, { instruction: "Settle", amount: "10000", remainingAllowance: String(1_000_000 - 10_000 * (i + 1)) });
    await sleep(1500);
  }
  await act("refund of settle #1 (0.01)", [ixRefund(settler.publicKey, owner.publicKey, cardId, 10_000n, hashes[0]!)], settler, { instruction: "Refund", amount: "10000", destinationOwnerAta: ownerAta });
  const delAcc = await conn.getAccountInfo(delegation, "confirmed");

  // 4. wait for webhook deliveries and verify
  const results: Record<string, unknown>[] = [];
  for (const a of acts) {
    let seen: any = null;
    for (let i = 0; i < 240 && !seen; i++) {
      seen = await (await fetch(`http://127.0.0.1:${PORT}/seen?sig=${a.signature}`)).json();
      if (!seen) await sleep(250);
    }
    const m = seen?.match;
    const ev = m?.events?.[0];
    const checks: Record<string, boolean> = { delivered: !!seen, instruction: m?.instruction === a.expect.instruction };
    if (a.expect.amount) checks.amount = ev?.amount === a.expect.amount;
    if (a.expect.remainingAllowance) checks.remaining_allowance = ev?.remainingAllowance === a.expect.remainingAllowance;
    if (a.expect.destinationOwnerAta) checks.refund_destination = ev?.destination === a.expect.destinationOwnerAta;
    results.push({
      action: a.label, signature: a.signature, explorer: explorerTx(a.signature),
      confirmed_to_webhook_ms: seen ? Date.parse(seen.receivedAt) - a.confirmedAt : null,
      block_time_to_webhook_ms: seen?.blockTime ? Date.parse(seen.receivedAt) - seen.blockTime * 1000 : null,
      decoded: m ? { instruction: m.instruction, events: m.events, allowances_invoked: m.allowancesInvoked } : null, checks,
    });
  }
  const lat = results.map((r) => r.confirmed_to_webhook_ms as number | null).filter((x): x is number => x !== null).sort((x, y) => x - y);
  const allChecks = results.every((r) => Object.values(r.checks as Record<string, boolean>).every(Boolean));

  // 5. replay a captured REAL delivery → must be rejected; tampered → 401
  const caps = existsSync(join(SPIKES_DIR, ".raw", "qn-captures.jsonl")) ? readFileSync(join(SPIKES_DIR, ".raw", "qn-captures.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  const cap = caps.at(-1);
  const post = async (h: Record<string, string>, b: string) => (await fetch(`${publicUrl}/webhooks/quicknode`, { method: "POST", headers: { "content-type": "application/json", ...h }, body: b })).status;
  const replay = cap ? await post(cap.headers, cap.body) : -1;
  const tampered = cap ? await post(cap.headers, cap.body + " ") : -1;
  const forgedNonce = "forged-" + Date.now();
  const forgedTs = String(Math.floor(Date.now() / 1000));
  const forged = await post({ "x-qn-nonce": forgedNonce, "x-qn-timestamp": forgedTs, "x-qn-signature": createHmac("sha256", "wrong-token").update(forgedNonce + forgedTs + "{}").digest("hex") }, "{}");

  record("g07", allChecks && lat.length === acts.length && replay === 409 && tampered === 401 && forged === 401 ? "live_PASS" : "live_REVIEW", {
    stream_id: streamId, rpc: rpcLabel(), actions: results,
    confirmed_to_webhook_ms: lat.length ? { min: lat[0], p50: lat[Math.floor(lat.length / 2)], max: lat[lat.length - 1], n: lat.length } : null,
    onchain_delegation_remaining_after: delAcc ? fixedRemaining(delAcc.data).toString() : null,
    webhook_auth: { real_deliveries_hmac_verified: lat.length, replay_of_real_delivery_http: replay, tampered_real_delivery_http: tampered, forged_signature_http: forged },
    end_slot_approx: await conn.getSlot("confirmed"),
  });
} finally {
  await shutdown();
}
process.exit(0);
