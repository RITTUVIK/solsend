// G0.7 — latency probe. Sends N tiny USDC transfers that touch a watched vault
// (card-a-owner ATA → Card B PDA vault) and measures confirmed → webhook-arrival time.
// Requires g07:webhook running and the stream active.
import { createTransferCheckedInstruction } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { USDC_DECIMALS } from "./lib/env.js";
import { poll, record, stateStr } from "./lib/evidence.js";
import { MINT, devnet, explorerTx, loadKeypair, send, usdcAta } from "./lib/solana.js";

const N = Number(process.env.G07_PROBES ?? 5);
const PORT = Number(process.env.G07_PORT ?? 8787);
const conn = await devnet();
const owner = loadKeypair("card-a-owner");
const from = usdcAta(owner.publicKey);
const to = new PublicKey(stateStr("cardBVault") ?? from.toBase58()); // fall back to self-transfer

const results: { signature: string; confirmed_to_webhook_ms: number | null }[] = [];
for (let i = 0; i < N; i++) {
  const sent = await send(conn, [createTransferCheckedInstruction(from, MINT, to, owner.publicKey, 10_000n, USDC_DECIMALS)], [owner]);
  const confirmedMs = Date.parse(sent.confirmedAt);
  const arrival = await poll("webhook arrival", async () => {
    const r = (await (await fetch(`http://127.0.0.1:${PORT}/seen?sig=${sent.signature}`)).json()) as { receivedAt: string } | null;
    return r ?? undefined;
  }, { intervalMs: 500, timeoutMs: 120_000 });
  const latency = arrival ? Date.parse(arrival.receivedAt) - confirmedMs : null;
  results.push({ signature: sent.signature, confirmed_to_webhook_ms: latency });
  record("g07", "probe", { i, signature: sent.signature, explorer: explorerTx(sent.signature), slot: sent.slot, confirmed_at: sent.confirmedAt, webhook_at: arrival?.receivedAt ?? null, confirmed_to_webhook_ms: latency });
}
const ok = results.map((r) => r.confirmed_to_webhook_ms).filter((x): x is number => x !== null).sort((a, b) => a - b);
record("g07", ok.length === N ? "PASS" : ok.length ? "PARTIAL" : "FAIL", {
  probes: N, delivered: ok.length,
  latency_ms: ok.length ? { min: ok[0], median: ok[Math.floor(ok.length / 2)], max: ok[ok.length - 1] } : null,
});
