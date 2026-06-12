import { expect, test, type Page } from "@playwright/test";

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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const storageKey = "opennotion-e2e-pages";
    const resetKey = "opennotion-e2e-reset";

    const loadPages = (): MockPage[] => JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    const savePages = (pages: MockPage[]) => window.localStorage.setItem(storageKey, JSON.stringify(pages));
    const sortPages = (pages: MockPage[]) =>
      [...pages].filter((page) => page.is_deleted === 0).sort((first, second) => {
        if (first.sort_order !== second.sort_order) return first.sort_order - second.sort_order;
        return second.created_at.localeCompare(first.created_at);
      });

    if (window.localStorage.getItem(resetKey) !== "done") {
      window.localStorage.removeItem(storageKey);
      window.localStorage.removeItem("opennotion-current-page-id");
      window.localStorage.setItem(resetKey, "done");
    }

    window.openNotion = {
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        const pages = loadPages();

        if (cmd === "list_pages") return sortPages(pages);
        if (cmd === "list_all_pages") return pages;
        if (cmd === "get_page") return pages.find((page) => page.id === args.id) ?? null;

        if (cmd === "create_page") {
          const parentId = (args.parentId ?? args.parent_id ?? null) as string | null;
          const page: MockPage = {
            id: args.id as string,
            title: (args.title as string) || "Untitled",
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
            sort_order: -1,
            page_kind: "note",
            created_at: args.createdAt as string,
            updated_at: args.createdAt as string,
          };
          savePages([page, ...pages]);
          return page;
        }

        if (cmd === "update_page") {
          const id = args.id as string;
          const updates = args.updates as Partial<MockPage>;
          savePages(pages.map((page) => page.id === id ? { ...page, ...updates, updated_at: args.updatedAt as string } : page));
          return null;
        }

        if (cmd === "search_pages") return [];
        if (cmd === "show_character_palette") return null;
        if (cmd === "list_studio_documents" || cmd === "list_studio_projects" || cmd === "list_all_studio_document_page_links") {
          return [];
        }
        if (cmd === "get_workspace_profile") return { name: "", workspaceName: "Shelf", avatarPath: null };

        throw new Error(`Unhandled e2e command: ${cmd}`);
      },
      open: async () => null,
      save: async () => null,
      fileSrc: (filePath: string) => filePath,
    };
  });
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
