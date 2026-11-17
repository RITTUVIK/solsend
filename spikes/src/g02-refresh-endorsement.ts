// G0.2 refresh — the Bridge `cards` endorsement lapses 24h after approval if no card
// is created (endorsement → revoked, cardholder → inactive). This re-issues a KYC link
// for the `cards` endorsement and polls until it is approved again.
// Usage: pnpm g02:refresh [--simulate]   (--simulate also calls the sandbox-only
//        POST /v0/customers/{id}/simulate_kyc_approval helper)
import { poll, record, saveState, stateStr } from "./lib/evidence.js";
import { ProviderError, bridge } from "./lib/providers.js";

const customerId = stateStr("bridgeCustomerId");
if (!customerId) throw new Error("No bridgeCustomerId in spikes/.raw/state.json — run g02:customer first.");

const c = await bridge("GET", `/v0/customers/${customerId}`, undefined, { label: "get_customer" });
const cards = (c.endorsements ?? []).find((x: any) => x.name === "cards");
record("g02r", "current_status", { customer_status: c.status, cards_status: cards?.status ?? null, approved_at: stateStr("cardsEndorsementApprovedAt") ?? null });

if (cards?.status === "approved" && c.status === "active") {
  console.log("cards endorsement is currently approved; nothing to refresh.");
  process.exit(0);
}

if (process.argv.includes("--simulate")) {
  try {
    await bridge("POST", `/v0/customers/${customerId}/simulate_kyc_approval`, {}, { label: "simulate_kyc_approval" });
    record("g02r", "simulate_kyc_approval_called", { customer_id: customerId });
  } catch (e) {
    if (e instanceof ProviderError) record("g02r", "simulate_kyc_approval_error", { status: e.status, body: e.body });
    else throw e;
  }
}

const link = await bridge("GET", `/v0/customers/${customerId}/kyc_link?endorsement=cards`, undefined, { label: "kyc_link_refresh" });
console.log("\nHUMAN STEP — reconfirm via this sandbox KYC link (accept ToS only):\n", link.url ?? link.kyc_link ?? link, "\n");

const ok = await poll(
  "cards re-approval",
  async () => {
    const cur = await bridge("GET", `/v0/customers/${customerId}`, undefined, { label: "get_customer" });
    const e = (cur.endorsements ?? []).find((x: any) => x.name === "cards");
    return e?.status === "approved" && cur.status === "active" ? cur : undefined;
  },
  { intervalMs: 10_000, timeoutMs: 30 * 60_000 },
);
if (ok) {
  saveState({ cardsEndorsementApprovedAt: new Date().toISOString(), stripeCardholderId: ok.stripe_cardholder_id });
  record("g02r", "refreshed", { stripe_cardholder_id: ok.stripe_cardholder_id });
} else {
  record("g02r", "FAIL", { reason: "not re-approved within 30 min" });
  process.exit(1);
}
