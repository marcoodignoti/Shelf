import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const invokedCommands: string[] = [];

    window.openNotion = {
      invoke: async (cmd: string) => {
        invokedCommands.push(cmd);

        if (cmd === "list_pages" || cmd === "list_all_pages" || cmd === "search_pages") return [];
        if (cmd === "list_studio_documents" || cmd === "list_studio_projects" || cmd === "list_all_studio_document_page_links") return [];
        if (cmd === "show_character_palette") return null;
        if (cmd === "get_workspace_profile") return { name: "", workspaceName: "Shelf", avatarPath: null };

        throw new Error(`Unhandled no-ai e2e command: ${cmd}`);
      },
      open: async () => null,
      save: async () => null,
      fileSrc: (filePath: string) => filePath,
    };

    window.localStorage.removeItem("opennotion-current-page-id");
    window.localStorage.setItem("opennotion-e2e-invoked-commands", JSON.stringify(invokedCommands));
    Object.defineProperty(window, "__opennotionE2eInvokedCommands", {
      get: () => invokedCommands,
    });
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
  const settingsPanel = page.locator(".on-settings-panel");
  await expect(settingsPanel).toBeVisible();
  await expect(settingsPanel.getByText(/AI/i)).toHaveCount(0);

  const invokedCommands = await page.evaluate(() => (window as any).__opennotionE2eInvokedCommands as string[]);
  expect(invokedCommands.filter((command) => command.includes("_ai_") || command.includes("ai_"))).toEqual([]);
});
