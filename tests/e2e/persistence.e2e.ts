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
  created_at: string;
  updated_at: string;
};

const bodyText = "Persistence smoke body survives reload";
const pageTitle = "Persistence Smoke";
const storageKey = "opennotion-e2e-pages";

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

    let callbackCounter = 0;

    window.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
      },
      transformCallback: () => {
        callbackCounter += 1;
        return callbackCounter;
      },
      unregisterCallback: () => undefined,
      convertFileSrc: (filePath: string) => filePath,
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        const pages = loadPages();

        if (cmd === "list_pages") {
          return sortPages(pages);
        }

        if (cmd === "list_all_pages") {
          return pages;
        }

        if (cmd === "get_page") {
          return pages.find((page) => page.id === args.id) ?? null;
        }

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

        if (cmd === "search_pages") {
          const query = String(args.query ?? "").trim().toLowerCase();
          if (!query) return [];
          return sortPages(pages)
            .filter((page) => page.title.toLowerCase().includes(query) || (page.search_text ?? "").toLowerCase().includes(query))
            .map((page) => ({
              ...page,
              matched_content: (page.search_text ?? "").toLowerCase().includes(query) ? page.search_text : null,
            }));
        }

        throw new Error(`Unhandled e2e command: ${cmd}`);
      },
    };
  });
});

test("create, edit, reload, and search preserves page content", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("input[placeholder='Untitled']")).toBeVisible();

  await page.locator("input[placeholder='Untitled']").fill(pageTitle);
  await page.getByRole("textbox").last().click();
  await page.keyboard.type(bodyText);
  await page.waitForFunction(
    ({ key, title, body }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      return pages.some((page) => page.title === title && (page.search_text ?? "").includes(body));
    },
    { key: storageKey, title: pageTitle, body: bodyText }
  );

  await page.reload();

  await expect(page.locator("input[placeholder='Untitled']")).toHaveValue(pageTitle);
  await expect(page.getByText(bodyText)).toBeVisible();

  await page.getByRole("button", { name: "Search" }).click();
  await page.getByPlaceholder("Search pages...").fill("survives reload");
  await expect(page.getByText("Searching...")).toBeHidden();
  const commandPalette = page.locator(".on-modal-panel");
  await expect(commandPalette.getByText(pageTitle, { exact: true })).toBeVisible();
  await expect(commandPalette.getByText(bodyText, { exact: true })).toBeVisible();
});
