import { expect, test } from "@playwright/test";
import { installMockBridge } from "./helpers/mockBridge";

// Covers the popover lifecycle. The mock bridge stubs externalAssistant.toggle
// (it cannot spawn a real Electron child window under the Vite-only e2e setup),
// so these tests assert the renderer-side entry points fire the bridge call
// correctly. Controller lifecycle/security behavior is covered by
// electron/external-assistant-controller.test.cjs.

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
  await page.addInitScript(() => {
    window.localStorage.removeItem("opennotion-current-page-id");
  });
});

test("sidebar Chat button calls externalAssistant.toggle", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Chat" }).click();

  const calls = await page.evaluate(() => (window as any).__externalAssistantToggleCalls ?? 0);
  expect(calls).toBeGreaterThanOrEqual(1);
});

test("Cmd+Shift+A shortcut calls externalAssistant.toggle", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.keyboard.press("Meta+Shift+A");

  const calls = await page.evaluate(() => (window as any).__externalAssistantToggleCalls ?? 0);
  expect(calls).toBeGreaterThanOrEqual(1);
});

// NOTE: the real provider login flow (ChatGPT / Gemini) is NOT tested here.
// It requires live credentials and external network access, which makes it
// flaky and inappropriate for CI. It is verified manually before release.
