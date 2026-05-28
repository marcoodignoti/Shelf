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

        if (cmd === "show_character_palette") {
          return null;
        }

        throw new Error(`Unhandled e2e command: ${cmd}`);
      },
    };
  });
});

test("create, edit, reload, and search preserves page content", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill(pageTitle);
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

  await expect(page.locator("textarea[placeholder='Untitled']")).toHaveValue(pageTitle);
  await expect(page.getByText(bodyText)).toBeVisible();

  await page.getByRole("button", { name: "Search" }).click();
  await page.getByPlaceholder("Search pages...").fill("survives reload");
  await expect(page.getByText("Searching...")).toBeHidden();
  const commandPalette = page.locator(".on-modal-panel");
  await expect(commandPalette.getByText(pageTitle, { exact: true })).toBeVisible();
  await expect(commandPalette.getByText(bodyText, { exact: true })).toBeVisible();
});

test("keeps custom icon input focused when opening the native picker", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.getByRole("button", { name: "Add icon" }).click();
  const iconInput = page.getByLabel("Custom page icon");
  await expect(iconInput).toBeFocused();

  await page.getByRole("button", { name: "Open native picker" }).click();
  await expect(iconInput).toBeFocused();

  await iconInput.fill("🧪");
  await expect(page.getByRole("button", { name: "Change page icon" })).toHaveText("🧪");
});

test("supports markdown shortcuts in the page editor", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Markdown Smoke");
  await page.getByRole("textbox").last().click();

  await page.keyboard.type("# Markdown heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Bullet item");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("1. Numbered item");

  await expect(page.getByRole("heading", { name: "Markdown heading" })).toBeVisible();
  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const content = pages.find((page) => page.title === "Markdown Smoke")?.content ?? "";

      return (
        content.includes('"type":"heading"') &&
        content.includes('"type":"bulletListItem"') &&
        content.includes('"type":"numberedListItem"')
      );
    },
    { key: storageKey }
  );
});

test("shows a hover heading rail and navigates between page sections", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 820 });
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Heading Rail Smoke");
  await page.getByRole("textbox").last().click();
  await page.keyboard.type("# First section");
  await page.keyboard.press("Enter");

  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.type(`Filler paragraph ${index}`);
    await page.keyboard.press("Enter");
  }

  await page.keyboard.type("## Second section");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second section body");

  const rail = page.getByRole("navigation", { name: "Page sections" });
  await expect(rail).toBeVisible();

  const visiblePreviewTexts = async () =>
    page.locator(".on-heading-rail-preview").evaluateAll((elements) =>
      elements
        .filter((element) => Number(getComputedStyle(element).opacity) > 0.9)
        .map((element) => element.textContent?.trim())
        .filter(Boolean)
    );

  const firstSectionButton = page.getByRole("button", { name: "Go to First section" });
  await firstSectionButton.hover();
  await expect.poll(visiblePreviewTexts).toEqual(["First section"]);

  const secondSectionButton = page.getByRole("button", { name: "Go to Second section" });
  await expect(secondSectionButton).toBeVisible();
  await secondSectionButton.hover();
  await expect.poll(visiblePreviewTexts).toEqual(["Second section"]);
  await secondSectionButton.locator(".on-heading-rail-preview").click();

  await expect(secondSectionButton).toHaveAttribute("aria-current", "true");
  await expect.poll(async () =>
    page.locator(".on-scroll-fade.w-full").first().evaluate((element) => element.scrollTop)
  ).toBeGreaterThan(0);
});

test("supports multiline page titles with alt enter and enter moves to body", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  const titleInput = page.locator("textarea[placeholder='Untitled']");
  await expect(titleInput).toBeVisible();

  await titleInput.fill("First title line");
  await titleInput.press("Alt+Enter");
  await page.keyboard.type("Second title line");
  await expect(titleInput).toHaveValue("First title line\nSecond title line");

  await titleInput.press("Enter");
  await expect(page.getByRole("textbox").last()).toBeFocused();
  await page.keyboard.type("Body starts here");
  await expect(page.getByText("Body starts here")).toBeVisible();
  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const savedPage = pages.find((page) => page.title === "First title line\nSecond title line");
      return (savedPage?.search_text ?? "").includes("Body starts here");
    },
    { key: storageKey }
  );
});

test("selects all editor blocks with command a", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Select All Smoke");
  await page.getByRole("textbox").last().click();
  await page.keyboard.type("First block");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second block");

  await page.keyboard.press("Meta+A");
  await page.getByRole("button", { name: "Align text center" }).click();

  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const content = pages.find((page) => page.title === "Select All Smoke")?.content ?? "";
      const centeredBlocks = content.match(/"textAlignment":"center"/g) ?? [];

      return centeredBlocks.length >= 2;
    },
    { key: storageKey }
  );
});

test("renders inline math typed with dollar delimiters", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Math Smoke");
  await page.getByRole("textbox").last().click();
  await page.keyboard.type("Maxwell $\\nabla \\cdot \\vec{E}$ equation");

  await expect(page.getByLabel("Inline formula input")).toBeHidden();
  await expect(page.getByLabel("Formula: \\nabla \\cdot \\vec{E}")).toBeVisible();
  await page.getByLabel("Formula: \\nabla \\cdot \\vec{E}").click();
  await expect(page.getByLabel("Inline formula input")).toHaveValue("\\nabla \\cdot \\vec{E}");
  await page.getByLabel("Inline formula input").fill("\\nabla \\cdot \\vec{B}");
  await page.getByLabel("Inline formula input").press("Escape");
  await expect(page.getByLabel("Formula: \\nabla \\cdot \\vec{B}")).toBeVisible();
  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      return pages.some((page) => (page.content ?? "").includes('"type":"math"') && (page.search_text ?? "").includes("\\vec{B}"));
    },
    { key: storageKey }
  );

  await page.reload();

  await expect(page.locator("textarea[placeholder='Untitled']")).toHaveValue("Math Smoke");
  await expect(page.getByLabel("Formula: \\nabla \\cdot \\vec{B}")).toBeVisible();
});

test("centers a block that contains inline math from the formatting toolbar", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Inline Math Alignment");
  await page.getByRole("textbox").last().click();
  await page.keyboard.type("Maxwell $\\nabla \\cdot \\vec{E}$ equation");
  await expect(page.getByLabel("Formula: \\nabla \\cdot \\vec{E}")).toBeVisible();

  await page.keyboard.press("Meta+A");
  await page.getByRole("button", { name: "Align text center" }).click();

  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      return pages.some((page) => (page.content ?? "").includes('"textAlignment":"center"'));
    },
    { key: storageKey }
  );
});

test("turns bracketed latex lines into editable formula blocks", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Formula Block Smoke");
  await page.getByRole("textbox").last().click();
  await page.keyboard.type("[\\oint{Sigma} \\vec{E}\\cdot d\\vec{S}=\\frac{Q\\text{int}}{\\varepsilon_0}]");

  await expect(page.getByLabel("Formula input")).toBeHidden();
  await page.getByLabel("Formula preview: \\oint{Sigma} \\vec{E}\\cdot d\\vec{S}=\\frac{Q\\text{int}}{\\varepsilon_0}").click();
  await expect(page.getByLabel("Formula input")).toHaveValue(
    "\\oint{Sigma} \\vec{E}\\cdot d\\vec{S}=\\frac{Q\\text{int}}{\\varepsilon_0}"
  );
  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      return pages.some((page) => (page.content ?? "").includes('"type":"formula"') && (page.search_text ?? "").includes("\\oint"));
    },
    { key: storageKey }
  );
});

test("turns pasted display math fences into one formula block", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Display Math Paste Smoke");
  await page.getByRole("textbox").last().click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      "$$\n\\vec{F}\nq_2\n\\left(\n\\frac{1}{4\\pi\\varepsilon_0}\n\\frac{q_1}{r^2}\n\\hat{r}\n\\right)\n$$"
    );
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });

  const formula = "\\vec{F} q_2 \\left( \\frac{1}{4\\pi\\varepsilon_0} \\frac{q_1}{r^2} \\hat{r} \\right)";
  await expect(page.getByLabel(`Formula preview: ${formula}`)).toBeVisible();
  await page.waitForFunction(
    ({ key, formula }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const savedPage = pages.find((page) => page.title === "Display Math Paste Smoke");
      return (savedPage?.content ?? "").includes('"type":"formula"') && (savedPage?.search_text ?? "").includes(formula);
    },
    { key: storageKey, formula }
  );
});

test("turns one-line display math paste into a formula block", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("One Line Display Math Smoke");
  await page.getByRole("textbox").last().click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "$$q = \\pm Ne$$");
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });

  await expect(page.getByLabel("Formula preview: q = \\pm Ne")).toBeVisible();
});

test("can convert a selected paragraph into a formula block from the block type menu", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Formula Menu Smoke");
  await page.getByRole("textbox").last().click();
  await page.keyboard.type("E = mc^2");
  await page.keyboard.press("Meta+A");

  await page.getByRole("button", { name: "Paragraph" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");

  await expect(page.getByLabel("Formula input")).toBeHidden();
  await page.getByLabel("Formula preview: E = mc^2").click();
  await expect(page.getByLabel("Formula input")).toHaveValue("E = mc^2");
});

test("keeps scroll position when converting a block into a formula", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Formula Scroll Smoke");
  await page.getByRole("textbox").last().click();
  for (let index = 0; index < 24; index += 1) {
    await page.keyboard.type(`Filler ${index}`);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("E = mc^2");

  const scrollArea = page.locator(".on-scroll-fade").first();
  await scrollArea.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const beforeScrollTop = await scrollArea.evaluate((element) => element.scrollTop);

  await page.keyboard.press("Meta+A");
  await page.getByRole("button", { name: "Paragraph" }).click();
  await page.getByText("Formula", { exact: true }).click();

  await expect(page.getByLabel("Formula preview: E = mc^2")).toBeVisible();
  const afterScrollTop = await scrollArea.evaluate((element) => element.scrollTop);
  expect(Math.abs(afterScrollTop - beforeScrollTop)).toBeLessThan(8);
});

test("keeps scroll position when converting a block into another text block type", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Block Type Scroll Smoke");
  await page.getByRole("textbox").last().click();
  for (let index = 0; index < 24; index += 1) {
    await page.keyboard.type(`Filler ${index}`);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("Transform me");

  const scrollArea = page.locator(".on-scroll-fade").first();
  await scrollArea.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const beforeScrollTop = await scrollArea.evaluate((element) => element.scrollTop);

  await page.keyboard.press("Meta+A");
  await page.getByRole("button", { name: "Paragraph" }).click();
  await page.getByText("Heading 2", { exact: true }).click();

  await expect(page.getByRole("heading", { name: "Transform me" })).toBeVisible();
  const afterScrollTop = await scrollArea.evaluate((element) => element.scrollTop);
  expect(Math.abs(afterScrollTop - beforeScrollTop)).toBeLessThan(8);
});
