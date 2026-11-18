import { expect, test, type Page } from "@playwright/test";

const VOID_MESSAGE = "USDC returned to your wallet. This card's spending limit stays used — create a new card to spend more.";
const BANNER = "Sandbox cards · Solana devnet USDC · no real merchants are charged";
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
  await expect(page.getByTestId("sandbox-banner")).toHaveText(BANNER);
  await shot(page, "01-landing");
  await page.getByRole("button", { name: "Try the sandbox demo" }).click();
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

async function createCard(page: Page, opts: { label?: string; dollars?: string; store?: string; kind?: string; expiry?: string } = {}) {
  await page.getByTestId("new-card").click();
  await expect(page.getByTestId("explain")).toContainText("Your USDC stays in your wallet");
  await setupWallet(page);
  if (opts.store) await page.getByRole("radio", { name: new RegExp(`^${opts.store}`) }).click();
  if (opts.kind) await page.getByRole("radio", { name: opts.kind, exact: true }).click();
  if (opts.expiry) await page.getByTestId(`expiry-${opts.expiry}`).click();
  if (opts.dollars) await page.getByLabel(/limit \(USD\)/).fill(opts.dollars);
  if (opts.label) await page.getByLabel("Card name").fill(opts.label);
}

async function created(page: Page) {
  await page.getByTestId("create-card").click();
  await expect(page.getByTestId("step-3")).toHaveAttribute("data-state", "done", { timeout: 20_000 });
}

async function pay(page: Page, store: string | null, dollars: string) {
  await expect(page.getByTestId("pay")).toBeEnabled(); // a card is selected (selection may reset the store)
  if (store) await page.getByTestId(`store-${store}`).click();
  await page.getByLabel(/Amount/).fill(dollars);
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("result")).toBeVisible();
}
const closeSheet = (page: Page) => page.getByTestId("sheet-done").click();

test("judge journey: login → faucet → card → approve → void → decline → freeze → revoke all", async ({ page }) => {
  await login(page);
  await expect(page.getByText("MOCK DATA").first()).toBeVisible();

  // Faucet (onboarding checklist step 1)
  await expect(page.getByTestId("balance")).toContainText("$0.00");
  await page.getByTestId("faucet-btn").click();
  await expect(page.getByTestId("faucet-done")).toContainText("devnet test USDC");
  await expect(page.getByTestId("balance")).toContainText("$100.00");
  // Blast radius: nothing can be pulled before any card exists
  await expect(page.getByTestId("blast-amount")).toHaveText("$0.00");
  await shot(page, "02-home-funded");

  // Home nudges the one-time setup before any card exists (checklist step 2)
  await expect(page.getByTestId("wallet-setup")).toBeVisible();
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
  await expect(page.getByRole("link", { name: /View on Solana Explorer|Allowance created/ }).first()).toHaveAttribute("href", /cluster=devnet/);
  await page.getByTestId("open-card").click();

  // Card detail: honest lock wording + hosted iframe (mock stand-in)
  await expect(page.getByTestId("lock-badge")).toContainText("Locked to Temu (sandbox)");
  await page.getByTestId("show-details").click();
  await expect(page.getByTestId("embed-pan")).toBeVisible();
  await expect(page.getByTestId("embed-cvv")).toBeVisible();
  await shot(page, "05-card-detail");

  // Demo store: a Temu card is pre-locked onchain, so a FIRST use at Amazon (a leaked number) is declined
  await page.getByTestId("show-details").click(); // hide
  await page.getByTestId("spend").click();
  await expect(page.getByTestId("pay")).toBeEnabled();
  await page.getByTestId("store-AMAZON").click();
  await expect(page.getByTestId("leak-callout")).toBeVisible();
  await pay(page, null, "5");
  await expect(page.getByTestId("result")).toHaveAttribute("data-decision", "DECLINED");
  await expect(page.getByTestId("reason")).toContainText("Card locked to another store");
  await expect(page.getByTestId("decline-story")).toContainText("Your USDC didn't move");
  await shot(page, "05b-prelock-decline");
  await closeSheet(page);

  // ...then approve $12 at Temu: the approval sheet must be fully in view on a phone (the old blocker)
  await pay(page, "TEMU", "12");
  const result = page.getByTestId("result");
  await expect(result).toHaveAttribute("data-decision", "APPROVED");
  await expect(result.getByTestId("decision")).toBeInViewport();
  await expect(result.getByRole("link", { name: /View settlement/ })).toHaveAttribute("href", /cluster=devnet/);
  await expect(result.getByTestId("lithic-token")).not.toBeEmpty();
  await expect(result).toContainText(/sandbox/i);
  await expect(result.getByTestId("latency")).toContainText(/\d+ ms/);
  await expect(result).toContainText("Remaining on this card");
  await expect(result.getByTestId("remaining")).toContainText("$28.00");
  await expect(result.getByTestId("wallet-delta")).toContainText("$88.00");
  await shot(page, "06-approved");

  // Void → refund → exact message; limit stays used
  await page.getByTestId("void-btn").click();
  await expect(page.getByTestId("void-message")).toHaveText(VOID_MESSAGE, { timeout: 20_000 });
  await expect(page.getByTestId("void-done").getByRole("link", { name: /Refund transaction/ })).toHaveAttribute("href", /cluster=devnet/);
  await shot(page, "07-voided");
  await closeSheet(page);

  // Over limit: $45 drone on a card with $28 left (within 2x of the onchain limit) → declined by the chain
  await pay(page, "TEMU", "45");
  await expect(page.getByTestId("result")).toHaveAttribute("data-decision", "DECLINED");
  await expect(page.getByTestId("reason")).toContainText("Over this card's limit");
  await expect(page.getByTestId("result").getByRole("link", { name: /failed tx/ })).toHaveAttribute("href", /cluster=devnet/);
  await shot(page, "08-declined");
  await closeSheet(page);

  // Activity feed: one row per purchase + QuickNode attribution
  await page.goto("/activity");
  await expect(page.getByTestId("feed-row").first()).toBeVisible();
  await expect(page.getByText("Streamed by QuickNode").first()).toBeVisible();
  await expect(page.getByText(/Temu \(sandbox\)/).first()).toBeVisible();
  await shot(page, "09-activity");

  // Freeze (toast carries the onchain proof)
  await page.goto("/home");
  await expect(page.getByTestId("blast-amount")).toHaveText("$28.00");
  await page.getByTestId("card-tile").first().click();
  await page.getByTestId("freeze").click();
  await expect(page.getByTestId("action-done")).toContainText("Card frozen");
  await expect(page.getByTestId("action-done").getByRole("link", { name: /Explorer/ })).toHaveAttribute("href", /cluster=devnet/);
  await expect(page.getByTestId("unfreeze")).toBeVisible();
  await shot(page, "10-frozen");

  // Revoke all (confirm sheet)
  await page.goto("/home");
  await expect(page.getByTestId("outage-balance")).toContainText("$100.00");
  await shot(page, "11-home-outage");
  // Rehearsal bug (2026-11-18): our modal confirm <dialog> stayed open in the browser top layer and covered the wallet's
  // approval window. Manual mock-wallet mode: the test must CLICK the wallet's buttons, which fails if anything covers them.
  await page.evaluate(() => localStorage.setItem("solsend.mock.sign", "manual"));
  const liveCount = async () => /(\d+) live allowance/.exec((await page.getByTestId("safety").textContent()) ?? "")?.[1] ?? null;
  const liveBefore = await liveCount();
  expect(Number(liveBefore)).toBeGreaterThan(0);
  await page.getByTestId("revoke-open").click();
  await expect(page.getByTestId("revoke-sheet")).toBeVisible();
  await page.getByTestId("revoke-confirm").click();
  await expect(page.getByTestId("mock-wallet")).toBeVisible();
  expect(await page.evaluate(() => document.querySelectorAll("dialog:modal").length)).toBe(0); // nothing in the top layer
  await expect(page.getByTestId("revoke-progress")).toHaveAttribute("data-phase", "signing");
  await expect(page.getByTestId("revoke-progress")).toContainText("Approve the revoke in your wallet window");
  await shot(page, "11b-revoke-wallet-approval");
  // Cancel in the wallet → nothing sent, cards unchanged, clear retry.
  await page.getByTestId("mock-wallet-reject").click();
  await expect(page.getByTestId("revoke-error")).toContainText("Signing was cancelled. Nothing was sent.");
  await expect(page.getByTestId("revoke-error")).toContainText("Nothing was sent to Solana. Your cards are unchanged.");
  await expect.poll(liveCount).toBe(liveBefore);
  // Retry → approve (a real click: proves the approval window is reachable) → confirmed.
  await page.getByTestId("revoke-open").click();
  await page.getByTestId("revoke-confirm").click();
  await page.getByTestId("mock-wallet-approve").click();
  await expect(page.getByTestId("revoke-done")).toContainText("All cards revoked");
  await page.evaluate(() => localStorage.removeItem("solsend.mock.sign"));
  await expect(page.getByTestId("revoke-done").getByRole("link", { name: /Explorer/ })).toHaveAttribute("href", /cluster=devnet/);
  await expect(page.getByTestId("card-tile").first()).toContainText("Revoked");
  await expect(page.getByTestId("blast-amount")).toHaveText("$0.00");
});

test("approval sheet is fully above the fold on a 390×844 phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByTestId("faucet-btn").click();
  await expect(page.getByTestId("faucet-done")).toBeVisible();
  await createCard(page);
  await created(page);
  await page.goto("/merchant");
  await expect(page.getByTestId("pay")).toBeEnabled();
  await page.getByTestId("pay").click();
  const sheet = page.getByTestId("approval-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("result")).toHaveAttribute("data-decision", "APPROVED");
  for (const id of ["decision", "remaining", "sheet-done"]) await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
  const box = await page.getByTestId("decision").boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(844);
  // Mobile-first: no horizontal page scroll on the store page (card carousel scrolls inside its own row)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
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
  await created(page);
  await page.getByTestId("open-card").click();
  await page.getByTestId("spend").click();
  await pay(page, null, "25"); // > 2x the $10 onchain limit
  await expect(page.getByTestId("reason")).toContainText("Declined by card-network safety limit (sandbox)");
  await expect(page.getByTestId("no-onchain")).toContainText("No onchain transaction");
});

test("idle card: decline reason + Reactivate (unfreeze action)", async ({ page }) => {
  await login(page);
  await page.getByTestId("faucet-btn").click();
  await expect(page.getByTestId("faucet-done")).toBeVisible();
  await createCard(page, { label: "idle me" });
  await created(page);
  await page.getByTestId("open-card").click();
  await page.getByTestId("spend").click();
  await pay(page, null, "5");
  await expect(page.getByTestId("reason")).toContainText("Card idle — unfreeze to reactivate");
  await closeSheet(page);
  await page.goto("/home");
  await page.getByTestId("card-tile").first().click();
  await expect(page.getByTestId("reactivate")).toBeVisible({ timeout: 15_000 });
  await shot(page, "12b-idle-reactivate");
  await page.getByTestId("reactivate").click();
  await expect(page.getByTestId("action-done")).toContainText("Card unfrozen");
  await page.getByTestId("spend").click();
  await pay(page, null, "5");
  await expect(page.getByTestId("result")).toHaveAttribute("data-decision", "APPROVED");
});

test("other-store card locks to the first store that charges it", async ({ page }) => {
  await login(page);
  await page.getByTestId("faucet-btn").click();
  await expect(page.getByTestId("faucet-done")).toBeVisible();
  await createCard(page, { store: "Other", kind: "Store-locked" });
  await page.getByLabel("Store name").fill("Corner Cafe");
  await expect(page.getByTestId("explain")).toContainText("first store that charges it");
  await created(page);
  await page.getByTestId("open-card").click();
  await expect(page.getByTestId("lock-badge")).toContainText("Locks to the first store that charges it");
  await page.getByTestId("spend").click();
  await pay(page, "OTHER_STORE", "5");
  await expect(page.getByTestId("result")).toHaveAttribute("data-decision", "APPROVED");
  await closeSheet(page);
  await page.getByTestId("store-NETFLIX").click();
  await page.getByTestId("pay").click();
  await expect(page.getByTestId("reason")).toContainText("Card locked to another store");
});

test("free-trial card: expiry chip, then expired card is declined with free-trial copy", async ({ page }) => {
  await page.clock.install();
  await login(page);
  await page.getByTestId("faucet-btn").click();
  await expect(page.getByTestId("faucet-done")).toBeVisible();
  // Netflix defaults to the free-trial template: SUBSCRIPTION $15.49/month, expires after 7 days
  await createCard(page, { store: "Netflix" });
  await expect(page.getByRole("radio", { name: "After a 7-day free trial" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("explain")).toContainText("expires in 7 days");
  await page.getByTestId("expiry-2").click(); // "2 minutes (demo)"
  await expect(page.getByTestId("explain")).toContainText("expires in 2 minutes");
  await created(page);
  await page.getByTestId("open-card").click();
  await expect(page.getByTestId("expiry-chip")).toContainText(/Expires in [12]m/);
  await page.goto("/home");
  await expect(page.getByTestId("blast-amount")).toHaveText("$15.49");
  await page.clock.fastForward("02:10");
  await expect(page.getByTestId("card-tile").first()).toContainText("Expired", { timeout: 10_000 });
  await expect(page.getByTestId("blast-amount")).toHaveText("$0.00");
  await page.getByTestId("card-tile").first().click();
  await expect(page.getByTestId("expired-note")).toBeVisible();
  await shot(page, "18-expired-card");
  await page.goto("/merchant");
  await pay(page, "NETFLIX", "15.49");
  await expect(page.getByTestId("result")).toHaveAttribute("data-decision", "DECLINED");
  await expect(page.getByTestId("decline-story")).toHaveText("This card expired when your free trial ended. Your USDC didn't move.");
});

test("void from the Activity feed (and the store page) after navigating away", async ({ page }) => {
  await login(page);
  await page.getByTestId("faucet-btn").click();
  await expect(page.getByTestId("faucet-done")).toBeVisible();
  await createCard(page);
  await created(page);
  await page.getByTestId("open-card").click();
  await page.getByTestId("spend").click();
  await pay(page, null, "5");
  await expect(page.getByTestId("result")).toHaveAttribute("data-decision", "APPROVED");
  await closeSheet(page);
  // Recent purchases on the store page offer the void too
  await expect(page.getByText("Recent sandbox purchases")).toBeVisible();
  await expect(page.getByTestId("row-void-btn").first()).toBeVisible();

  // Navigate away, then void from Activity
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
  await expect(page.locator('[data-testid="feed-row"][data-kind="purchase"][data-refunded="true"]')).toHaveCount(1);
  await expect(page.getByTestId("row-void-btn")).toHaveCount(0);
  await shot(page, "17-void-from-activity");
});

test("status page renders health checks", async ({ page }) => {
  await page.goto("/status");
  await expect(page.getByTestId("overall")).toContainText("All systems operational");
  expect(await page.getByTestId("check").count()).toBeGreaterThan(3);
  await expect(page.getByTestId("sandbox-banner")).toHaveText(BANNER);
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
