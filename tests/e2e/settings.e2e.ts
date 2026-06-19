import { expect, test } from "@playwright/test";
import { installMockBridge } from "./helpers/mockBridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);

  await page.addInitScript(() => {
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
  // The sidebar footer button opens a quick-settings popover first; opening a
  // section from it swaps the app to the full-screen settings window.
  await expect(page.locator(".on-settings-quick-popover")).toBeVisible();
  await page.locator(".on-settings-quick-popover").getByRole("button", { name: "Settings" }).click();
  await expect(page.locator(".on-settings-panel")).toBeVisible();
}

test("appearance preferences persist to localStorage", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByLabel("Font").selectOption("serif");
  await page.getByLabel("Text size").selectOption("large");
  expect(await page.evaluate(() => localStorage.getItem("shelf-editor-font"))).toBe("serif");
  expect(await page.evaluate(() => localStorage.getItem("shelf-editor-font-size"))).toBe("large");
});

test("switching language to Italian translates the modal instantly", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: "General" }).click();
  await page.getByLabel("Language").selectOption("it");
  await expect(page.getByRole("button", { name: "Generali" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aspetto" })).toBeVisible();
});

test("profile name edits reflect in the sidebar card", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Marco");
  await page.getByLabel("Name", { exact: true }).blur();
  await expect(page.locator(".on-settings-profile-hero")).toContainText("Marco");
});

test("preferences persist across reload", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: "General" }).click();
  await page.getByLabel("Page width").selectOption("full");
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => localStorage.getItem("opennotion-page-width"))).toBe("full");
});
