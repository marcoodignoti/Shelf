import { expect, test } from "@playwright/test";
import { installMockBridge } from "./helpers/mockBridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
  await page.addInitScript(() => {
    window.localStorage.removeItem("opennotion-current-page-id");
  });
});

test("does not expose AI features or call AI backend commands", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("button", { name: /ask ai/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByPlaceholder("Search pages...")).toBeFocused();
  await expect(page.locator(".on-command-panel").getByText(/AI/i)).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Settings" }).click();
  // The sidebar footer button opens a quick-settings popover first; opening a
  // section from it swaps the app to the full-screen settings window.
  const popover = page.locator(".on-settings-quick-popover");
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "Settings" }).click();
  const settingsPanel = page.locator(".on-settings-panel");
  await expect(settingsPanel).toBeVisible();
  await expect(settingsPanel.getByText(/AI/i)).toHaveCount(0);

  const invokedCommands = await page.evaluate(() => (window as any).__opennotionE2eInvokedCommands as string[]);
  expect(invokedCommands.filter((command) => command.includes("_ai_") || command.includes("ai_"))).toEqual([]);
});
