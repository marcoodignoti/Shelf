import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, type MockPage } from "./helpers/mockBridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

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
  return editor;
}

test("creates a checklist from the slash menu and stays responsive", async ({ page }) => {
  test.setTimeout(45_000);
  const editor = await createPageAndFocusEditor(page, "Checklist Slash");

  await editor.pressSequentially("/check");
  await expect(page.locator(".bn-suggestion-menu")).toBeVisible();
  await page.keyboard.press("Enter");

  await editor.pressSequentially("primo task");
  await page.keyboard.press("Enter");
  await editor.pressSequentially("secondo task");

  await expect(editor).toContainText("primo task");
  await expect(editor).toContainText("secondo task");

  // Main-thread responsiveness probe: a normalization loop would hang this.
  const probe = await page.evaluate(() => 1 + 1);
  expect(probe).toBe(2);
});

test("toggles a checklist checkbox without freezing", async ({ page }) => {
  test.setTimeout(45_000);
  const editor = await createPageAndFocusEditor(page, "Checklist Toggle");

  await editor.pressSequentially("/check");
  await expect(page.locator(".bn-suggestion-menu")).toBeVisible();
  await page.keyboard.press("Enter");
  await editor.pressSequentially("toggle me");

  const checkbox = editor.locator('input[type="checkbox"]').first();
  await checkbox.click();
  await expect(checkbox).toBeChecked();

  const probe = await page.evaluate(() => 1 + 1);
  expect(probe).toBe(2);
});

test("typing bracket-style checklist text does not freeze", async ({ page }) => {
  test.setTimeout(45_000);
  const editor = await createPageAndFocusEditor(page, "Checklist Brackets");

  await editor.pressSequentially("[ ] comprare latte");
  await page.keyboard.press("Enter");
  await editor.pressSequentially("[x] fatto");

  const probe = await page.evaluate(() => 1 + 1);
  expect(probe).toBe(2);
});
