// G0.6 — reversal / refund on Card A; measure time until USDC returns onchain.
//   --mode reverse : new auth → wait for pull → test_helpers .../reverse
//   --mode refund  : new auth → wait for pull → capture → transactions/{id}/refund
// Bridge docs: refunds return "asynchronously and might combine multiple refunds into
// one onchain transaction", so we watch the ATA for ANY new inbound USDC transfer.
import { poll, record, stateStr } from "./lib/evidence.js";
import { confirmedHashes, getAuthorizationWithCrypto, simulateAuthorization, stripe } from "./lib/providers.js";
import { describeUsdcTx, devnet, fmtUsdc, knownSignatures, loadKeypair, tokenState, usdcAta, waitForNewSignature } from "./lib/solana.js";

const mode = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "reverse";
if (mode !== "reverse" && mode !== "refund") throw new Error("--mode reverse|refund");
const AUTH_CENTS = 150;
const WAIT_MIN = Number(process.env.G06_WAIT_MINUTES ?? 30);

const conn = await devnet();
const ata = usdcAta(loadKeypair("card-a-owner").publicKey);
const cardId = stateStr("cardAId");
if (!cardId) throw new Error("No cardAId — run g03:card-a first.");

const auth = await simulateAuthorization(cardId, AUTH_CENTS, `g06_${mode}_auth`);
record("g06", `${mode}_auth_created`, { authorization_id: auth.id, approved: auth.approved });
if (!auth.approved) { record("g06", "FAIL", { reason: "auth declined; is the delegate approved? run g03:card-a --revoke-test re-approves" }); process.exit(1); }

const pull = await poll("pull hash", async () => {
  const { auth: a } = await getAuthorizationWithCrypto(auth.id);
  return confirmedHashes(a)[0];
}, { intervalMs: 2000, timeoutMs: 5 * 60_000 });
if (!pull) { record("g06", "FAIL", { reason: "no onchain pull observed for the auth" }); process.exit(1); }
const balAfterPull = (await tokenState(conn, ata)).amount;
record("g06", `${mode}_pull_confirmed`, { pull_signature: pull, balance_after_pull: fmtUsdc(balAfterPull) });

const known = await knownSignatures(conn, ata);
let stripeRef: string;
const tRequested = Date.now();
if (mode === "reverse") {
  const r = await stripe("POST", `/v1/test_helpers/issuing/authorizations/${auth.id}/reverse`, {}, { label: "reverse" });
  stripeRef = r.id;
  record("g06", "reverse_requested", { authorization_id: r.id, status: r.status, at: new Date(tRequested).toISOString() });
} else {
  await stripe("POST", `/v1/test_helpers/issuing/authorizations/${auth.id}/capture`, {}, { label: "capture" });
  const txn = await poll("issuing transaction", async () => {
    const list = await stripe("GET", "/v1/issuing/transactions", { authorization: auth.id, limit: 1 }, { label: "list_txn" });
    return list.data?.[0]?.id as string | undefined;
  }, { intervalMs: 2000, timeoutMs: 2 * 60_000 });
  if (!txn) { record("g06", "FAIL", { reason: "no issuing transaction after capture" }); process.exit(1); }
  const r = await stripe("POST", `/v1/test_helpers/issuing/transactions/${txn}/refund`, { refund_amount: AUTH_CENTS }, { label: "refund" });
  stripeRef = r.id;
  record("g06", "refund_requested", { transaction_id: txn, refund_transaction: r.id, at: new Date().toISOString() });
}

const inbound = await waitForNewSignature(conn, ata, known, { timeoutMs: WAIT_MIN * 60_000, intervalMs: 3000 });
if (!inbound) {
  record("g06", `${mode}_NOT_OBSERVED`, { stripe_ref: stripeRef, waited_minutes: WAIT_MIN, note: "async return not seen in window; re-run later with G06_WAIT_MINUTES or check ATA history" });
  process.exit(0);
}
const onchain = await describeUsdcTx(conn, inbound.signature);
const mine = onchain.usdcDeltas.find((d) => d.tokenAccount === ata.toBase58());
record("g06", BigInt(mine?.delta ?? "0") > 0n ? "PASS" : "OBSERVED_NON_INBOUND", {
  mode, stripe_ref: stripeRef, seconds_request_to_onchain_return: Math.round((Date.parse(inbound.seenAt) - tRequested) / 1000),
  ...onchain, card_a_ata_delta: mine?.delta ?? "0",
});
