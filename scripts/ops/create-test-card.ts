// Creates a REAL devnet SolSend card through OUR server code path (prepareCard → owner signs locally →
// submitTx: byte-identical intent check → fee-payer cosign → confirmed), owner = card-a-owner (dev key).
// Optional real Lithic SANDBOX issuance (1 call) with --lithic. MemoryStore (in-process) only.
//   npx tsx@4.23.15 --conditions=react-server scripts/ops/create-test-card.ts --check
//   npx tsx@4.23.15 --conditions=react-server scripts/ops/create-test-card.ts --kind STORE_LOCKED --limit-cents 500 [--lithic] [--label Temu]
import nacl from "tweetnacl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KEYS_DIR, appEnv } from "./_lib";

for (const [k, v] of appEnv()) if (!process.env[k]) process.env[k] = v; // in-process only
const args = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1]! : d; };
const flag = (n: string) => args.includes(`--${n}`);

const web3 = await import("../../apps/web/node_modules/@solana/web3.js/lib/index.cjs.js");
const shared = await import("../../packages/shared/src/index");
const { connection } = await import("../../apps/web/src/server/keys");
const { cardDeps, lithic } = await import("../../apps/web/src/server/deps");
const { prepareCard, prepareWalletSetup } = await import("../../apps/web/src/server/cards/service");
const { submitTx } = await import("../../apps/web/src/server/tx/submit");
const { splitWire } = await import("../../apps/web/src/server/tx/intents");
const { HttpError } = await import("../../apps/web/src/server/auth");

const conn = connection();
const prog = await conn.getAccountInfo(shared.SOLSEND_PROGRAM_ID, "confirmed");
const cfg = await conn.getAccountInfo(shared.configPda(), "confirmed");
const ready = !!prog?.executable && !!cfg && cfg.owner.equals(shared.SOLSEND_PROGRAM_ID);
console.log(`program ${shared.SOLSEND_PROGRAM_ID.toBase58()} executable=${!!prog?.executable} config=${!!cfg} → ${ready ? "READY" : "NOT READY"}`);
if (flag("check") || !ready) process.exit(ready ? 0 : 2);

const owner = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(KEYS_DIR, "card-a-owner.json"), "utf8")) as number[]));
const base = cardDeps();
const deps = flag("lithic") ? base : { ...base, lithic: { ...lithic(), createCard: async () => { throw new Error("Lithic issuance skipped (--lithic not set)"); } } as typeof base.lithic };
const ownerB58 = owner.publicKey.toBase58();

function sign(txBase64: string) {
  const wire = Uint8Array.from(Buffer.from(txBase64, "base64"));
  const { sigOffset, message } = splitWire(wire);
  const msg = web3.VersionedMessage.deserialize(message);
  const idx = msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures).findIndex((k: InstanceType<typeof web3.PublicKey>) => k.equals(owner.publicKey));
  wire.set(nacl.sign.detached(message, owner.secretKey), sigOffset + idx * 64);
  return Buffer.from(wire).toString("base64");
}

const kind = (opt("kind", "STORE_LOCKED") as "STORE_LOCKED" | "ONE_TIME" | "SUBSCRIPTION");
const req = { kind, label: opt("label", "W2 test")!, merchantName: opt("merchant", "Mock Store")!, limitCents: Number(opt("limit-cents", "500")), ...(kind === "SUBSCRIPTION" ? { periodDays: Number(opt("period-days", "30")) } : {}) };
let prepared;
try {
  prepared = await prepareCard(deps, ownerB58, req);
} catch (e) {
  if (!(e instanceof HttpError) || e.code !== "setup_required") throw e;
  const setup = await prepareWalletSetup(deps, ownerB58);
  const s = await submitTx(deps, ownerB58, { intentId: setup.intentId, signedTxBase64: sign(setup.txBase64) });
  console.log(`wallet setup confirmed: ${s.explorer}`);
  prepared = await prepareCard(deps, ownerB58, req);
}
const res = await submitTx(deps, ownerB58, { intentId: prepared.intentId, signedTxBase64: sign(prepared.txBase64) });
const row = await deps.store.getCard(prepared.cardPda);
console.log(JSON.stringify({
  devnet: "register (create delegation + register_card) CONFIRMED", owner: ownerB58, kind, limit_cents: req.limitCents,
  card_pda: prepared.cardPda, card_id: prepared.cardId, delegation: shared.cardDelegation(owner.publicKey, BigInt(prepared.cardId)).toBase58(),
  register_signature: res.signature, explorer: res.explorer, issue_state: row?.issue_state, lithic_card_token: row?.lithic_card_token ?? null,
  lithic_last_four: row?.lithic_last_four ?? null, lithic_error: row?.lithic_error ?? null,
}, null, 2));
process.exit(0);
