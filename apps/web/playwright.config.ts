import { defineConfig, devices } from "@playwright/test";

// E2E runs ONLY against a local production build in MOCK mode (NEXT_PUBLIC_MOCK_API=1): no external network.
// Uses the system Chrome by default (PW_CHANNEL=chromium to use a Playwright-downloaded browser instead).
const PORT = Number(process.env.E2E_PORT ?? 3100);
const channel = process.env.PW_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Pixel 7"],
    ...(channel === "chromium" ? {} : { channel }),
  },
  webServer: {
    command: `NEXT_PUBLIC_MOCK_API=1 pnpm exec next build && NEXT_PUBLIC_MOCK_API=1 pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
