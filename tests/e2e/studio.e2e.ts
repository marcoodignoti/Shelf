import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const documentsKey = "opennotion-e2e-studio-documents";
    const pagesKey = "opennotion-e2e-pages";
    const load = <T,>(key: string): T[] => JSON.parse(window.localStorage.getItem(key) ?? "[]");
    const save = <T,>(key: string, value: T[]) => window.localStorage.setItem(key, JSON.stringify(value));
    let callbackCounter = 0;

    window.localStorage.removeItem(documentsKey);
    window.localStorage.removeItem(pagesKey);
    window.localStorage.removeItem("opennotion-current-page-id");
    window.localStorage.removeItem("opennotion-current-studio-document-id");
    window.localStorage.removeItem("opennotion-workspace-mode");

    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => {
        callbackCounter += 1;
        return callbackCounter;
      },
      unregisterCallback: () => undefined,
      convertFileSrc: (filePath: string) => filePath,
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "list_pages") return load(pagesKey).filter((item: any) => item.page_kind === "note");
        if (cmd === "list_studio_documents") return load(documentsKey);
        if (cmd === "plugin:dialog|open") return "/tmp/civil-law.pdf";
        if (cmd === "import_studio_document") {
          const document = {
            id: args.documentId as string,
            title: "civil-law",
            original_filename: "civil-law.pdf",
            stored_file_path: "/tmp/civil-law.pdf",
            note_page_id: args.notePageId as string,
            last_opened_at: args.importedAt as string,
            viewer_zoom: 100,
            viewer_page: 1,
            panel_layout: "pdf-left",
            created_at: args.importedAt as string,
            updated_at: args.importedAt as string,
          };
          const note = {
            id: args.notePageId as string,
            title: "civil-law Notes",
            parent_id: null,
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
            sort_order: 0,
            page_kind: "studio_note",
            created_at: args.importedAt as string,
            updated_at: args.importedAt as string,
          };
          save(documentsKey, [document]);
          save(pagesKey, [note]);
          return document;
        }
        if (cmd === "get_page") {
          return load<any>(pagesKey).find((item) => item.id === args.id) ?? null;
        }
        if (cmd === "update_studio_document_viewer_state") {
          const documents = load<any>(documentsKey);
          save(documentsKey, documents.map((document) => document.id === args.id ? { ...document, ...(args.updates as object) } : document));
          return null;
        }
        if (cmd === "update_page") return null;
        if (cmd === "search_pages") return [];
        throw new Error(`Unhandled e2e command: ${cmd}`);
      },
    };
  });
});

test("imports PDF and opens Studio split view", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Studio" }).click();
  await page.getByRole("button", { name: "Import PDF" }).click();

  await expect(page.getByText("civil-law").first()).toBeVisible();
  await expect(page.locator("iframe[title='civil-law']")).toBeVisible();
  await expect(page.locator("input[placeholder='Untitled']")).toHaveValue("civil-law Notes");

  await page.getByTitle("Swap panels").click();
  await expect(page.getByText("100%")).toBeVisible();
});

test("keeps Studio top bar clear of the sidebar toggle when sidebar is closed", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Studio" }).click();
  await page.getByRole("button", { name: "Import PDF" }).click();

  await page.getByTitle("Toggle sidebar").click();

  const toggleBox = await page.getByTitle("Toggle sidebar").boundingBox();
  const filenameBox = await page.getByText("civil-law.pdf").boundingBox();

  expect(toggleBox).not.toBeNull();
  expect(filenameBox).not.toBeNull();
  expect(filenameBox!.x).toBeGreaterThan(toggleBox!.x + toggleBox!.width + 16);
});

test("stacks Studio panels when resized below usable split width", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 720 });
  await page.goto("/");
  await page.getByRole("button", { name: "Studio" }).click();
  await page.getByRole("button", { name: "Import PDF" }).click();

  const pdfBox = await page.locator("iframe[title='civil-law']").boundingBox();
  const noteTitleBox = await page.locator("input[placeholder='Untitled']").boundingBox();

  expect(pdfBox).not.toBeNull();
  expect(noteTitleBox).not.toBeNull();
  expect(noteTitleBox!.y).toBeGreaterThan(pdfBox!.y + pdfBox!.height);
});

test("keeps Studio panels side by side at ordinary desktop widths", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Studio" }).click();
  await page.getByRole("button", { name: "Import PDF" }).click();

  const pdfBox = await page.locator("iframe[title='civil-law']").boundingBox();
  const noteTitleBox = await page.locator("input[placeholder='Untitled']").boundingBox();

  expect(pdfBox).not.toBeNull();
  expect(noteTitleBox).not.toBeNull();
  expect(Math.abs(noteTitleBox!.y - pdfBox!.y)).toBeLessThan(120);
  expect(noteTitleBox!.x).toBeGreaterThan(pdfBox!.x + pdfBox!.width);
});
