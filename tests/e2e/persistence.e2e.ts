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
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "New page" }).click();
  await page.getByText("Blank page").click();
  const titleInput = page.locator("textarea[placeholder='Untitled']");
  await expect(titleInput).toBeVisible({ timeout: 60_000 });

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

async function seedPage(page: Page, title: string, content: unknown[]) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ key, title, content }) => {
      const now = new Date().toISOString();
      const seededPage: MockPage = {
        id: "seeded-page",
        title,
        parent_id: null,
        content: JSON.stringify(content),
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
      window.localStorage.setItem(key, JSON.stringify([seededPage]));
      window.localStorage.setItem("opennotion-current-page-id", seededPage.id);
    },
    { key: storageKey, title, content }
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("textarea[placeholder='Untitled']")).toHaveValue(title);
}

function editorScrollContainer(page: Page) {
  return page.locator(".on-scroll-fade").filter({ has: page.locator(".on-page-editor-blocks") }).first();
}

async function selectedEditorBlockText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement ?? null;
    const blockContent = anchorElement?.closest(".bn-block-content");
    return blockContent?.textContent ?? "";
  });
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

        if (cmd === "import_editor_image") {
          if (args.fileName === "too-large.png") throw new Error("image must be 10 MB or smaller");
          return `/mock/editor-images/${String(args.fileName ?? "image.png")}`;
        }

        if (cmd === "import_editor_video") {
          if (args.fileName === "too-large.mp4") throw new Error("video must be 512 MB or smaller");
          return `/mock/editor-videos/${String(args.fileName ?? "video.mp4")}`;
        }

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

test("disables browser spellcheck inside the editor", async ({ page }) => {
  const editor = await createPageAndFocusEditor(page, "Spellcheck Smoke");

  await expect(editor).toHaveAttribute("spellcheck", "false");
  await expect(editor).toHaveAttribute("autocorrect", "off");
});

test("keeps editor body text readable in dark mode", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("opennotion-theme", "dark");
  });
  await seedPage(page, "Dark Readability Smoke", [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Readable dark editor body text", styles: {} }],
      children: [],
    },
  ]);

  const styles = await page.locator(".bn-block-content").first().evaluate((element) => {
    const parseRgb = (color: string) => {
      const match = color.match(/\d+(\.\d+)?/g)?.map(Number);
      if (!match || match.length < 3) return null;
      return match.slice(0, 3);
    };
    const luminance = ([red, green, blue]: number[]) => {
      const channels = [red, green, blue].map((value) => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };

    const textColor = getComputedStyle(element).color;
    const backgroundColor = getComputedStyle(document.body).backgroundColor;
    const textRgb = parseRgb(textColor);
    const backgroundRgb = parseRgb(backgroundColor);
    const textLuminance = textRgb ? luminance(textRgb) : 0;
    const backgroundLuminance = backgroundRgb ? luminance(backgroundRgb) : 0;
    const lighter = Math.max(textLuminance, backgroundLuminance);
    const darker = Math.min(textLuminance, backgroundLuminance);

    return {
      blockNoteScheme: element.closest(".bn-root")?.getAttribute("data-color-scheme"),
      textColor,
      backgroundColor,
      contrast: (lighter + 0.05) / (darker + 0.05),
    };
  });

  expect(styles.blockNoteScheme).toBe("dark");
  expect(styles.contrast).toBeGreaterThan(7);
});

test("create, edit, reload, and search preserves page content", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "New page" }).click();
  await page.getByText("Blank page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible({ timeout: 60_000 });

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

  await page.reload({ waitUntil: "domcontentloaded" });

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
  await page.goto("/", { waitUntil: "domcontentloaded" });

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
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
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

test("keeps custom icon input focused and selected when opening the native picker", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.getByRole("button", { name: "Add icon" }).click();
  const iconInput = page.getByLabel("Custom page icon");
  await expect(iconInput).toBeFocused();

  await page.getByText("📄").click();
  await expect(page.getByRole("button", { name: "Change page icon" })).toHaveText("📄");
  await page.getByRole("button", { name: "Change page icon" }).click();
  await expect(iconInput).toBeFocused();

  await page.getByRole("button", { name: "Open native picker" }).click();
  await expect(iconInput).toBeFocused();
  await expect.poll(async () => iconInput.evaluate((input) => `${input.selectionStart}:${input.selectionEnd}`)).toBe("0:2");

  await page.keyboard.insertText("🧪");
  await expect(page.getByRole("button", { name: "Change page icon" })).toHaveText("🧪");
});

test("supports markdown shortcuts in the page editor", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
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

test("imports dropped image and video files into the editor", async ({ page }) => {
  const title = "Media Drop Smoke";
  await createPageAndFocusEditor(page, title);
  const dropTarget = page.locator(".on-page-editor-blocks");

  await dropTarget.evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["image"], "drop.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
  });
  await expect(dropTarget).toHaveAttribute("data-editor-media-drop", "active");

  await dropTarget.evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["image"], "drop.png", { type: "image/png" }));
    dataTransfer.items.add(new File(["video"], "drop.mp4", { type: "video/mp4" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  });

  await expect.poll(async () => storedEditorBlocks(page, title)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "image" }),
      expect.objectContaining({ type: "video" }),
    ])
  );
});

test("keeps note scrolling stable with hover heading rail and hidden native scrollbar", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 820 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
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

  const scrollArea = editorScrollContainer(page);
  await expect.poll(async () =>
    scrollArea.evaluate((element) => getComputedStyle(element).scrollbarWidth)
  ).toBe("none");
  await expect.poll(async () =>
    scrollArea.evaluate((element) => getComputedStyle(element).scrollbarGutter)
  ).toBe("auto");
  await expect.poll(async () =>
    page.locator("main").evaluate((element) => getComputedStyle(element).overflowY)
  ).toBe("hidden");

  await expect.poll(async () => scrollArea.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(
    await scrollArea.evaluate((element) => element.clientWidth)
  );

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

  const contentBoxBefore = await page.locator(".max-w-3xl").first().boundingBox();
  expect(contentBoxBefore).not.toBeNull();

  const secondSectionButton = page.getByRole("button", { name: "Go to Second section" });
  await expect(secondSectionButton).toBeVisible();
  await secondSectionButton.hover();
  await expect.poll(visiblePreviewTexts).toEqual(["Second section"]);
  await secondSectionButton.locator(".on-heading-rail-preview").click();

  // The scroll spy keeps the first section active until the smooth scroll
  // reaches the target, which can take several seconds on throttled CI CPUs.
  await expect(secondSectionButton).toHaveAttribute("aria-current", "true", { timeout: 15_000 });
  await expect.poll(async () => scrollArea.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const contentBoxAfter = await page.locator(".max-w-3xl").first().boundingBox();
  expect(contentBoxAfter).not.toBeNull();
  if (!contentBoxBefore || !contentBoxAfter) return;

  expect(Math.abs(contentBoxAfter.x - contentBoxBefore.x)).toBeLessThan(1);
});

test("supports multiline page titles with alt enter and enter moves to body", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
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
  await expect.poll(async () => selectedEditorBlockText(page)).toContain("First block");

  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => selectedEditorBlockText(page)).toContain("Second block");

  await page.locator(".bn-block-content").filter({ hasText: "Second block" }).click();
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

test("keeps slash command menu compact and visible near the bottom of the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 920, height: 360 });
  await createPageAndFocusEditor(page, "Slash Menu Viewport Smoke");

  for (let index = 0; index < 34; index += 1) {
    await page.keyboard.type(`Slash viewport line ${index}`);
    await page.keyboard.press("Enter");
  }

  const scrollArea = editorScrollContainer(page);
  await scrollArea.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.keyboard.type("/");

  const menu = page.locator(".bn-suggestion-menu");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("Code Block");

  const menuBox = await menu.boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!menuBox || !viewport) return;

  expect(menuBox.width).toBeLessThanOrEqual(290);
  expect(menuBox.height).toBeLessThanOrEqual(290);
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height + 1);
});

test("keeps page wheel locked while the slash command menu scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 920, height: 360 });
  await createPageAndFocusEditor(page, "Slash Menu Wheel Smoke");

  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.type(`Wheel lock line ${index}`);
    await page.keyboard.press("Enter");
  }

  const scrollArea = editorScrollContainer(page);
  await scrollArea.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.getByText("Wheel lock line 0", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.type("/");

  const menu = page.locator(".bn-suggestion-menu");
  await expect(menu).toBeVisible();
  await page.waitForTimeout(100);

  const scrollAreaBox = await scrollArea.boundingBox();
  expect(scrollAreaBox).not.toBeNull();
  if (!scrollAreaBox) return;

  const pageScrollBefore = await scrollArea.evaluate((element) => element.scrollTop);
  await page.mouse.move(scrollAreaBox.x + scrollAreaBox.width - 24, scrollAreaBox.y + scrollAreaBox.height - 24);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(50);
  await expect.poll(async () => scrollArea.evaluate((element) => element.scrollTop)).toBe(pageScrollBefore);

  const menuScrollBefore = await menu.evaluate((element) => element.scrollTop);
  await menu.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(async () => menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(menuScrollBefore);
});

test("navigates slash command menu with arrows and enter", async ({ page }) => {
  await createPageAndFocusEditor(page, "Slash Menu Keyboard Smoke");

  await page.keyboard.type("/heading");
  const menu = page.locator(".bn-suggestion-menu");
  const selectedMenuItem = page.locator('.bn-suggestion-menu-item[aria-selected="true"]');
  await expect(menu).toContainText("Heading 2");
  await expect(selectedMenuItem).toContainText("Heading 1");

  await page.keyboard.press("ArrowDown");
  await expect(selectedMenuItem).toContainText("Heading 2");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Arrow selected heading");

  await expect(page.getByRole("heading", { name: "Arrow selected heading", level: 2 })).toBeVisible();
});

test("inserts inline page links with hover preview and custom label", async ({ page }) => {
  await createPageAndFocusEditor(page, "Target Page");
  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      return pages.some((page) => page.title === "Target Page");
    },
    { key: storageKey }
  );
  const sourceEditor = await createPageAndFocusEditor(page, "Source Page");

  await sourceEditor.click();
  await page.keyboard.type("@Target");
  const menu = page.locator(".bn-suggestion-menu");
  await expect(menu).toContainText("Target Page");
  await menu.getByText("Target Page", { exact: true }).click();

  const pageLink = page.getByLabel("Page link: Target Page");
  await expect(pageLink).toBeVisible();
  await pageLink.hover();
  await expect(page.getByTitle("Change link icon")).toBeVisible();
  await page.getByLabel("Page link label").fill("Target Alias");
  await expect(page.getByLabel("Page link: Target Alias")).toBeVisible();
  await page.getByRole("button", { name: "Native picker" }).click();
  const linkIconInput = page.getByLabel("Page link icon");
  await expect(linkIconInput).toBeFocused();

  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const source = pages.find((page) => page.title === "Source Page");
      return (source?.content ?? "").includes('"type":"pageLink"') &&
        (source?.search_text ?? "").includes("Target Alias");
    },
    { key: storageKey }
  );

  await page.keyboard.insertText("🧭");
  await expect(page.getByLabel("Page link: Target Alias")).toContainText("🧭");
  await page.getByLabel("Page link: Target Alias").click();
  await expect(page.locator(".on-page-link-popover-panel")).toBeHidden();
  await expect(page.locator("textarea[placeholder='Untitled']")).toHaveValue("Target Page");
});

test("refreshes inline page link previews when linked page metadata changes", async ({ page }) => {
  await createPageAndFocusEditor(page, "Target Page");
  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      return pages.some((page) => page.title === "Target Page");
    },
    { key: storageKey }
  );
  const sourceEditor = await createPageAndFocusEditor(page, "Source Page");

  await sourceEditor.click();
  await page.keyboard.type("@Target");
  await expect(page.locator(".bn-suggestion-menu")).toContainText("Target Page");
  await page.locator(".bn-suggestion-menu").getByText("Target Page", { exact: true }).click();

  await page.getByLabel("Page link: Target Page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toHaveValue("Target Page");

  await page.getByRole("button", { name: "Add icon" }).click();
  await page.getByText("🧠").click();
  await expect(page.getByRole("button", { name: "Change page icon" })).toHaveText("🧠");

  await page.locator("[data-page-id]").filter({ hasText: "Source Page" }).first().click();
  const refreshedLink = page.getByLabel("Page link: Target Page");
  await expect(refreshedLink).toContainText("🧠");
  await refreshedLink.hover();
  await expect(page.locator(".on-page-link-preview-icon")).toContainText("🧠");
});

test("selects all editor blocks with command a", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
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
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
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

  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.locator("textarea[placeholder='Untitled']")).toHaveValue("Math Smoke");
  await expect(page.getByLabel("Formula: \\nabla \\cdot \\vec{B}")).toBeVisible();
});

test("shows a clear media import error notice", async ({ page }) => {
  const editor = await createPageAndFocusEditor(page, "Media Error Notice Smoke");

  await editor.evaluate((element) => {
    const data = new DataTransfer();
    data.items.add(new File(["oversized"], "too-large.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });

  await expect(page.locator(".on-notice").filter({ hasText: "Image must be 10 MB or smaller." })).toBeVisible();
});

test("centers a block that contains inline math from the formatting toolbar", async ({ page }) => {
  await createPageAndFocusEditor(page, "Inline Math Alignment");
  await page.keyboard.type("Maxwell $\\nabla \\cdot \\vec{E}$ equation");
  await expect(page.getByLabel("Formula: \\nabla \\cdot \\vec{E}")).toBeVisible();

  const paragraph = page.locator(".bn-inline-content", { hasText: "Maxwell" }).first();
  const box = await paragraph.boundingBox();
  if (!box) throw new Error("paragraph not visible");
  await page.mouse.click(box.x + 2, box.y + box.height / 2);
  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  await page.keyboard.up("Shift");

  const centerButton = page.getByRole("button", { name: "Align text center" });
  await expect(centerButton).toBeVisible();
  await centerButton.click();

  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      return pages.some((page) => (page.content ?? "").includes('"textAlignment":"center"'));
    },
    { key: storageKey }
  );
});

test("turns bracketed latex lines into editable formula blocks", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
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
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
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
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
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

test("collapses pasted repeated equals inside formula blocks", async ({ page }) => {
  const title = "Formula Equals Paste Smoke";
  await createPageAndFocusEditor(page, title);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      [
        "Formula:",
        "[",
        "\\nabla \\times \\vec B ==================== \\mu_0\\vec j + \\mu_0\\varepsilon_0 \\frac{\\partial \\vec E}{\\partial t}",
        "]",
      ].join("\n")
    );
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });

  await expect(
    page.getByLabel(
      "Formula preview: \\nabla \\times \\vec B = \\mu_0\\vec j + \\mu_0\\varepsilon_0 \\frac{\\partial \\vec E}{\\partial t}"
    )
  ).toBeVisible();
  await page.waitForFunction(
    ({ key, title }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const content = pages.find((page) => page.title === title)?.content ?? "";
      return content.includes("\\\\nabla \\\\times \\\\vec B = \\\\mu_0\\\\vec j") && !content.includes("====");
    },
    { key: storageKey, title }
  );
});

test("turns pasted markdown tables and dividers into structured blocks", async ({ page }) => {
  const title = "Table Divider Paste Smoke";
  await createPageAndFocusEditor(page, title);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      [
        "| Sotto-argomento | Dove compare |",
        "| --- | --- |",
        "| Campo magnetico di solenoide indefinito | 07/11/2023, 27/06/2023, 13/06/2023 |",
        "| Campo magnetico di solenoide toroidale | 07/02/2024 |",
        "",
        "---",
        "",
        "Formule da dominare:",
      ].join("\n")
    );
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });

  await expect(page.getByText("Sotto-argomento", { exact: true })).toBeVisible();
  await expect(page.getByText("Campo magnetico di solenoide toroidale", { exact: true })).toBeVisible();
  await expect(page.getByText("Formule da dominare:", { exact: true })).toBeVisible();
  await page.waitForFunction(
    ({ key, title }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const content = pages.find((page) => page.title === title)?.content ?? "[]";

      return (
        content.includes('"type":"table"') &&
        content.includes('"type":"divider"') &&
        content.includes("Sotto-argomento") &&
        content.includes("Dove compare")
      );
    },
    { key: storageKey, title }
  );
});

test("preserves rich markdown formatting from LLM-style paste", async ({ page }) => {
  const title = "Rich LLM Paste Smoke";
  await createPageAndFocusEditor(page, title);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      [
        "## Risposta rapida",
        "",
        "- **Grassetto**, *corsivo*, `codice` e [fonte](https://example.com).",
        "",
        "> Nota importante da mantenere come citazione.",
        "",
        "$$",
        "F",
        "/",
        "L",
        "=",
        "\\frac{\\mu_0 i_1 i_2}{2\\pi d}",
        "$$",
      ].join("\n")
    );
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });

  await expect(page.getByRole("heading", { name: "Risposta rapida" })).toBeVisible();
  await expect(page.getByText("Nota importante da mantenere come citazione.")).toBeVisible();
  await expect(page.locator(".on-formula-block")).toBeVisible();
  await page.waitForFunction(
    ({ key, title }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const content = pages.find((page) => page.title === title)?.content ?? "";

      return (
        content.includes('"type":"heading"') &&
        content.includes('"type":"bulletListItem"') &&
        content.includes('"type":"quote"') &&
        content.includes('"type":"link"') &&
        content.includes('"bold":true') &&
        content.includes('"italic":true') &&
        content.includes('"code":true') &&
        content.includes('"type":"formula"') &&
        content.includes("\\\\frac{\\\\mu_0 i_1 i_2}{2\\\\pi d}")
      );
    },
    { key: storageKey, title }
  );
});

test("preserves bare aligned latex environments from LLM-style paste", async ({ page }) => {
  const title = "Aligned Formula Paste Smoke";
  await createPageAndFocusEditor(page, title);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      [
        "## 7. Equazioni di Maxwell nel vuoto",
        "",
        "Le equazioni sono:",
        "",
        "\\begin{aligned}",
        "\\nabla \\cdot \\vec E &= \\frac{\\rho}{\\varepsilon_0} \\\\",
        "\\nabla \\cdot \\vec B &= 0 \\\\",
        "\\nabla \\times \\vec E &= -\\frac{\\partial \\vec B}{\\partial t} \\\\",
        "\\nabla \\times \\vec B &= \\mu_0\\vec j + \\mu_0\\varepsilon_0 \\frac{\\partial \\vec E}{\\partial t}",
        "\\end{aligned}",
      ].join("\n")
    );
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });

  const formula =
    "\\begin{aligned} \\nabla \\cdot \\vec E &= \\frac{\\rho}{\\varepsilon_0} \\\\ \\nabla \\cdot \\vec B &= 0 \\\\ \\nabla \\times \\vec E &= -\\frac{\\partial \\vec B}{\\partial t} \\\\ \\nabla \\times \\vec B &= \\mu_0\\vec j + \\mu_0\\varepsilon_0 \\frac{\\partial \\vec E}{\\partial t} \\end{aligned}";

  await expect(page.getByRole("heading", { name: "Equazioni di Maxwell nel vuoto" })).toBeVisible();
  await expect(page.getByLabel(`Formula preview: ${formula}`)).toBeVisible();
  await expect(page.getByText("\\begin{aligned}", { exact: true })).toHaveCount(0);
  await page.waitForFunction(
    ({ key, title }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const content = pages.find((page) => page.title === title)?.content ?? "";
      return (
        content.includes('"type":"formula"') &&
        content.includes("\\\\begin{aligned}") &&
        content.includes("\\\\nabla \\\\times \\\\vec B")
      );
    },
    { key: storageKey, title }
  );
});

test("preserves the uploaded LLM study-plan markdown shape", async ({ page }) => {
  const title = "Study Plan Paste Smoke";
  await createPageAndFocusEditor(page, title);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      [
        "## 1. Argomenti complessivi estratti dai compiti",
        "",
        "### A. Elettrostatica con simmetria e legge di Gauss",
        "",
        "Sotto-argomenti:",
        "",
        "| Sotto-argomento | Dove compare |",
        "| --- | --- |",
        "| Grafico qualitativo di (E(r)) e (V(r)) | 25/06/2025, 16/09/2025 |",
        "| Forza su carica di prova | 24/01/2024, 27/06/2023 |",
        "",
        "Qui devi essere forte su:",
        "",
        "[",
        "\\oint \\vec E \\cdot d\\vec S = \\frac{q_{\\text{int}}}{\\varepsilon_0}",
        "]",
        "",
        "---",
        "",
        "### B. Conduttori, condensatori, dielettrici",
      ].join("\n")
    );
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });

  await expect(page.getByRole("heading", { name: "Argomenti complessivi estratti dai compiti" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A. Elettrostatica con simmetria e legge di Gauss" })).toBeVisible();
  await expect(page.getByText("Grafico qualitativo di", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Formula: E(r)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Formula: V(r)", exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Formula preview: \\oint \\vec E \\cdot d\\vec S = \\frac{q_{\\text{int}}}{\\varepsilon_0}")
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "B. Conduttori, condensatori, dielettrici" })).toBeVisible();
  await page.waitForFunction(
    ({ key, title }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const content = pages.find((page) => page.title === title)?.content ?? "";

      return (
        content.includes('"type":"table"') &&
        content.includes('"type":"divider"') &&
        content.includes('"type":"formula"') &&
        content.includes('"type":"math"') &&
        content.includes("Grafico qualitativo")
      );
    },
    { key: storageKey, title }
  );
});

test("preserves ChatGPT-style markdown while normalizing pasted formulas", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
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

test("structures long plain-text lesson paste into editor blocks", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Loading workspace...")).toBeHidden();

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Lesson Paste Smoke");
  await page.getByRole("textbox").last().click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      [
        "Di seguito trovi il riassunto pagina per pagina della lezione ESE_L05_20240313_14_16.pdf.",
        "Pagina 1 — Copertina della V lezione",
        "La prima slide è la copertina della quinta lezione.",
        "Pagina 2 — ATmel: Programming Model, Instruction Set, Addressing Modes",
        "La seconda slide riprende i tre elementi fondamentali dell’interfaccia tra CPU e programmatore.",
        "R → cadute di tensione e dissipazione",
        "Sintesi finale della lezione",
        "Questa quinta lezione chiude il passaggio dal modello logico della CPU al comportamento elettrico reale.",
      ].join("\n")
    );
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });

  await expect(page.getByRole("heading", { name: "Pagina 1 — Copertina della V lezione" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pagina 2 — ATmel: Programming Model, Instruction Set, Addressing Modes" })).toBeVisible();
  await expect(page.getByText("R → cadute di tensione e dissipazione")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sintesi finale della lezione" })).toBeVisible();
  await page.waitForFunction(
    ({ key }) => {
      const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
      const content = pages.find((page) => page.title === "Lesson Paste Smoke")?.content ?? "";
      return (
        content.includes('"type":"heading"') &&
        content.includes('"type":"bulletListItem"') &&
        content.includes("Pagina 2") &&
        content.includes("Sintesi finale")
      );
    },
    { key: storageKey }
  );
});

test("renders compact ChatGPT physics formulas pasted from display math fences", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
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
  await page.goto("/", { waitUntil: "domcontentloaded" });
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
  await page.reload({ waitUntil: "domcontentloaded" });

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
  await page.goto("/", { waitUntil: "domcontentloaded" });
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
  await page.reload({ waitUntil: "domcontentloaded" });

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
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
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
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("New page").click();
  await page.getByText("Blank page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Formula Scroll Smoke");
  await page.getByRole("textbox").last().click();
  for (let index = 0; index < 24; index += 1) {
    await page.keyboard.type(`Filler ${index}`);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("E = mc^2");

  const scrollArea = page.locator(".on-scroll-fade.flex-1.w-full.overflow-y-auto").first();
  await expect(scrollArea).toBeVisible();
  await scrollArea.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const beforeBottomGap = await scrollArea.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);

  await page.getByText("E = mc^2", { exact: true }).dblclick();
  await page.getByRole("button", { name: "Paragraph" }).click();
  await page.getByText("Formula", { exact: true }).click();

  await expect(page.getByLabel("Formula preview: E = mc^2")).toBeVisible();
  await expect.poll(async () => {
    const afterBottomGap = await scrollArea.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
    return Math.abs(afterBottomGap - beforeBottomGap);
  }).toBeLessThan(96);
});

test("keeps scroll position while editing an existing formula block", async ({ page }) => {
  await seedPage(page, "Formula Edit Scroll Smoke", [
    ...Array.from({ length: 18 }, (_, index) => ({
      id: `top-filler-${index}`,
      type: "paragraph",
      content: [{ type: "text", text: `Top filler ${index}`, styles: {} }],
      children: [],
    })),
    {
      id: "formula-middle",
      type: "formula",
      props: { formula: "E = mc^2" },
      children: [],
    },
    ...Array.from({ length: 45 }, (_, index) => ({
      id: `bottom-filler-${index}`,
      type: "paragraph",
      content: [{ type: "text", text: `Bottom filler ${index}`, styles: {} }],
      children: [],
    })),
  ]);

  const scrollArea = page.locator(".on-scroll-fade.flex-1.w-full.overflow-y-auto").first();
  const formulaPreview = page.getByLabel("Formula preview: E = mc^2");
  await formulaPreview.scrollIntoViewIfNeeded();
  await expect(formulaPreview).toBeVisible();

  const beforeScrollTop = await scrollArea.evaluate((element) => element.scrollTop);
  const beforeBottomGap = await scrollArea.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);

  await formulaPreview.click();
  const formulaInput = page.getByLabel("Formula input");
  await expect(formulaInput).toHaveValue("E = mc^2");
  await formulaInput.fill("E = mc^2 + c");

  await expect.poll(async () => {
    const afterScrollTop = await scrollArea.evaluate((element) => element.scrollTop);
    return Math.abs(afterScrollTop - beforeScrollTop);
  }).toBeLessThan(160);
  await expect.poll(async () => scrollArea.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
    .toBeGreaterThan(Math.max(120, beforeBottomGap - 160));
});

test("auto-scrolls while typing at the end of a long page", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 360 });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "New page" }).click();
  await page.getByText("Blank page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Auto Scroll Smoke");
  await page.locator("textarea[placeholder='Untitled']").press("Enter");

  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeFocused();

  const scrollArea = page.locator(".on-scroll-fade.flex-1.w-full.overflow-y-auto").first();
  const initialScrollTop = await scrollArea.evaluate((element) => element.scrollTop);

  for (let index = 0; index < 70; index += 1) {
    await page.keyboard.type(`Auto scroll line ${index}`);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("Auto scroll final line");

  await expect(page.getByText("Auto scroll final line")).toBeVisible();
  await expect.poll(async () => scrollArea.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect.poll(async () => scrollArea.evaluate((element) => element.scrollTop)).toBeGreaterThan(initialScrollTop);
});

test("keeps scroll position when converting a block into another text block type", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "New page" }).click();
  await page.getByText("Blank page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();

  await page.locator("textarea[placeholder='Untitled']").fill("Block Type Scroll Smoke");
  await page.getByRole("textbox").last().click();
  for (let index = 0; index < 24; index += 1) {
    await page.keyboard.type(`Filler ${index}`);
    await page.keyboard.press("Enter");
  }
  await page.keyboard.type("Transform me");

  const scrollArea = page.locator(".on-scroll-fade.flex-1.w-full.overflow-y-auto").first();
  await scrollArea.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const beforeScrollTop = await scrollArea.evaluate((element) => element.scrollTop);

  await page.keyboard.press("Meta+A");
  await page.getByRole("button", { name: "Paragraph" }).click();
  await page.getByText("Heading 2", { exact: true }).click();

  await expect(page.getByRole("heading", { name: "Transform me" })).toBeVisible();
  const afterScrollTop = await scrollArea.evaluate((element) => element.scrollTop);
  expect(Math.abs(afterScrollTop - beforeScrollTop)).toBeLessThan(260);
});

// These two tests share the real OS clipboard, so they must not run in
// parallel with each other.
test.describe("system clipboard", () => {
  test.describe.configure({ mode: "serial" });

  test("copies a text selection containing inline math without crashing", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await createPageAndFocusEditor(page, "Copy Inline Math");
    await page.keyboard.type("alpha $x^2$ beta");
    await expect(page.getByLabel("Formula: x^2")).toBeVisible();

    await page.evaluate(() => navigator.clipboard.writeText("SENTINEL-INLINE"));
    // Select via ProseMirror-handled mouse events (click + Shift+click): a
    // browser-native key selection (Home/Shift+End) can leave the PM state
    // stale, in which case the copy handler skips the event and nothing is
    // written to the clipboard.
    const paragraph = page.locator(".bn-inline-content", { hasText: "alpha" }).first();
    const box = await paragraph.boundingBox();
    if (!box) throw new Error("paragraph not visible");
    await page.mouse.click(box.x + 2, box.y + box.height / 2);
    await page.keyboard.down("Shift");
    await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
    await page.keyboard.up("Shift");
    await page.keyboard.press("ControlOrMeta+c");

    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 })
      .not.toBe("SENTINEL-INLINE");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("alpha");
    expect(copied).toContain("beta");
    expect(pageErrors).toEqual([]);
  });

  test("selects and copies all blocks when the page starts with a formula block", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await seedPage(page, "Copy All With Formula", [
      { id: "formula-first", type: "formula", props: { formula: "E=mc^2" }, content: undefined, children: [] },
      { id: "tail", type: "paragraph", content: "tail text after formula", children: [] },
    ]);
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(page.locator(".on-formula-block").first()).toBeVisible();
    await expect(page.getByText("tail text after formula")).toBeVisible();
    await page.getByText("tail text after formula").click();

    await page.evaluate(() => navigator.clipboard.writeText("SENTINEL-ALL"));
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+c");

    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 })
      .not.toBe("SENTINEL-ALL");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("tail text after formula");
    expect(pageErrors).toEqual([]);
  });
});

test("pasting external HTML with inline math markup restores the formula", async ({ page }) => {
  const editor = await createPageAndFocusEditor(page, "Roundtrip Target");

  // This is the shape MathInlineContent.toExternalHTML emits on copy: the
  // custom parse() must turn it back into an inline math node on paste.
  await editor.evaluate((element) => {
    const data = new DataTransfer();
    data.setData(
      "text/html",
      '<p>alpha <span class="on-inline-math" data-latex="x^2">x2</span> beta</p>'
    );
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });

  await expect(page.getByText("alpha")).toBeVisible();
  await expect(page.getByLabel("Formula: x^2")).toBeVisible();
});
