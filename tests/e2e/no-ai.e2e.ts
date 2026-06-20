import { expect, test } from "@playwright/test";
import { installMockBridge } from "./helpers/mockBridge";

// Contract guard: Shelf does NOT integrate AI into its data layer.
//
// History: Shelf once shipped a deeply-integrated AI (Rust module + AiChat
// component + "Ask AI" command + AI settings). It was removed in commit
// 3cf4c66 and sealed by this guard's predecessor. The contract is now:
//
//   "Shelf has no AI that touches Shelf data. The only AI surface permitted
//    is an isolated external popover (a <webview> embedding user-chosen
//    provider pages) with no access to notes, the DB, Studio, or files."
//
// This test enforces the data-isolation half. The external popover itself
// is covered by external-assistant.e2e.ts.

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
  await page.addInitScript(() => {
    window.localStorage.removeItem("opennotion-current-page-id");
  });
});

test("does not expose data-integrated AI features or content-bound AI IPC", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // No "Ask AI" button (the old integrated assistant entry point).
  await expect(page.getByRole("button", { name: /ask ai/i })).toHaveCount(0);

  // Positive half of the contract: the ONLY AI surface is the isolated
  // external popover, exposed as the "Chat" sidebar button. There must be
  // no in-data AI panel (no Ask-AI overlay rendered inside the workspace).
  const chatButton = page.getByRole("button", { name: "Chat" });
  await expect(chatButton).toHaveCount(1);
  await expect(page.locator(".on-app-shell .ai-chat-panel")).toHaveCount(0);

  // Command palette must not offer an in-data AI command.
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByPlaceholder("Search pages...")).toBeFocused();
  await expect(page.locator(".on-command-panel").getByText(/ask shelf ai/i)).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Settings must not contain an AI section that touches data.
  await page.getByRole("button", { name: "Settings" }).click();
  const popover = page.locator(".on-settings-quick-popover");
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "Settings" }).click();
  const settingsPanel = page.locator(".on-settings-panel");
  await expect(settingsPanel).toBeVisible();
  await expect(settingsPanel.getByRole("heading", { name: /^AI$/i })).toHaveCount(0);

  // No IPC command that would imply an AI reading Shelf content.
  const invokedCommands = await page.evaluate(() => (window as any).__opennotionE2eInvokedCommands as string[]);
  const dataBoundAiCommands = invokedCommands.filter((command) => {
    const lower = command.toLowerCase();
    return (lower.includes("ai_") || lower.includes("_ai")) &&
      !lower.startsWith("external_assistant");
  });
  expect(dataBoundAiCommands).toEqual([]);
});
