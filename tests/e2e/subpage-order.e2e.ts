import { expect, test } from "@playwright/test";

type MockPage = {
  id: string;
  title: string;
  parent_id: string | null;
  content: string | null;
  search_text: string | null;
  icon: string | null;
  cover_url: string | null;
  is_deleted: number;
  is_favorite: number;
  is_template: number;
  is_database: number;
  database_schema: string | null;
  properties: string | null;
  sort_order: number;
  page_kind: "note" | "studio_note";
  created_at: string;
  updated_at: string;
};

const storageKey = "opennotion-e2e-subpage-order-pages";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
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
    const loadPages = (): MockPage[] => JSON.parse(window.localStorage.getItem(key) ?? "[]");
    const savePages = (pages: MockPage[]) => window.localStorage.setItem(key, JSON.stringify(pages));
    const sortPages = (pages: MockPage[]) =>
      [...pages].filter((page) => page.is_deleted === 0).sort((first, second) => {
        if (first.sort_order !== second.sort_order) return first.sort_order - second.sort_order;
        return second.created_at.localeCompare(first.created_at);
      });

    savePages([
      makePage("parent", "Parent", null, 0),
      makePage("alpha", "Alpha", "parent", 0),
      makePage("beta", "Beta", "parent", 1),
      makePage("gamma", "Gamma", "parent", 2),
    ]);
    window.localStorage.setItem("opennotion-current-page-id", "parent");

    window.openNotion = {
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        const pages = loadPages();

        if (cmd === "list_pages") return sortPages(pages);
        if (cmd === "list_all_pages") return pages;
        if (cmd === "get_page") return pages.find((page) => page.id === args.id) ?? null;
        if (cmd === "update_page") {
          savePages(pages.map((page) =>
            page.id === args.id ? { ...page, ...(args.updates as Partial<MockPage>), updated_at: args.updatedAt as string } : page
          ));
          return null;
        }
        if (cmd === "reorder_pages") {
          const orderedIds = args.orderedIds as string[];
          const parentId = (args.parentId ?? null) as string | null;
          savePages(pages.map((page) => {
            if (page.parent_id !== parentId) return page;
            const sortOrder = orderedIds.indexOf(page.id);
            return sortOrder === -1 ? page : { ...page, sort_order: sortOrder };
          }));
          return null;
        }
        if (cmd === "show_character_palette") return null;
        if (cmd === "search_pages") return [];
        if (cmd === "get_workspace_profile") return { name: "", workspaceName: "Shelf", avatarPath: null };

        throw new Error(`Unhandled e2e command: ${cmd}`);
      },
      open: async () => null,
      save: async () => null,
      fileSrc: (filePath: string) => filePath,
    };
  }, storageKey);
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
