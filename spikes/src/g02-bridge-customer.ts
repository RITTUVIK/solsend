// G0.2 — Bridge sandbox individual customer with endorsements ["base","cards"].
// Prints a KYC link (human accepts ToS), then polls until the `cards` endorsement is
// approved and Bridge has created the Stripe cardholder (stripe_cardholder_id).
//
// SYNTHETIC FIXTURE: every field below is fake test data, labeled as such (hard rule 6).
// The fixture country defaults to Canada. Bridge's stablecoin-card cardholder regions
// may not include Canada; if the endorsement reports `customer_region_supports_cards`
// missing, STOP and ask the team before changing the fixture country.
import { optEnv } from "./lib/env.js";
import { poll, record, saveState, stateStr } from "./lib/evidence.js";
import { ProviderError, bridge, stripe } from "./lib/providers.js";

const country = optEnv("BRIDGE_FIXTURE_COUNTRY") ?? "CAN";
const FIXTURES: Record<string, Record<string, unknown>> = {
  CAN: {
    residential_address: { street_line_1: "100 Synthetic Test Way", city: "Vancouver", subdivision: "BC", postal_code: "V6T 1Z4", country: "CAN" },
    identifying_information: [{ type: optEnv("BRIDGE_FIXTURE_ID_TYPE") ?? "sin", issuing_country: "can", number: "046454286" }],
    phone: "+16045550100",
  },
};
const fixture = FIXTURES[country];
if (!fixture) throw new Error(`No synthetic fixture for ${country}. Add one only after team approval (hard rule 6).`);

let customerId = stateStr("bridgeCustomerId");
if (!customerId) {
  const body = {
    type: "individual",
    first_name: "Synthetic",
    last_name: "SolSendTester",
    email: optEnv("BRIDGE_FIXTURE_EMAIL") ?? `synthetic+solsend-${Date.now()}@example.com`,
    birth_date: "1995-01-01",
    endorsements: ["base", "cards"],
    ...fixture,
  };
  try {
    const c = await bridge("POST", "/v0/customers", body, { label: "create_customer" });
    customerId = c.id as string;
    saveState({ bridgeCustomerId: customerId });
    record("g02", "customer_created", { customer_id: customerId, status: c.status, fixture_country: country, synthetic: true });
  } catch (e) {
    if (e instanceof ProviderError) {
      record("g02", "customer_create_error", { status: e.status, body: e.body, fixture_country: country });
      process.exit(1);
    }
    throw e;
  }
} else {
  console.log(`Reusing Bridge customer ${customerId} from spikes/.raw/state.json`);
}

const link = await bridge("GET", `/v0/customers/${customerId}/kyc_link?endorsement=cards`, undefined, { label: "kyc_link" });
const kycUrl = (link.url ?? link.kyc_link) as string | undefined;
console.log("\n================ HUMAN STEP ================");
console.log("Open this sandbox KYC link and ONLY accept the Terms of Service");
console.log("(leave the pre-populated synthetic data as-is):\n");
console.log(kycUrl ?? JSON.stringify(link));
console.log("============================================\n");
record("g02", "kyc_link_issued", { customer_id: customerId, link_host: kycUrl ? new URL(kycUrl).host : null });

let lastSnapshot = "";
const approved = await poll(
  "cards endorsement",
  async () => {
    const c = await bridge("GET", `/v0/customers/${customerId}`, undefined, { label: "get_customer" });
    const cards = (c.endorsements ?? []).find((x: any) => x.name === "cards");
    const snapshot = JSON.stringify({ status: cards?.status, missing: cards?.requirements?.missing, issues: cards?.requirements?.issues });
    if (snapshot !== lastSnapshot) {
      lastSnapshot = snapshot;
      record("g02", "endorsement_status", { customer_status: c.status, cards_status: cards?.status ?? null, missing: cards?.requirements?.missing ?? null, issues: cards?.requirements?.issues ?? null });
    }
    if (cards?.status === "approved" && c.stripe_cardholder_id) return c;
    return undefined;
  },
  { intervalMs: 10_000, timeoutMs: 45 * 60_000 },
);
if (!approved) {
  record("g02", "FAIL", { reason: "cards endorsement not approved within 45 min", customer_id: customerId });
  process.exit(1);
}

const ich = approved.stripe_cardholder_id as string;
saveState({ stripeCardholderId: ich, cardsEndorsementApprovedAt: new Date().toISOString() });
const holder = await stripe("GET", `/v1/issuing/cardholders/${ich}`, {}, { label: "get_cardholder" });
record("g02", "PASS", {
  customer_id: customerId,
  stripe_cardholder_id: ich,
  stripe_cardholder_status: holder.status,
  stripe_cardholder_type: holder.type,
  note: "cards endorsement is valid for 24h after approval unless a card is created; run g02:refresh if it lapses",
});
