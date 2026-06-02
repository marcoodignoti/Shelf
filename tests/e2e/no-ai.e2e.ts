import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const invokedCommands: string[] = [];
    let callbackCounter = 0;

    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => {
        callbackCounter += 1;
        return callbackCounter;
      },
      unregisterCallback: () => undefined,
      convertFileSrc: (filePath: string) => filePath,
      invoke: async (cmd: string) => {
        invokedCommands.push(cmd);

        if (cmd === "list_pages" || cmd === "list_all_pages" || cmd === "search_pages") return [];
        if (cmd === "list_studio_documents" || cmd === "list_studio_projects") return [];
        if (cmd === "show_character_palette") return null;

        throw new Error(`Unhandled no-ai e2e command: ${cmd}`);
      },
    };

    window.localStorage.removeItem("opennotion-current-page-id");
    window.localStorage.removeItem("opennotion-workspace-mode");
    window.localStorage.setItem("opennotion-e2e-invoked-commands", JSON.stringify(invokedCommands));
    Object.defineProperty(window, "__opennotionE2eInvokedCommands", {
      get: () => invokedCommands,
    });
  });
});

test("does not expose AI features or call AI backend commands", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: /ask ai/i })).toHaveCount(0);

  await page.keyboard.press("Meta+K");
  await expect(page.getByPlaceholder("Search pages...")).toBeFocused();
  await expect(page.locator(".on-command-panel").getByText(/AI/i)).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Settings" }).click();
  const settingsPanel = page.locator(".on-settings-panel");
  await expect(settingsPanel).toBeVisible();
  await expect(settingsPanel.getByText(/AI/i)).toHaveCount(0);

  const invokedCommands = await page.evaluate(() => (window as any).__opennotionE2eInvokedCommands as string[]);
  expect(invokedCommands.filter((command) => command.includes("_ai_") || command.includes("ai_"))).toEqual([]);
});
