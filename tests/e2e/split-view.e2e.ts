import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "./helpers/mockBridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

function sidebarPageRow(page: Page, title: string) {
  return page.locator(".on-sidebar-page-row:not(.on-sidebar-project-row)", { hasText: title });
}

async function createPageAndFocusEditor(page: Page, title: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New page" }).first().click();
  await page.getByText("Blank page").click();
  const titleInput = page.locator("textarea[placeholder='Untitled']");
  await expect(titleInput).toBeVisible({ timeout: 60_000 });
  await titleInput.fill(title);
  await titleInput.press("Enter");
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeFocused();
  // Let the title autosave persist before any subsequent navigation/reload.
  await page.waitForTimeout(700);
  return editor;
}

test("split view places two pages side by side and closes with shortcut", async ({ page }) => {
  test.setTimeout(45_000);
  // Create page A, then page B (we end focused in B's editor).
  await createPageAndFocusEditor(page, "Split A");
  await createPageAndFocusEditor(page, "Split B");

  // Navigate to page A via the sidebar (no reload — stays in the same app session).
  await sidebarPageRow(page, "Split A").click();

  // Open the split picker via the toolbar button (no split yet → opens picker directly).
  await page.getByRole("button", { name: "Split view" }).click();

  // Pick page B in the picker.
  await page.getByPlaceholder(/Search a page to place beside/i).fill("Split B");
  await page.locator(".on-split-picker .on-command-item", { hasText: "Split B" }).click();

  // Both panes are visible side by side.
  await expect(page.locator(".on-split-pane", { hasText: "Split A" })).toBeVisible();
  await expect(page.locator(".on-split-pane", { hasText: "Split B" })).toBeVisible();
  await expect(page.locator(".on-split-divider")).toBeVisible();

  // Toggle off with cmd+\
  await page.keyboard.press("Meta+\\");
  await expect(page.locator(".on-split-divider")).toHaveCount(0);
});

test("swapping panels keeps both pages visible", async ({ page }) => {
  test.setTimeout(45_000);
  await createPageAndFocusEditor(page, "Swap A");
  await createPageAndFocusEditor(page, "Swap B");

  await sidebarPageRow(page, "Swap A").click();
  await page.getByRole("button", { name: "Split view" }).click();
  await page.getByPlaceholder(/Search a page to place beside/i).fill("Swap B");
  await page.locator(".on-split-picker .on-command-item", { hasText: "Swap B" }).click();

  // Swap with cmd+shift+\
  await page.keyboard.press("Meta+Shift+\\");

  await expect(page.locator(".on-split-pane", { hasText: "Swap A" })).toBeVisible();
  await expect(page.locator(".on-split-pane", { hasText: "Swap B" })).toBeVisible();
});

