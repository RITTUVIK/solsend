import { expect, test, type Page } from "@playwright/test";

const VOID_MESSAGE = "USDC returned to your wallet. This card's spending limit stays used — create a new card to spend more.";
const SHOTS = process.env.E2E_SHOTS; // directory for evidence screenshots (optional)

test.beforeEach(async ({ context }) => {
  // Hard guarantee: nothing leaves localhost.
  await context.route((url) => !["localhost", "127.0.0.1"].includes(url.hostname), (route) => route.abort());
});

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true, scale: "css" });
}

async function login(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("sandbox-banner")).toContainText("Sandbox cards · Solana devnet USDC · no real merchants are charged");
  await shot(page, "01-landing");
  await page.getByRole("button", { name: "Log in with email" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId("balance")).toBeVisible();
}

/** A fresh wallet has no SubscriptionAuthority: the one-time setup (one signature) must confirm before the first card. */
async function setupWallet(page: Page) {
  await expect(page.getByTestId("wallet-setup")).toBeVisible();
  await expect(page.getByTestId("create-card")).toBeDisabled();
  await page.getByTestId("setup-btn").click();
  await expect(page.getByTestId("setup-done")).toContainText("Wallet ready for cards");
  await expect(page.getByTestId("setup-done").getByRole("link", { name: /View on Solana Explorer/ })).toHaveAttribute("href", /cluster=devnet/);
}

async function createCard(page: Page, opts: { label?: string; dollars?: string; store?: string } = {}) {
  await page.getByTestId("new-card").click();
  await expect(page.getByTestId("explain")).toContainText("Your USDC stays in your wallet");
  await setupWallet(page);
  if (opts.store) await page.getByRole("radio", { name: opts.store }).click();
  if (opts.dollars) await page.getByLabel(/Lifetime limit/).fill(opts.dollars);
  if (opts.label) await page.getByLabel("Card name").fill(opts.label);
}

test("judge journey: login → faucet → card → approve → void → decline → freeze → revoke all", async ({ page }) => {
  await login(page);
  await expect(page.getByText("MOCK DATA").first()).toBeVisible();

  // Faucet
  await expect(page.getByTestId("balance")).toContainText("$0.00");
  await page.getByTestId("faucet-btn").click();
  await expect(page.getByTestId("faucet-done")).toContainText("devnet test USDC");
  await expect(page.getByTestId("balance")).toContainText("$100.00");
  await shot(page, "02-home-funded");

  // Create a Temu card ($40 lifetime)
  // Home nudges the one-time setup before any card exists
  await expect(page.getByTestId("wallet-setup")).toBeVisible();
  await shot(page, "02b-setup-needed");
  await page.getByTestId("new-card").click();
  await expect(page.getByTestId("wallet-setup")).toBeVisible();
  await page.getByTestId("setup-btn").click();
  // The mock's first setup submit returns tx_expired once: the UI re-prepares and asks for one more approval automatically.
  await expect(page.getByTestId("sign-notice")).toContainText("Signing took a little long — please approve once more");
  await expect(page.getByTestId("setup-done")).toContainText("Wallet ready for cards");
  await expect(page.getByTestId("sign-notice")).toHaveCount(0);
  await expect(page.getByTestId("setup-done").getByRole("link", { name: /View on Solana Explorer/ })).toHaveAttribute("href", /cluster=devnet/);
  await expect(page.getByTestId("explain")).toContainText("at most $40.00");
  await expect(page.getByTestId("explain")).toContainText("Temu (sandbox)");
  await shot(page, "03-new-card");
  await page.getByTestId("create-card").click();
  await expect(page.getByTestId("step-2")).toHaveAttribute("data-state", /active|done/);
  // Never "Ready" before issued: step 3 is only done once issuance finished.
  await expect(page.getByTestId("step-1")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("step-3")).toHaveAttribute("data-state", "todo");
  await shot(page, "04-creating");
  await expect(page.getByTestId("step-3")).toHaveAttribute("data-state", "done", { timeout: 20_000 });
  await expect(page.getByRole("link", { name: /View on Solana Explorer/ }).first()).toHaveAttribute("href", /cluster=devnet/);
  await page.getByTestId("open-card").click();

  // Card detail: lock badge + hosted iframe (mock stand-in)
  await expect(page.getByTestId("lock-badge")).toContainText("Locked to Temu (sandbox) — a leaked number is useless anywhere else, even before first use");
  await page.getByTestId("show-details").click();
  await expect(page.getByTestId("embed-pan")).toBeVisible();
  await expect(page.getByTestId("embed-cvv")).toBeVisible();
  await shot(page, "05-card-detail");

  // Demo store: a Temu card is pre-locked onchain, so a FIRST use at Amazon is declined
  await page.getByTestId("spend").click();
  await page.getByTestId("store-AMAZON").click();
  await page.getByLabel(/Amount/).fill("5");
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("result")).toHaveAttribute("data-decision", "DECLINED");
  await expect(page.getByTestId("reason")).toContainText("Card locked to another store");
  await shot(page, "05b-prelock-decline");

  // ...then approve $12 at Temu
  await page.getByTestId("store-TEMU").click();
  await page.getByLabel(/Amount/).fill("12");
  await page.getByTestId("pay").click();
  const result = page.getByTestId("result");
  await expect(result).toHaveAttribute("data-decision", "APPROVED");
  await expect(result.getByRole("link", { name: /View settlement/ })).toHaveAttribute("href", /cluster=devnet/);
  await expect(result.getByTestId("lithic-token")).not.toBeEmpty();
  await expect(result).toContainText("SANDBOX");
  await expect(result.getByTestId("latency")).toContainText(/\d+ ms/);
  await expect(result).toContainText("Remaining on this card");
  await expect(result.getByTestId("remaining")).toContainText("$28.00");
  await shot(page, "06-approved");

  // Void → refund → exact message; limit stays used
  await page.getByTestId("void-btn").click();
  await expect(page.getByTestId("void-message")).toHaveText(VOID_MESSAGE, { timeout: 20_000 });
  await expect(page.getByTestId("void-done").getByRole("link", { name: /Refund transaction/ })).toHaveAttribute("href", /cluster=devnet/);
  await shot(page, "07-voided");

  // Over limit: $45 on a card with $28 left (within 2x of the onchain limit) → declined by the chain
  await page.getByLabel(/Amount/).fill("45");
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("result")).toHaveAttribute("data-decision", "DECLINED");
  await expect(page.getByTestId("reason")).toContainText("Over this card's limit");
  await expect(page.getByTestId("result").getByRole("link", { name: /failed tx/ })).toHaveAttribute("href", /cluster=devnet/);
  await shot(page, "08-declined");

  // Activity feed shows sandbox merchant + source badge
  await page.goto("/activity");
  await expect(page.getByTestId("feed-row").first()).toBeVisible();
  await expect(page.getByText("onchain via QuickNode Streams").first()).toBeVisible();
  await expect(page.getByText(/Temu \(sandbox\)/).first()).toBeVisible();
  await shot(page, "09-activity");

  // Freeze
  await page.goto("/home");
  await page.getByTestId("card-tile").first().click();
  await page.getByTestId("freeze").click();
  await expect(page.getByTestId("action-done")).toContainText("Card frozen");
  await expect(page.getByTestId("action-done").getByRole("link", { name: /Explorer/ })).toHaveAttribute("href", /cluster=devnet/);
  await expect(page.getByTestId("unfreeze")).toBeVisible();
  await shot(page, "10-frozen");

  // Revoke all
  await page.goto("/home");
  await expect(page.getByTestId("outage-balance")).toContainText("$100.00");
  await shot(page, "11-home-outage");
  await page.getByRole("button", { name: "Revoke all cards" }).click();
  await expect(page.getByTestId("revoke-done")).toContainText("All cards revoked");
  await expect(page.getByTestId("revoke-done").getByRole("link", { name: /Explorer/ })).toHaveAttribute("href", /cluster=devnet/);
  await expect(page.getByTestId("card-tile").first()).toContainText("Revoked");
});

test("lithic_failed is recoverable and never shows Ready early", async ({ page }) => {
  await login(page);
  await createCard(page, { label: "fail me" });
  await page.getByTestId("create-card").click();
  await expect(page.getByTestId("step-2")).toHaveAttribute("data-state", "error", { timeout: 20_000 });
  await expect(page.getByTestId("step-3")).toHaveAttribute("data-state", "todo");
  await shot(page, "12-lithic-failed");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("step-3")).toHaveAttribute("data-state", "done", { timeout: 20_000 });
});

test("card-network safety limit decline has no onchain transaction", async ({ page }) => {
  await login(page);
  await page.getByTestId("faucet-btn").click();
  await expect(page.getByTestId("faucet-done")).toBeVisible();
  await createCard(page, { dollars: "10" });
  await page.getByTestId("create-card").click();
  await expect(page.getByTestId("step-3")).toHaveAttribute("data-state", "done", { timeout: 20_000 });
  await page.getByTestId("open-card").click();
  await page.getByTestId("spend").click();
  await page.getByLabel(/Amount/).fill("25"); // > 2x the $10 onchain limit
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("reason")).toContainText("Declined by card-network safety limit (sandbox)");
  await expect(page.getByTestId("no-onchain")).toContainText("No onchain transaction");
});

test("idle card: decline reason + Reactivate (unfreeze action)", async ({ page }) => {
  await login(page);
  await page.getByTestId("faucet-btn").click();
  await expect(page.getByTestId("faucet-done")).toBeVisible();
  await createCard(page, { label: "idle me" });
  await page.getByTestId("create-card").click();
  await expect(page.getByTestId("step-3")).toHaveAttribute("data-state", "done", { timeout: 20_000 });
  await page.getByTestId("open-card").click();
  await page.getByTestId("spend").click();
  await page.getByLabel(/Amount/).fill("5");
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("reason")).toContainText("Card idle — unfreeze to reactivate");
  await page.goto("/home");
  await page.getByTestId("card-tile").first().click();
  await expect(page.getByTestId("reactivate")).toBeVisible({ timeout: 15_000 });
  await shot(page, "12b-idle-reactivate");
  await page.getByTestId("reactivate").click();
  await expect(page.getByTestId("action-done")).toContainText("Card unfrozen");
  await page.getByTestId("spend").click();
  await page.getByLabel(/Amount/).fill("5");
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("result")).toHaveAttribute("data-decision", "APPROVED");
});

test("other-store card locks to the first store that charges it", async ({ page }) => {
  await login(page);
  await page.getByTestId("faucet-btn").click();
  await expect(page.getByTestId("faucet-done")).toBeVisible();
  await createCard(page, { store: "Other" });
  await page.getByLabel("Store name").fill("Corner Cafe");
  await expect(page.getByTestId("explain")).toContainText("first store that charges it");
  await page.getByTestId("create-card").click();
  await expect(page.getByTestId("step-3")).toHaveAttribute("data-state", "done", { timeout: 20_000 });
  await page.getByTestId("open-card").click();
  await expect(page.getByTestId("lock-badge")).toContainText("Locks to the first store that charges it");
  await page.getByTestId("spend").click();
  await page.getByTestId("store-OTHER_STORE").click();
  await page.getByLabel(/Amount/).fill("5");
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("result")).toHaveAttribute("data-decision", "APPROVED");
  await page.getByTestId("store-NETFLIX").click();
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("reason")).toContainText("Card locked to another store");
});

test("void from the Activity feed (and the store page) after navigating away", async ({ page }) => {
  await login(page);
  await page.getByTestId("faucet-btn").click();
  await expect(page.getByTestId("faucet-done")).toBeVisible();
  await createCard(page);
  await page.getByTestId("create-card").click();
  await expect(page.getByTestId("step-3")).toHaveAttribute("data-state", "done", { timeout: 20_000 });
  await page.getByTestId("open-card").click();
  await page.getByTestId("spend").click();
  await page.getByLabel(/Amount/).fill("5");
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("result")).toHaveAttribute("data-decision", "APPROVED");
  // Recent purchases on the store page offer the void too
  await expect(page.getByText("Recent sandbox purchases")).toBeVisible();
  await expect(page.getByTestId("row-void-btn").first()).toBeVisible();

  // Navigate away (the checkout void button is gone), then void from Activity
  await page.goto("/activity");
  const btn = page.getByTestId("row-void-btn");
  await expect(btn).toHaveCount(1);
  await btn.click();
  await expect(page.getByTestId("void-sheet")).toContainText("Simulates the store cancelling this sandbox order. The USDC returns to your wallet onchain; this card's spending limit stays used.");
  await shot(page, "16-void-sheet");
  await page.getByTestId("void-confirm").click();
  await expect(page.getByTestId("void-sheet")).toHaveCount(0);
  // Pending until the refunded feed row appears, then Refunded + explorer link
  const status = page.getByTestId("row-void-status");
  await expect(status).toBeVisible();
  await expect(status).toContainText("Refunded", { timeout: 20_000 });
  await expect(status.getByRole("link", { name: /Refund transaction/ })).toHaveAttribute("href", /cluster=devnet/);
  await expect(page.locator('[data-testid="feed-row"][data-kind="refunded"]')).toHaveCount(1);
  await expect(page.getByTestId("row-void-btn")).toHaveCount(0);
  await shot(page, "17-void-from-activity");
});

test("status page renders health checks", async ({ page }) => {
  await page.goto("/status");
  await expect(page.getByTestId("overall")).toContainText("All systems operational");
  expect(await page.getByTestId("check").count()).toBeGreaterThan(3);
  await expect(page.getByTestId("sandbox-banner")).toBeVisible();
  await shot(page, "13-status");
});

test.describe("desktop + dark mode", () => {
  test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "dark", isMobile: false, hasTouch: false });
  test("landing and home render in dark mode on desktop", async ({ page }) => {
    await login(page);
    await page.getByTestId("faucet-btn").click();
    await expect(page.getByTestId("faucet-done")).toBeVisible();
    await shot(page, "14-desktop-dark-home");
    await page.goto("/status");
    await expect(page.getByTestId("overall")).toBeVisible();
    await shot(page, "15-desktop-dark-status");
  });
});
