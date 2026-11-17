// G0.1 — connect a Canada-registered Stripe Sandbox to a Bridge sandbox.
// Prereqs (human, dashboard): Stripe Sandbox created; Bridge Cards Stripe App installed;
// Bridge sandbox API key created. This script: verifies the Stripe account country,
// then POSTs Bridge /v0/cards/enable, then probes Stripe Issuing availability.
import { record, saveState } from "./lib/evidence.js";
import { ProviderError, bridge, stripe } from "./lib/providers.js";

const account = await stripe("GET", "/v1/account", {}, { label: "account" });
record("g01", "stripe_account", {
  id: account.id,
  country: account.country, // hard rule 6: must be CA
  type: account.type ?? null,
  livemode_key: false,
});
if (account.country !== "CA") {
  record("g01", "FAIL", { reason: `Stripe account country is ${account.country}, expected CA (hard rule 6). Stopping.` });
  process.exit(1);
}
saveState({ stripeAccountId: account.id });

try {
  const res = await bridge("POST", "/v0/cards/enable", { stripe_account_id: account.id, program_type: "consumer" }, { label: "cards_enable" });
  record("g01", "bridge_cards_enable_ok", { response_keys: Object.keys(res), response: res });
} catch (e) {
  if (e instanceof ProviderError) {
    record("g01", "bridge_cards_enable_error", { status: e.status, body: e.body, request_id: e.requestId });
  } else throw e;
}

// Probe: is Stripe Issuing reachable on this sandbox now?
try {
  const list = await stripe("GET", "/v1/issuing/cardholders", { limit: 1 }, { label: "issuing_probe" });
  record("g01", "stripe_issuing_probe_ok", { cardholders_visible: (list.data ?? []).length });
} catch (e) {
  if (e instanceof ProviderError) record("g01", "stripe_issuing_probe_error", { status: e.status, body: e.body });
  else throw e;
}
