// G0.5 — Cards A and B under the SAME Stripe cardholder with DIFFERENT wallets:
// does each authorization pull only from its own wallet's USDC account?
// Reads the pull signatures recorded by G0.3 / G0.4 and checks USDC deltas.
import { PublicKey } from "@solana/web3.js";
import { record, stateStr } from "./lib/evidence.js";
import { stripe } from "./lib/providers.js";
import { describeUsdcTx, devnet, loadKeypair, usdcAta } from "./lib/solana.js";

const conn = await devnet();
const cardA = stateStr("cardAId");
const cardB = stateStr("cardBId");
const sigA = stateStr("cardAPullSig");
const sigB = stateStr("cardBPullSig");
const vaultA = usdcAta(loadKeypair("card-a-owner").publicKey).toBase58();
const vaultB = stateStr("cardBVault");
if (!cardA || !cardB || !sigA || !sigB || !vaultB) {
  record("g05", "UNTESTED", { reason: "needs both G0.3 and G0.4 to have produced onchain pulls", cardA, cardB, sigA, sigB });
  process.exit(0);
}

const [a, b] = await Promise.all([
  stripe("GET", `/v1/issuing/cards/${cardA}`, {}, { label: "get_card_a" }),
  stripe("GET", `/v1/issuing/cards/${cardB}`, {}, { label: "get_card_b" }),
]);
const holderA = typeof a.cardholder === "string" ? a.cardholder : a.cardholder?.id;
const holderB = typeof b.cardholder === "string" ? b.cardholder : b.cardholder?.id;

const txA = await describeUsdcTx(conn, sigA);
const txB = await describeUsdcTx(conn, sigB);
const delta = (tx: typeof txA, acct: string) => BigInt(tx.usdcDeltas.find((d) => d.tokenAccount === acct)?.delta ?? "0");

const checks = {
  same_cardholder: holderA === holderB,
  different_wallets: vaultA !== vaultB && new PublicKey(vaultA).toBase58() !== vaultB,
  pullA_debits_only_vaultA: delta(txA, vaultA) < 0n && delta(txA, vaultB) === 0n,
  pullB_debits_only_vaultB: delta(txB, vaultB) < 0n && delta(txB, vaultA) === 0n,
};
record("g05", Object.values(checks).every(Boolean) ? "PASS" : "FAIL", {
  cardholder_a: holderA, cardholder_b: holderB, vault_a: vaultA, vault_b: vaultB,
  pull_a: { signature: sigA, explorer: txA.explorer, deltas: txA.usdcDeltas },
  pull_b: { signature: sigB, explorer: txB.explorer, deltas: txB.usdcDeltas },
  checks,
});
