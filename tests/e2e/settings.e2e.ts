import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const profile = { name: "", workspaceName: "OpenNotion", avatarPath: null as string | null };

    window.openNotion = {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "list_pages" || cmd === "list_all_pages" || cmd === "search_pages") return [];
        if (cmd === "list_studio_documents" || cmd === "list_studio_projects" || cmd === "list_all_studio_document_page_links") return [];
        if (cmd === "get_workspace_profile") return { ...profile };
        if (cmd === "update_workspace_profile") {
          if (typeof args?.name === "string") profile.name = args.name;
          if (typeof args?.workspaceName === "string") profile.workspaceName = args.workspaceName;
          if (args && "avatarPath" in args && args.avatarPath === null) profile.avatarPath = null;
          return { ...profile };
        }
        if (cmd === "show_character_palette") return null;
        throw new Error(`Unhandled settings e2e command: ${cmd}`);
      },
      open: async () => null,
      save: async () => null,
      fileSrc: (filePath: string) => filePath,
    };

    // Clear only once per test — not on subsequent reloads — so that
    // preference values written before a reload survive it.
    if (!window.sessionStorage.getItem("__settings-e2e-init__")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("__settings-e2e-init__", "1");
    }
  });
});

async function openSettings(page: import("@playwright/test").Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator(".on-settings-panel")).toBeVisible();
}

test("appearance preferences persist to localStorage", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByLabel("Font").selectOption("serif");
  await page.getByLabel("Text size").selectOption("large");
  expect(await page.evaluate(() => localStorage.getItem("opennotion-editor-font"))).toBe("serif");
  expect(await page.evaluate(() => localStorage.getItem("opennotion-editor-font-size"))).toBe("large");
});

test("switching language to Italian translates the modal instantly", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: "Preferences" }).click();
  await page.getByLabel("Language").selectOption("it");
  await expect(page.getByRole("button", { name: "Preferenze" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aspetto" })).toBeVisible();
});

test("profile name edits reflect in the sidebar card", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Marco");
  await page.getByLabel("Name", { exact: true }).blur();
  await expect(page.locator(".on-settings-account-card")).toContainText("Marco");
});

test("preferences persist across reload", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: "Preferences" }).click();
  await page.getByLabel("Page width").selectOption("full");
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => localStorage.getItem("opennotion-page-width"))).toBe("full");
});
