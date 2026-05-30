import { defineConfig, devices } from "@playwright/test";

// Separate config for perf specs — not used by the default `npm run e2e` gate.
// Run with: npx playwright test --config playwright.perf.config.ts --reporter=list
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.perf.e2e.ts",
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:1420",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
