import { expect, test } from "@playwright/test";
import { installMockBridge, type MockPage } from "./helpers/mockBridge";

const storageKey = "opennotion-e2e-subpage-order-pages";

const makePage = (id: string, title: string, parentId: string | null, sortOrder: number): MockPage => ({
  id,
  title,
  parent_id: parentId,
  content: null,
  search_text: null,
  icon: null,
  cover_url: null,
  is_deleted: 0,
  is_favorite: 0,
  is_template: 0,
  is_database: 0,
  database_schema: null,
  properties: null,
  sort_order: sortOrder,
  page_kind: "note",
  created_at: `2026-05-29T09:00:0${sortOrder}.000Z`,
  updated_at: `2026-05-29T09:00:0${sortOrder}.000Z`,
});

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, {
    storageKey,
    initialPages: [
      makePage("parent", "Parent", null, 0),
      makePage("alpha", "Alpha", "parent", 0),
      makePage("beta", "Beta", "parent", 1),
      makePage("gamma", "Gamma", "parent", 2),
    ],
  });

  await page.addInitScript(() => {
    window.localStorage.setItem("opennotion-current-page-id", "parent");
  });
});

test("reorders subpages from the page subpage list", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.locator("textarea[placeholder='Untitled']")).toHaveValue("Parent");
  await expect(page.getByText("Subpages")).toBeVisible();

  const gammaHandle = page.locator("[data-subpage-row-id='gamma'] [data-subpage-drag-handle]");
  const alphaRow = page.locator("[data-subpage-row-id='alpha']");
  const handleBox = await gammaHandle.boundingBox();
  const alphaBox = await alphaRow.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(alphaBox).not.toBeNull();

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(alphaBox!.x + 8, alphaBox!.y + 2, { steps: 8 });
  await page.mouse.up();

  await page.waitForFunction((key) => {
    const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
    const children = pages
      .filter((page) => page.parent_id === "parent")
      .sort((first, second) => first.sort_order - second.sort_order)
      .map((page) => page.id);
    return children.join(",") === "gamma,alpha,beta";
  }, storageKey);

  await expect(page.locator("[data-subpage-row-id]").nth(0)).toContainText("Gamma");
  await expect(page.locator("[data-subpage-row-id]").nth(1)).toContainText("Alpha");
  await expect(page.locator("[data-subpage-row-id]").nth(2)).toContainText("Beta");
});
