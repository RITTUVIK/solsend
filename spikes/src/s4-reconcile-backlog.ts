// CP0b / S4 — sweep the reconciliation queue (fail-closed declines from earlier runs).
// Every queued token was answered with a DECLINE; any settle that landed anyway must be refunded.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPIKES_DIR } from "./lib/env.js";
import { record } from "./lib/evidence.js";
import { devnet, loadKeypair } from "./lib/solana.js";
import { reconcile, type FinalDecision } from "./asa/reconcile.js";

const lines = readFileSync(join(SPIKES_DIR, ".raw", "reconcile-queue.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const seen = new Set<string>();
const items: FinalDecision[] = [];
for (const q of lines) {
  if (!q.token || !q.owner || !q.cardId || seen.has(q.token)) continue;
  seen.add(q.token);
  items.push({ token: q.token, owner: q.owner, cardId: BigInt(q.cardId), finalResult: "DECLINED" });
}
const out = await reconcile(await devnet(), loadKeypair("settlement-authority"), items);
const refunded = out.filter((o) => o.action === "refunded");
const stillUnbalanced = out.filter((o) => o.record && BigInt(o.record.amount) - BigInt(o.record.refunded) > 0n && o.action !== "refunded");
record("s4", stillUnbalanced.length === 0 ? "backlog_reconciled_PASS" : "backlog_reconciled_FAIL", {
  queued_declines: items.length, late_settles_found: out.filter((o) => o.record).length, refunded: refunded.length,
  never_landed: out.filter((o) => !o.record).length, refund_signatures: refunded.map((r) => r.refundSig),
});
