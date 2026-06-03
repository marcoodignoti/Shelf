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

type StoredEditorBlock = {
  type: string;
  content?: Array<{ text?: string }>;
  children?: StoredEditorBlock[];
};

const bodyText = "Persistence smoke body survives reload";
const pageTitle = "Persistence Smoke";
const storageKey = "opennotion-e2e-pages";

async function createPageAndFocusEditor(page: Page, title: string) {
  await page.goto("/");

  await page.getByText("Create first page").click();
  const titleInput = page.locator("textarea[placeholder='Untitled']");
  await expect(titleInput).toBeVisible();

  await titleInput.fill(title);
  await titleInput.press("Enter");

  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeFocused();
  return editor;
}

async function storedEditorBlocks(page: Page, title: string): Promise<StoredEditorBlock[]> {
  return page.evaluate(
    ({ key, title }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const content = pages.find((page) => page.title === title)?.content ?? "[]";
      return JSON.parse(content) as StoredEditorBlock[];
    },
    { key: storageKey, title }
  );
}

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
      open: async () => null,
      save: async () => null,
      fileSrc: (filePath: string) => filePath,
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

test("creates a blank page from the sidebar new page menu", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "New page" }).click();
  await expect(page.getByText("Blank page")).toBeVisible();
  await page.getByText("Blank page").click();

  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();
  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      return pages.some((page) => page.title === "Untitled" && page.is_deleted === 0);
    },
    { key: storageKey }
  );
});

test("flushes pending editor edits when switching pages before the save debounce", async ({ page }) => {
  const editor = await createPageAndFocusEditor(page, "Flush Page A");
  await editor.pressSequentially("Edit made right before navigating");

  // Switch pages immediately — well within the 300ms save debounce — which
  // unmounts the editor. The flush-on-unmount must persist the pending edit;
  // before the fix the queued content was dropped and never reached storage.
  await page.getByRole("button", { name: "New page" }).click();
  await page.getByText("Blank page").click();

  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const pageA = pages.find((page) => page.title === "Flush Page A");
      return (pageA?.search_text ?? "").includes("Edit made right before navigating");
    },
    { key: storageKey }
  );
});

test("keeps sidebar page context menu open while scrolling with the mouse", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 280 });
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Scrollable Menu Smoke");
  const sidebarRow = page.locator("[data-page-id]").filter({ hasText: "Scrollable Menu Smoke" }).first();
  await sidebarRow.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      })
    );
  });

  const menu = page.locator(".on-page-action-popover");
  await expect(menu).toBeVisible();
  await expect.poll(async () => menu.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  await menu.hover();
  await page.mouse.wheel(0, 240);

  await expect(menu).toBeVisible();
  await expect.poll(async () => menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(menu.getByText("Delete")).toBeVisible();
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

test("focuses the empty editor with a visible slash placeholder after title enter", async ({ page }) => {
  await createPageAndFocusEditor(page, "Placeholder Smoke");

  await expect.poll(async () =>
    page.locator(".bn-block-content").first().evaluate((element) => getComputedStyle(element, "::after").content)
  ).toBe("\"Enter text or type '/' for commands\"");
});

test("supports arrow navigation, indentation, and keyboard slash insertion", async ({ page }) => {
  const title = "Editor Keyboard Smoke";
  await createPageAndFocusEditor(page, title);

  await page.keyboard.type("First block");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second block");

  await page.keyboard.press("ArrowUp");
  await expect.poll(async () => page.evaluate(() => window.getSelection()?.anchorNode?.textContent ?? "")).toContain("First block");

  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => page.evaluate(() => window.getSelection()?.anchorNode?.textContent ?? "")).toContain("Second block");

  await page.getByText("Second block", { exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Tab");
  await expect.poll(async () => {
    const blocks = await storedEditorBlocks(page, title);
    return blocks[0]?.children?.[0]?.content?.[0]?.text;
  }).toBe("Second block");

  await page.keyboard.press("Shift+Tab");
  await expect.poll(async () => {
    const blocks = await storedEditorBlocks(page, title);
    return blocks.length;
  }).toBe(2);

  await page.keyboard.press("Enter");
  await page.keyboard.type("/code");
  await expect(page.locator(".bn-suggestion-menu")).toContainText("Code Block");
  await page.keyboard.press("Enter");
  await page.keyboard.type("const value = 1;");

  await expect.poll(async () => {
    const blocks = await storedEditorBlocks(page, title);
    return {
      lastType: blocks.at(-1)?.type,
      lastText: blocks.at(-1)?.content?.[0]?.text,
    };
  }).toEqual({
    lastType: "codeBlock",
    lastText: "const value = 1;",
  });
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

test("preserves ChatGPT-style markdown while normalizing pasted formulas", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("ChatGPT Paste Smoke");
  await page.getByRole("textbox").last().click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      [
        "## Regole rapide",
        "",
        "- Corrente maggiore dove \\(R\\) è minore.",
        "- Equivalente: \\(R_{eq} < R_i\\).",
        "",
        "```text",
        "R = 2 \\cdot 10^{-4}\\ \\Omega",
        "```",
        "",
        "$$",
        "P",
        "=",
        "R_1 i_1^2",
        "+",
        "R_2 i_2^2",
        "$$",
      ].join("\n")
    );
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });

  await expect(page.getByRole("heading", { name: "Regole rapide" })).toBeVisible();
  await expect(page.getByText("Corrente maggiore dove", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Formula: R", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Formula: R_{eq} < R_i", exact: true })).toBeVisible();
  await expect(page.getByText("R = 2 \\cdot 10^{-4}\\ \\Omega", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Formula preview: P = R_1 i_1^2 + R_2 i_2^2")).toBeVisible();
  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const content = pages.find((page) => page.title === "ChatGPT Paste Smoke")?.content ?? "";

      return (
        content.includes('"type":"heading"') &&
        content.includes('"type":"bulletListItem"') &&
        content.includes('"type":"codeBlock"') &&
        content.includes('"type":"formula"') &&
        content.includes('"type":"math"')
      );
    },
    { key: storageKey }
  );
});

test("renders compact ChatGPT physics formulas pasted from display math fences", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Physics Formula Paste Smoke");
  await page.getByRole("textbox").last().click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      [
        "In modulo:",
        "$$",
        "F",
        "=",
        "qvB\\sintheta",
        "=",
        "qv_nB",
        "$$",
        "",
        "quindi:",
        "$$",
        "\\boxed{",
        "v_p T",
        "=",
        "\\frac{2\\pi m v \\cos\\theta}",
        "{qB}",
        "}",
        "$$",
      ].join("\n")
    );
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });

  await expect(page.getByText("In modulo:", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Formula preview: F = qvB\\sintheta = qv_nB")).toBeVisible();
  await expect(
    page.getByLabel("Formula preview: \\boxed{ v_p T = \\frac{2\\pi m v \\cos\\theta} {qB} }")
  ).toBeVisible();
  await expect(page.getByText("$$", { exact: true })).toHaveCount(0);
  await expect.poll(async () =>
    page.locator(".katex").evaluateAll((elements) =>
      elements.some((element) => element.innerHTML.includes("color:#cc0000"))
    )
  ).toBe(false);
});

test("repairs every previously split display math fence group on page load", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(({ key }) => {
    const now = new Date().toISOString();
    const content = JSON.stringify([
      { id: "open-first", type: "paragraph", content: [{ type: "text", text: "$$", styles: {} }], children: [] },
      { id: "force", type: "paragraph", content: [{ type: "text", text: "F", styles: {} }], children: [] },
      { id: "equals-first", type: "paragraph", content: [{ type: "text", text: "=", styles: {} }], children: [] },
      { id: "lorentz", type: "paragraph", content: [{ type: "text", text: "qvB\\sintheta", styles: {} }], children: [] },
      { id: "close-first", type: "paragraph", content: [{ type: "text", text: "$$", styles: {} }], children: [] },
      { id: "between", type: "paragraph", content: [{ type: "text", text: "quindi:", styles: {} }], children: [] },
      { id: "open-second", type: "paragraph", content: [{ type: "text", text: "$$", styles: {} }], children: [] },
      { id: "moment", type: "paragraph", content: [{ type: "text", text: "M", styles: {} }], children: [] },
      { id: "equals-second", type: "paragraph", content: [{ type: "text", text: "=", styles: {} }], children: [] },
      { id: "work", type: "paragraph", content: [{ type: "text", text: "ia b B\\sin\\theta", styles: {} }], children: [] },
      { id: "close-second", type: "paragraph", content: [{ type: "text", text: "$$", styles: {} }], children: [] },
    ]);
    const savedPage: MockPage = {
      id: "split-formulas-page",
      title: "Split Formula Repair Smoke",
      parent_id: null,
      content,
      search_text: "",
      icon: null,
      cover_url: null,
      is_deleted: 0,
      is_favorite: 0,
      is_template: 0,
      is_database: 0,
      database_schema: null,
      properties: null,
      sort_order: 0,
      page_kind: "note",
      created_at: now,
      updated_at: now,
    };

    window.localStorage.setItem(key, JSON.stringify([savedPage]));
    window.localStorage.setItem("opennotion-current-page-id", savedPage.id);
  }, { key: storageKey });
  await page.reload();

  await expect(page.getByLabel("Formula preview: F = qvB\\sintheta")).toBeVisible();
  await expect(page.getByLabel("Formula preview: M = ia b B\\sin\\theta")).toBeVisible();
  await expect(page.getByText("$$", { exact: true })).toHaveCount(0);
  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const content = pages.find((page) => page.title === "Split Formula Repair Smoke")?.content ?? "";
      return (
        !content.includes("$$") &&
        content.match(/"type":"formula"/g)?.length === 2 &&
        content.includes("F = qvB\\\\sintheta") &&
        content.includes("M = ia b B\\\\sin\\\\theta")
      );
    },
    { key: storageKey }
  );
});

test("repairs pre-existing display math fences attached to formula lines", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(({ key }) => {
    const now = new Date().toISOString();
    const content = JSON.stringify([
      { id: "before", type: "paragraph", content: [{ type: "text", text: "si ottiene:", styles: {} }], children: [] },
      { id: "open", type: "paragraph", content: [{ type: "text", text: "$$\n\\boxed{", styles: {} }], children: [] },
      { id: "force", type: "heading", content: [{ type: "text", text: "d\\vec{F}", styles: {} }], children: [] },
      {
        id: "body",
        type: "paragraph",
        content: [{ type: "text", text: "i,d\\vec{s}\\times\\vec{B}\n}\n$$", styles: {} }],
        children: [],
      },
      { id: "between", type: "paragraph", content: [{ type: "text", text: "con:", styles: {} }], children: [] },
      { id: "open-second", type: "paragraph", content: [{ type: "text", text: "$$\n\\boxed{\n\\ddot{\\theta}\n+", styles: {} }], children: [] },
      { id: "omega", type: "formula", props: { formula: "\\omega^2\\theta" }, content: undefined, children: [] },
      { id: "close-second", type: "paragraph", content: [{ type: "text", text: "0\n}\n$$", styles: {} }], children: [] },
    ]);
    const savedPage: MockPage = {
      id: "attached-split-formulas-page",
      title: "Attached Split Formula Repair Smoke",
      parent_id: null,
      content,
      search_text: "",
      icon: null,
      cover_url: null,
      is_deleted: 0,
      is_favorite: 0,
      is_template: 0,
      is_database: 0,
      database_schema: null,
      properties: null,
      sort_order: 0,
      page_kind: "note",
      created_at: now,
      updated_at: now,
    };

    window.localStorage.setItem(key, JSON.stringify([savedPage]));
    window.localStorage.setItem("opennotion-current-page-id", savedPage.id);
  }, { key: storageKey });
  await page.reload();

  await expect(page.getByLabel("Formula preview: \\boxed{ d\\vec{F} i,d\\vec{s}\\times\\vec{B} }")).toBeVisible();
  await expect(page.getByLabel("Formula preview: \\boxed{ \\ddot{\\theta} + \\omega^2\\theta 0 }")).toBeVisible();
  await expect(page.getByText("$$", { exact: true })).toHaveCount(0);
  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const content = pages.find((page) => page.title === "Attached Split Formula Repair Smoke")?.content ?? "";
      return (
        !content.includes("$$") &&
        content.match(/"type":"formula"/g)?.length === 2 &&
        content.includes("\\\\boxed{ d\\\\vec{F} i,d\\\\vec{s}\\\\times\\\\vec{B} }") &&
        content.includes("\\\\boxed{ \\\\ddot{\\\\theta} + \\\\omega^2\\\\theta 0 }")
      );
    },
    { key: storageKey }
  );
});

test("can convert a selected paragraph into a formula block from the block type menu", async ({ page }) => {
  await page.goto("/");

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Formula Menu Smoke");
  await page.getByRole("textbox").last().click();
  await page.keyboard.type("E = mc^2");
  const paragraph = page.getByText("E = mc^2", { exact: true });
  await paragraph.dblclick();

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
