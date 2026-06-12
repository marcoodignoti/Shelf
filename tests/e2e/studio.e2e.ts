import { expect, test } from "@playwright/test";

const tinyPdfFixture = createBlankPdfFixture(1);
const multiPagePdfFixture = createBlankPdfFixture(8);

function createBlankPdfFixture(pageCount: number): Buffer {
  const safePageCount = Math.max(1, Math.floor(pageCount));
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: safePageCount }, (_, index) => `${index + 3} 0 R`).join(" ")}] /Count ${safePageCount} >>`,
    ...Array.from({ length: safePageCount }, () => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"),
  ];
  const offsets = [0];
  let body = "%PDF-1.4\n";
  for (const [index, object] of objects.entries()) {
    offsets[index + 1] = Buffer.byteLength(body, "utf8");
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}

test.beforeEach(async ({ page }) => {
  await page.route("**/civil-law.pdf*", async (route) => {
    await route.fulfill({
      body: tinyPdfFixture,
      contentType: "application/pdf",
    });
  });

  await page.addInitScript(() => {
    const documentsKey = "opennotion-e2e-studio-documents";
    const linksKey = "opennotion-e2e-studio-page-links";
    const pagesKey = "opennotion-e2e-pages";
    const unlinkedPrimaryLinksKey = "opennotion-e2e-unlinked-primary-links";
    const resetKey = "opennotion-e2e-studio-reset";
    const load = <T,>(key: string): T[] => JSON.parse(window.localStorage.getItem(key) ?? "[]");
    const save = <T,>(key: string, value: T[]) => window.localStorage.setItem(key, JSON.stringify(value));

    if (window.sessionStorage.getItem(resetKey) !== "done") {
      window.localStorage.removeItem(documentsKey);
      window.localStorage.removeItem(linksKey);
      window.localStorage.removeItem(unlinkedPrimaryLinksKey);
      window.localStorage.removeItem(pagesKey);
      window.localStorage.removeItem("opennotion-current-page-id");
      window.sessionStorage.setItem(resetKey, "done");
    }

    window.openNotion = {
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "list_pages") return load(pagesKey).filter((item: any) => item.page_kind === "note" || item.page_kind === "studio_note");
        if (cmd === "list_studio_documents") return load(documentsKey);
        if (cmd === "list_studio_document_page_links") {
          const document = load<any>(documentsKey).find((candidate) => candidate.id === args.documentId);
          if (!document) return [];
          const pages = load<any>(pagesKey);
          const storedLinks = load<any>(linksKey).filter((link) => link.document_id === document.id);
          const unlinkedPrimaryPageIds = new Set(load<string>(unlinkedPrimaryLinksKey));
          const primaryLink = {
            id: `link-${document.id}-${document.note_page_id}`,
            document_id: document.id,
            page_id: document.note_page_id,
            pdf_page: null,
            label: "Primary note",
            sort_order: 0,
            created_at: document.created_at,
            updated_at: document.updated_at,
          };
          return [primaryLink, ...storedLinks]
            .filter((link) => link.page_id !== document.note_page_id || !unlinkedPrimaryPageIds.has(link.page_id))
            .filter((link, index, links) => links.findIndex((candidate) => candidate.page_id === link.page_id) === index)
            .map((link) => ({
              ...link,
              page: pages.find((item) => item.id === link.page_id),
            }))
            .filter((link) => Boolean(link.page));
        }
        if (cmd === "list_all_studio_document_page_links") {
          const documents = load<any>(documentsKey);
          const pages = load<any>(pagesKey);
          const unlinkedPrimaryPageIds = new Set(load<string>(unlinkedPrimaryLinksKey));
          const links = documents.flatMap((document) => {
            const storedLinks = load<any>(linksKey).filter((link) => link.document_id === document.id);
            const primaryLink = {
              id: `link-${document.id}-${document.note_page_id}`,
              document_id: document.id,
              page_id: document.note_page_id,
              pdf_page: null,
              label: "Primary note",
              sort_order: 0,
              created_at: document.created_at,
              updated_at: document.updated_at,
            };
            return [primaryLink, ...storedLinks]
              .filter((link) => link.page_id !== document.note_page_id || !unlinkedPrimaryPageIds.has(link.page_id))
              .filter((link, index, documentLinks) => documentLinks.findIndex((candidate) => candidate.page_id === link.page_id) === index)
              .map((link) => ({
                ...link,
                page: pages.find((item) => item.id === link.page_id),
              }))
              .filter((link) => Boolean(link.page));
          });
          return links;
        }
        if (cmd === "import_studio_document") {
          const documentId = args.documentId as string;
          const notePageId = args.notePageId as string;
          const importedAt = args.importedAt as string;
          const linkedNoteId = `${documentId}-linked-note`;
          const document = {
            id: documentId,
            title: "civil-law",
            original_filename: "civil-law.pdf",
            stored_file_path: "/tmp/civil-law.pdf",
            note_page_id: notePageId,
            project_id: null,
            last_opened_at: importedAt,
            viewer_zoom: 100,
            viewer_page: 1,
            panel_layout: "pdf-left",
            created_at: importedAt,
            updated_at: importedAt,
          };
          const shouldSkipNote = window.localStorage.getItem("opennotion-e2e-missing-studio-note") === "1";
          const documentPage = {
            id: notePageId,
            title: "civil-law",
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
            page_kind: documentId === notePageId ? "note" : "studio_note",
            created_at: importedAt,
            updated_at: importedAt,
          };
          const linkedNote = {
            id: linkedNoteId,
            title: "civil-law Notes",
            parent_id: notePageId,
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
            created_at: importedAt,
            updated_at: importedAt,
          };
          const linkedNoteLink = {
            id: `link-${documentId}-${linkedNoteId}`,
            document_id: documentId,
            page_id: linkedNoteId,
            pdf_page: null,
            label: "Linked note",
            sort_order: 1,
            created_at: importedAt,
            updated_at: importedAt,
          };
          save(documentsKey, [document]);
          if (!shouldSkipNote) {
            save(pagesKey, [
              documentPage,
              linkedNote,
              ...load<any>(pagesKey).filter((page) => page.id !== documentPage.id && page.id !== linkedNote.id),
            ]);
            save(linksKey, [
              ...load<any>(linksKey).filter((link) => link.document_id !== documentId || link.page_id !== linkedNoteId),
              linkedNoteLink,
            ]);
          }
          return document;
        }
        if (cmd === "replace_studio_document_file") {
          const documents = load<any>(documentsKey);
          const sourcePath = args.sourcePath as string;
          const originalFilename = sourcePath.split("/").pop() ?? "document.pdf";
          const document = documents.find((candidate) => candidate.id === args.id);
          if (!document) throw new Error("document not found");
          const updatedDocument = {
            ...document,
            original_filename: originalFilename,
            stored_file_path: sourcePath,
            updated_at: args.updatedAt as string,
          };
          save(documentsKey, documents.map((candidate) =>
            candidate.id === args.id ? updatedDocument : candidate
          ));
          return updatedDocument;
        }
        if (cmd === "link_studio_document_page") {
          const link = {
            id: args.id as string,
            document_id: args.documentId as string,
            page_id: args.pageId as string,
            pdf_page: (args.pdfPage as number | null) ?? null,
            label: (args.label as string | null) ?? null,
            sort_order: load<any>(linksKey).length + 1,
            created_at: args.createdAt as string,
            updated_at: args.createdAt as string,
          };
          save(linksKey, [...load<any>(linksKey).filter((candidate) => !(candidate.document_id === link.document_id && candidate.page_id === link.page_id)), link]);
          return {
            ...link,
            page: load<any>(pagesKey).find((item) => item.id === link.page_id),
          };
        }
        if (cmd === "unlink_studio_document_page") {
          const id = args.id as string;
          const documents = load<any>(documentsKey);
          const primaryDocument = documents.find((document) => id === `link-${document.id}-${document.note_page_id}`);
          if (primaryDocument) {
            save(unlinkedPrimaryLinksKey, [...new Set([...load<string>(unlinkedPrimaryLinksKey), primaryDocument.note_page_id])]);
            return null;
          }
          save(linksKey, load<any>(linksKey).filter((link) => link.id !== id));
          return null;
        }
        if (cmd === "create_page") {
          const page = {
            id: args.id as string,
            title: args.title as string,
            parent_id: (args.parentId as string | null) ?? null,
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
            page_kind: "note",
            created_at: args.createdAt as string,
            updated_at: args.createdAt as string,
          };
          save(pagesKey, [page, ...load<any>(pagesKey).filter((item) => item.id !== page.id)]);
          return page;
        }
        if (cmd === "get_page") {
          return load<any>(pagesKey).find((item) => item.id === args.id) ?? null;
        }
        if (cmd === "update_studio_document_viewer_state") {
          const documents = load<any>(documentsKey);
          save(documentsKey, documents.map((document) => document.id === args.id ? { ...document, ...(args.updates as object) } : document));
          return null;
        }
        if (cmd === "update_page") {
          const pages = load<any>(pagesKey);
          save(pagesKey, pages.map((item) => item.id === args.id ? { ...item, ...(args.updates as object), updated_at: args.updatedAt } : item));
          return null;
        }
        if (cmd === "delete_page") {
          const pages = load<any>(pagesKey);
          const deleteIds = new Set<string>([args.id as string]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const item of pages) {
              if (item.parent_id && deleteIds.has(item.parent_id) && !deleteIds.has(item.id)) {
                deleteIds.add(item.id);
                changed = true;
              }
            }
          }
          save(pagesKey, pages.filter((item) => !deleteIds.has(item.id)));
          save(linksKey, load<any>(linksKey).filter((link) => !deleteIds.has(link.page_id)));
          return null;
        }
        if (cmd === "delete_studio_document") {
          const document = load<any>(documentsKey).find((candidate) => candidate.id === args.id);
          if (!document) throw new Error("document not found");
          const pages = load<any>(pagesKey);
          const deleteIds = new Set<string>([document.note_page_id]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const item of pages) {
              if (item.parent_id && deleteIds.has(item.parent_id) && !deleteIds.has(item.id)) {
                deleteIds.add(item.id);
                changed = true;
              }
            }
          }
          save(documentsKey, load<any>(documentsKey).filter((candidate) => candidate.id !== args.id));
          save(pagesKey, pages.filter((item) => !deleteIds.has(item.id)));
          save(linksKey, load<any>(linksKey).filter((link) => link.document_id !== args.id && !deleteIds.has(link.page_id)));
          return null;
        }
        if (cmd === "search_pages") return [];
        if (cmd === "get_workspace_profile") return { name: "", workspaceName: "Shelf", avatarPath: null };
        throw new Error(`Unhandled e2e command: ${cmd}`);
      },
      open: async () => "/tmp/civil-law.pdf",
      save: async () => null,
      fileSrc: (filePath: string) => filePath,
    };
  });
});

test("imports PDF and opens Studio split view", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();

  await expect(page.getByText("civil-law").first()).toBeVisible();
  await expect(page.locator(".on-section-label", { hasText: "Private" })).toBeVisible();
  await expect(page.locator(".on-sidebar-linked-pdf-badge", { hasText: "PDF" }).first()).toBeVisible();
  await expect(page.locator("canvas[aria-label='civil-law']")).toBeVisible();
  await expect(page.locator("textarea[placeholder='Untitled']")).toHaveValue("civil-law Notes");

  await page.getByTitle("Swap PDF and notes").click();
  await expect(page.getByText("100%")).toBeVisible();
});

test("uses normal note editor scale inside Studio notes", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();

  const title = page.locator("textarea[placeholder='Untitled']").first();
  const editorShell = page.locator(".max-w-3xl").filter({ has: title });
  await expect(title).toHaveValue("civil-law Notes");
  await expect(editorShell).toBeVisible();
  await expect.poll(async () => title.evaluate((element) => getComputedStyle(element).fontSize)).toBe("36px");
  await expect.poll(async () => editorShell.evaluate((element) => getComputedStyle(element).paddingTop)).toBe("32px");
});

test("opens imported PDFs in the unified private page tree", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();

  await expect(page.locator(".on-section-label", { hasText: "Private" })).toBeVisible();
  await expect(page.getByText("No private pages yet.")).toBeHidden();
  await expect(page.locator(".on-section-label", { hasText: "Studio notes" })).toBeHidden();

  const importedPdfRow = page.locator("[data-page-id]", { hasText: "civil-law" }).first();
  const linkedNoteRow = page.locator("[data-page-id]", { hasText: "civil-law Notes" });
  await expect(importedPdfRow).toBeVisible();
  await expect(importedPdfRow.locator(".on-sidebar-linked-pdf-badge", { hasText: "PDF" })).toBeVisible();
  await expect(linkedNoteRow).toBeVisible();
  await expect(linkedNoteRow.locator(".on-sidebar-linked-pdf-badge", { hasText: "PDF" })).toBeVisible();
  await linkedNoteRow.click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toHaveValue("civil-law Notes");
});

test("imported PDFs create a nested linked note", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();

  const linkState = await page.evaluate(() => {
    const pages = JSON.parse(window.localStorage.getItem("opennotion-e2e-pages") ?? "[]") as Array<{
      id: string;
      title: string;
      parent_id: string | null;
    }>;
    const documents = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-documents") ?? "[]") as Array<{
      id: string;
      note_page_id: string;
      title: string;
    }>;
    const links = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-page-links") ?? "[]") as Array<{
      document_id: string;
      page_id: string;
      label: string | null;
    }>;
    const document = documents[0] ?? null;
    const documentPage = document ? pages.find((item) => item.id === document.note_page_id) : null;
    const linkedNote = document ? pages.find((item) => item.parent_id === document.note_page_id && item.title === "civil-law Notes") : null;
    const linkedNoteLink = linkedNote ? links.find((link) => link.page_id === linkedNote.id && link.label === "Linked note") : null;
    return { document, documentPage, linkedNote, linkedNoteLink };
  });

  expect(linkState.document?.id).toBe(linkState.document?.note_page_id);
  expect(linkState.documentPage?.title).toBe("civil-law");
  expect(linkState.linkedNote?.title).toBe("civil-law Notes");
  expect(linkState.linkedNoteLink?.document_id).toBe(linkState.document?.id);
  await expect(page.getByText("Linked note missing.")).toBeHidden();
  await expect(page.locator("[data-page-id]", { hasText: "civil-law Notes" }).locator(".on-sidebar-linked-pdf-badge")).toBeVisible();
});

test("deletes a unified Studio PDF from the private page tree", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();

  const documentId = await page.evaluate(() => {
    const documents = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-documents") ?? "[]") as Array<{ id: string }>;
    return documents[0]?.id ?? "";
  });
  expect(documentId).not.toBe("");
  const linkedNoteId = `${documentId}-linked-note`;
  const importedPdfRow = page.locator(`[data-page-id='${documentId}']`);
  await expect(importedPdfRow).toBeVisible();
  await importedPdfRow.click({ button: "right" });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText('Delete "civil-law" and its PDF permanently?')).toBeVisible();
  await page.locator(".on-delete-dialog").getByRole("button", { name: "Delete" }).click();

  await expect(importedPdfRow).toBeHidden();
  await expect(page.getByText("Studio document deleted.")).toBeVisible();
  await expect(page.getByText("delete the Studio document before deleting its primary note")).toBeHidden();
  await expect.poll(async () => page.evaluate(({ documentId, linkedNoteId }) => {
    const documents = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-documents") ?? "[]") as unknown[];
    const pages = JSON.parse(window.localStorage.getItem("opennotion-e2e-pages") ?? "[]") as Array<{ id: string }>;
    return {
      documents: documents.length,
      hasDocumentPage: pages.some((item) => item.id === documentId),
      hasLinkedNote: pages.some((item) => item.id === linkedNoteId),
    };
  }, { documentId, linkedNoteId })).toEqual({ documents: 0, hasDocumentPage: false, hasLinkedNote: false });
});

test("creates multiple linked notes and PDF bookmarks for a Studio document", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();

  await page.getByTitle("New linked note").click();
  await expect(page.locator(".on-studio-linked-page-chip[title='civil-law Note']")).toBeVisible();

  await page.getByTitle("Bookmark current PDF page").click();
  await expect(page.locator(".on-studio-linked-page-chip", { hasText: /civil-law p\. 1/ })).toBeVisible();
  await expect(page.locator(".on-studio-linked-page-badge", { hasText: "p. 1" })).toBeVisible();

  await page.waitForFunction(() => {
    const pages = JSON.parse(window.localStorage.getItem("opennotion-e2e-pages") ?? "[]") as Array<{
      title: string;
      page_kind: string;
    }>;
    const links = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-page-links") ?? "[]") as Array<{
      pdf_page: number | null;
    }>;
    return pages.filter((item) => item.title.startsWith("civil-law")).length >= 3 &&
      links.some((link) => link.pdf_page === 1);
  });
});

test("links existing pages and PDF-page bookmarks to a Studio document", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const now = new Date().toISOString();
    const pages = [
      {
        id: "reference-note",
        title: "Reference Note",
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
        page_kind: "note",
        created_at: now,
        updated_at: now,
      },
      {
        id: "chapter-bookmark",
        title: "Chapter Bookmark",
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
        sort_order: 1,
        page_kind: "note",
        created_at: now,
        updated_at: now,
      },
    ];
    window.localStorage.setItem("opennotion-e2e-pages", JSON.stringify(pages));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();

  await page.getByTitle("Link existing page").click();
  await page.getByPlaceholder("Search pages").fill("Reference");
  await page.getByRole("button", { name: /Reference Note/ }).click();
  await expect(page.getByRole("button", { name: "Reference Note", exact: true })).toBeVisible();

  await page.getByTitle("Link existing page").click();
  await page.getByPlaceholder("Search pages").fill("Chapter");
  await page.locator(".on-studio-link-picker-row", { hasText: "Chapter Bookmark" }).getByTitle("Bookmark page 1").click();
  await expect(page.locator(".on-studio-linked-page-chip", { hasText: /Chapter Bookmark/ })).toBeVisible();
  await expect(page.locator(".on-studio-linked-page-badge", { hasText: "p. 1" })).toBeVisible();
});

test("shows PDF documents inside the unified page tree folder hierarchy", async ({ page }) => {
  await page.addInitScript(() => {
    const now = "2026-06-01T08:00:00.000Z";
    window.localStorage.setItem("opennotion-current-page-id", "research-folder");
    window.localStorage.setItem("opennotion-e2e-studio-documents", JSON.stringify([{
      id: "civil-doc",
      title: "Civil Law",
      original_filename: "civil-law.pdf",
      stored_file_path: "/tmp/civil-law.pdf",
      note_page_id: "civil-doc",
      project_id: null,
      last_opened_at: now,
      viewer_zoom: 100,
      viewer_page: 1,
      panel_layout: "pdf-left",
      created_at: now,
      updated_at: now,
    }]));
    window.localStorage.setItem("opennotion-e2e-pages", JSON.stringify([
      {
        id: "research-folder",
        title: "Research",
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
        page_kind: "note",
        created_at: now,
        updated_at: now,
      },
      {
        id: "civil-doc",
        title: "Civil Law",
        parent_id: "research-folder",
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
        page_kind: "note",
        created_at: now,
        updated_at: now,
      },
    ]));
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  const folder = page.locator("[data-page-id='research-folder']");
  const documentPage = page.locator("[data-page-id='civil-doc']");
  await expect(folder).toBeVisible();
  await expect(documentPage).toBeVisible();
  await expect(documentPage.locator(".on-sidebar-linked-pdf-badge", { hasText: "PDF" })).toBeVisible();

  await documentPage.click();
  await expect(page.locator("canvas[aria-label='Civil Law']")).toBeVisible();
  await expect(page.locator("textarea[placeholder='Untitled']")).toHaveValue("Civil Law");
});

test("shows linked normal notes with a PDF badge that opens the Studio document", async ({ page }) => {
  await page.addInitScript(() => {
    const now = "2026-06-01T08:00:00.000Z";
    window.localStorage.setItem("opennotion-current-page-id", "reference-note");
    window.localStorage.setItem("opennotion-e2e-studio-documents", JSON.stringify([{
      id: "civil-doc",
      title: "Civil Law",
      original_filename: "civil-law.pdf",
      stored_file_path: "/tmp/civil-law.pdf",
      note_page_id: "civil-doc",
      project_id: null,
      last_opened_at: now,
      viewer_zoom: 100,
      viewer_page: 1,
      panel_layout: "pdf-left",
      created_at: now,
      updated_at: now,
    }]));
    window.localStorage.setItem("opennotion-e2e-studio-page-links", JSON.stringify([{
      id: "link-civil-doc-reference-note",
      document_id: "civil-doc",
      page_id: "reference-note",
      pdf_page: 3,
      label: "Reference",
      sort_order: 1,
      created_at: now,
      updated_at: now,
    }]));
    window.localStorage.setItem("opennotion-e2e-pages", JSON.stringify([
      {
        id: "civil-doc",
        title: "Civil Law",
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
        page_kind: "note",
        created_at: now,
        updated_at: now,
      },
      {
        id: "reference-note",
        title: "Reference Note",
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
        sort_order: 1,
        page_kind: "note",
        created_at: now,
        updated_at: now,
      },
    ]));
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  const linkedNote = page.locator("[data-page-id='reference-note']");
  await expect(linkedNote).toBeVisible();
  const badge = linkedNote.locator(".on-sidebar-linked-pdf-badge", { hasText: "PDF" });
  await expect(badge).toBeVisible();
  await badge.click();

  await expect(page.locator("canvas[aria-label='Civil Law']")).toBeVisible();
  await expect(page.locator(".on-studio-linked-page-chip", { hasText: "Reference Note" })).toBeVisible();
  await expect(page.locator(".on-studio-linked-page-badge", { hasText: "p. 3" })).toBeVisible();
});

test("switches Studio PDF view mode between continuous, single page, and two pages", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();

  await page.getByTitle("PDF view options").click();
  await expect(page.getByRole("menuitemradio", { name: "Continuous scroll" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Single page" })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: "Two pages" })).toBeVisible();

  await page.getByRole("menuitemradio", { name: "Single page" }).click();
  await expect(page.locator("[data-pdf-view-mode='single']")).toBeVisible();

  await page.getByTitle("PDF view options").click();
  await page.getByRole("menuitemradio", { name: "Two pages" }).click();
  await expect(page.locator("[data-pdf-view-mode='two-page']")).toBeVisible();

  await page.keyboard.press("Meta+1");
  await expect(page.locator("[data-pdf-view-mode='continuous']")).toBeVisible();
});

test("updates continuous PDF page indicator without persisting scroll as a page jump", async ({ page }) => {
  await page.unroute("**/civil-law.pdf*");
  await page.route("**/civil-law.pdf*", async (route) => {
    await route.fulfill({
      body: multiPagePdfFixture,
      contentType: "application/pdf",
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();
  await expect(page.locator(".on-studio-page-total", { hasText: "8" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-pdf-page='1']")).toBeVisible();

  const viewer = page.locator("[data-pdf-view-mode='continuous']");
  await expect.poll(async () => viewer.evaluate((element) => element.scrollHeight > element.clientHeight * 2)).toBe(true);
  await viewer.evaluate((element) => {
    element.scrollTop = Math.max(element.clientHeight * 2.2, 900);
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(100);
  await viewer.evaluate((element) => {
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect.poll(async () => Number(await page.locator(".on-studio-page-input").inputValue())).toBeGreaterThan(1);
  await expect.poll(async () => page.evaluate(() => {
    const documents = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-documents") ?? "[]") as Array<{
      viewer_page: number;
    }>;
    return documents[0]?.viewer_page;
  })).toBe(1);
});

test("keeps continuous PDF visible when changing page from toolbar arrows", async ({ page }) => {
  await page.unroute("**/civil-law.pdf*");
  await page.route("**/civil-law.pdf*", async (route) => {
    await route.fulfill({
      body: multiPagePdfFixture,
      contentType: "application/pdf",
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();
  await expect(page.locator(".on-studio-page-total", { hasText: "8" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-pdf-page='1']")).toBeVisible();

  const viewer = page.locator("[data-pdf-view-mode='continuous']");
  await viewer.hover();
  await page.mouse.wheel(0, -900);
  await expect.poll(async () => viewer.evaluate((element) => element.scrollTop)).toBe(0);

  await page.getByTitle("Next page").click();
  await expect(page.locator(".on-studio-page-input")).toHaveValue("2");
  await expect(page.locator("[data-pdf-page='2']")).toBeVisible();
  await expect(page.locator("[data-pdf-page='2']")).toHaveAttribute("data-pdf-rendered", "true");
  await expect.poll(async () => viewer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await viewer.evaluate((element) => {
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(page.locator(".on-studio-page-input")).toHaveValue("2");
  await expect.poll(async () => page.evaluate(() => {
    const documents = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-documents") ?? "[]") as Array<{
      viewer_page: number;
    }>;
    return documents[0]?.viewer_page;
  })).toBe(2);
});

test("blocks continuous PDF overscroll above the first page", async ({ page }) => {
  await page.unroute("**/civil-law.pdf*");
  await page.route("**/civil-law.pdf*", async (route) => {
    await route.fulfill({
      body: multiPagePdfFixture,
      contentType: "application/pdf",
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();
  await expect(page.locator(".on-studio-page-input")).toHaveValue("1");
  await expect(page.locator("[data-pdf-page='1']")).toBeVisible();

  const viewer = page.locator("[data-pdf-view-mode='continuous']");
  await expect.poll(async () => viewer.evaluate((element) => getComputedStyle(element).overscrollBehaviorY)).toBe("none");
  await viewer.hover();
  await page.mouse.wheel(0, -900);

  await expect(page.locator(".on-studio-page-input")).toHaveValue("1");
  await expect(page.locator("[data-pdf-page='1']")).toBeVisible();
  await expect.poll(async () => viewer.evaluate((element) => element.scrollTop)).toBe(0);
});

test("creates a missing Studio note only from the notes panel fallback action", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("opennotion-e2e-missing-studio-note", "1");
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();

  await expect(page.getByText("Linked note missing.")).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeHidden();
  await page.getByRole("button", { name: "Create linked note" }).click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toHaveValue("civil-law Notes");
  await expect(page.getByText("Linked note missing.")).toBeHidden();
  await page.waitForFunction(() => {
    const pages = JSON.parse(window.localStorage.getItem("opennotion-e2e-pages") ?? "[]") as Array<{
      page_kind: string;
      title: string;
    }>;
    return pages.some((item) => item.page_kind === "studio_note" && item.title === "civil-law Notes");
  });
});

test("reimports a Studio PDF when the stored copy is missing", async ({ page }) => {
  await page.addInitScript(() => {
    const now = "2026-05-29T08:00:00.000Z";
    window.localStorage.setItem("opennotion-current-page-id", "missing-doc");
    window.localStorage.setItem("opennotion-e2e-studio-documents", JSON.stringify([{
      id: "missing-doc",
      title: "Missing Source",
      original_filename: "missing.pdf",
      stored_file_path: "/tmp/missing.pdf",
      note_page_id: "missing-doc",
      project_id: null,
      last_opened_at: now,
      viewer_zoom: 100,
      viewer_page: 1,
      panel_layout: "pdf-left",
      created_at: now,
      updated_at: now,
    }]));
    window.localStorage.setItem("opennotion-e2e-pages", JSON.stringify([{
      id: "missing-doc",
      title: "Missing Source Notes",
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
      page_kind: "note",
      created_at: now,
      updated_at: now,
    }]));
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("PDF preview unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Reimport PDF" }).click();

  await expect(page.locator("canvas[aria-label='Missing Source']")).toBeVisible();
  await expect(page.getByText("civil-law.pdf").first()).toBeVisible();
  await page.waitForFunction(() => {
    const documents = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-documents") ?? "[]") as Array<{
      id: string;
      original_filename: string;
      stored_file_path: string;
    }>;
    return documents.some((document) =>
      document.id === "missing-doc" &&
      document.original_filename === "civil-law.pdf" &&
      document.stored_file_path === "/tmp/civil-law.pdf"
    );
  });
});

test("keeps dark PDF toolbar page and zoom labels readable", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("opennotion-theme", "dark");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();

  const pageTotal = page.locator(".on-studio-page-total");
  const zoomButton = page.getByTitle("Reset zoom");

  await expect(pageTotal).toBeVisible();
  await expect(zoomButton).toBeVisible();

  const styles = await page.evaluate(() => {
    const controls = document.querySelector(".on-studio-toolbar-controls");
    const pageGroup = document.querySelector(".on-studio-page-controls");
    const zoomGroup = document.querySelector(".on-studio-zoom-controls");
    const pageTotal = document.querySelector(".on-studio-page-total");
    const zoomButton = document.querySelector(".on-studio-zoom-button");
    if (!controls || !pageGroup || !zoomGroup || !pageTotal || !zoomButton) return null;

    const pageGroupStyle = getComputedStyle(pageGroup);
    const zoomGroupStyle = getComputedStyle(zoomGroup);
    const pageTotalStyle = getComputedStyle(pageTotal);
    const zoomButtonStyle = getComputedStyle(zoomButton);
    return {
      controlsClass: controls.className,
      pageGroupBackground: pageGroupStyle.backgroundColor,
      zoomGroupBackground: zoomGroupStyle.backgroundColor,
      pageTotalBackground: pageTotalStyle.backgroundColor,
      pageTotalColor: pageTotalStyle.color,
      zoomBackground: zoomButtonStyle.backgroundColor,
      zoomColor: zoomButtonStyle.color,
    };
  });

  expect(styles).not.toBeNull();
  expect(styles!.controlsClass).toContain("on-studio-toolbar-controls-note-surface");
  expect(styles!.pageTotalBackground).toBe("rgba(0, 0, 0, 0)");
  expect(styles!.zoomBackground).toBe("rgba(0, 0, 0, 0)");
  expect(styles!.pageTotalColor).toBe(styles!.zoomColor);
});

test("keeps Studio toolbar in flow above PDF and notes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();
  await expect(page.locator(".on-studio-toolbar-title-secondary", { hasText: "civil-law.pdf" })).toBeVisible({ timeout: 60_000 });

  const toolbarBox = await page.locator(".on-studio-floating-toolbar").boundingBox();
  const titleBox = await page.locator(".on-studio-toolbar-title").boundingBox();
  const controlsBox = await page.locator(".on-studio-toolbar-controls").boundingBox();
  const pdfBox = await page.getByLabel("PDF panel").boundingBox();
  const noteBox = await page.getByLabel("Notes panel").boundingBox();

  expect(toolbarBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(pdfBox).not.toBeNull();
  expect(noteBox).not.toBeNull();
  if (!toolbarBox || !titleBox || !controlsBox || !pdfBox || !noteBox) return;

  const toolbarBottom = toolbarBox.y + toolbarBox.height;
  expect(pdfBox.y).toBeGreaterThanOrEqual(toolbarBottom - 1);
  expect(noteBox.y).toBeGreaterThanOrEqual(toolbarBottom - 1);
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(controlsBox.x - 8);
});

test("creates editable formula blocks in Studio notes", async ({ page }) => {
  const duplicateKeyErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Encountered two children with the same key")) {
      duplicateKeyErrors.push(message.text());
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();

  await page.getByRole("textbox").last().click();
  await page.keyboard.type("/formula");
  await page.getByText("Formula", { exact: true }).click();

  await expect(page.getByLabel("Formula input")).toBeHidden();
  await page.getByLabel("Formula preview: \\nabla \\cdot \\vec{E}").click();
  const formulaInput = page.getByLabel("Formula input");
  await expect(formulaInput).toBeVisible();
  await formulaInput.fill("\\int_0^1 x^2 dx");

  await expect(page.getByLabel("Formula preview: \\int_0^1 x^2 dx")).toBeVisible();
  await page.waitForFunction(() => {
    const pages = JSON.parse(window.localStorage.getItem("opennotion-e2e-pages") ?? "[]") as Array<{
      page_kind: string;
      title: string;
      content: string | null;
      search_text: string | null;
    }>;
    return pages.some((item) =>
      item.title === "civil-law Notes" &&
      (item.content ?? "").includes('"type":"formula"') &&
      (item.search_text ?? "").includes("\\int_0^1 x^2 dx")
    );
  });
  expect(duplicateKeyErrors).toEqual([]);
});

test("keeps Studio top bar clear of the sidebar toggle when sidebar is closed", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();
  await expect(page.locator(".on-studio-toolbar-title-secondary", { hasText: "civil-law.pdf" })).toBeVisible({ timeout: 60_000 });

  await page.getByTitle("Toggle sidebar").click();

  const toggleBox = await page.getByTitle("Toggle sidebar").boundingBox();
  const filenameBox = await page.locator(".on-studio-toolbar-title-secondary", { hasText: "civil-law.pdf" }).boundingBox();

  expect(toggleBox).not.toBeNull();
  expect(filenameBox).not.toBeNull();
  expect(filenameBox!.x).toBeGreaterThan(toggleBox!.x + toggleBox!.width + 16);
});

test("stacks Studio panels when resized below usable split width", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 720 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();

  const pdfBox = await page.getByLabel("PDF panel").boundingBox();
  const noteBox = await page.getByLabel("Notes panel").boundingBox();

  expect(pdfBox).not.toBeNull();
  expect(noteBox).not.toBeNull();
  expect(noteBox!.y).toBeGreaterThanOrEqual(pdfBox!.y + pdfBox!.height);
});

test("keeps Studio panels side by side at ordinary desktop widths", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();

  const pdfBox = await page.getByLabel("PDF panel").boundingBox();
  const noteBox = await page.getByLabel("Notes panel").boundingBox();

  expect(pdfBox).not.toBeNull();
  expect(noteBox).not.toBeNull();
  expect(Math.abs(noteBox!.y - pdfBox!.y)).toBeLessThan(120);
  expect(noteBox!.x).toBeGreaterThan(pdfBox!.x + pdfBox!.width);
});

test("does not show a window-level horizontal scrollbar in Studio split view", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();
  await expect(page.locator(".on-studio-split")).toBeVisible();

  const overflow = await page.evaluate(() => {
    const splitFrame = document.querySelector<HTMLElement>(".on-studio-split-frame");
    const split = document.querySelector<HTMLElement>(".on-studio-split");
    return {
      windowExtra: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyExtra: document.body.scrollWidth - document.body.clientWidth,
      frameExtra: splitFrame ? splitFrame.scrollWidth - splitFrame.clientWidth : 0,
      splitExtra: split ? split.scrollWidth - split.clientWidth : 0,
    };
  });

  expect(overflow.windowExtra).toBeLessThanOrEqual(0);
  expect(overflow.bodyExtra).toBeLessThanOrEqual(0);
  expect(overflow.frameExtra).toBeLessThanOrEqual(0);
  expect(overflow.splitExtra).toBeLessThanOrEqual(0);
});

test("navigates PDF pages with arrow keys and swipe gestures", async ({ page }) => {
  await page.unroute("**/civil-law.pdf*");
  await page.route("**/civil-law.pdf*", async (route) => {
    await route.fulfill({
      body: multiPagePdfFixture,
      contentType: "application/pdf",
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();
  await expect(page.locator(".on-studio-page-total", { hasText: "8" })).toBeVisible({ timeout: 60_000 });

  await page.getByTitle("PDF view options").click();
  await page.getByRole("menuitemradio", { name: "Single page" }).click();
  const viewer = page.locator("[data-pdf-view-mode='single']");
  await expect(viewer).toBeVisible();
  const pageInput = page.locator(".on-studio-page-input");

  // Arrow keys page forward and back.
  await page.keyboard.press("ArrowRight");
  await expect(pageInput).toHaveValue("2");
  await page.keyboard.press("ArrowRight");
  await expect(pageInput).toHaveValue("3");
  await page.keyboard.press("ArrowLeft");
  await expect(pageInput).toHaveValue("2");

  // Arrows must not steal caret movement from text inputs.
  await pageInput.click();
  await page.keyboard.press("ArrowRight");
  await expect(pageInput).toHaveValue("2");
  await page.keyboard.press("Escape");
  await viewer.click();

  // Trackpad-style horizontal wheel swipe pages forward. Park the viewer at
  // its right scroll edge first — mouse.wheel does not wait for native
  // scrolling to be applied, so reaching the edge via wheel events races the
  // compositor on slow machines. At the edge, a continued horizontal wheel
  // turns the page.
  await page.getByTitle("Zoom out").click();
  await page.getByTitle("Zoom out").click();
  // Wait out the zoom re-render: the zoom flow re-anchors scrollLeft in a
  // requestAnimationFrame, which would silently undo a one-shot edge park.
  await expect(page.locator("[data-pdf-page='2']")).toHaveAttribute("data-pdf-rendered", "true");
  await viewer.hover();
  await expect.poll(async () =>
    viewer.evaluate((element) => {
      // Mirrors the viewer's edge detection: with classic scrollbars and
      // scrollbar-gutter: stable, scrollWidth overstates the reachable range
      // by the gutter width (offsetWidth - clientWidth).
      element.scrollLeft = element.scrollWidth;
      const scrollbarInset = (element as HTMLElement).offsetWidth - element.clientWidth;
      if (element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 - scrollbarInset) return "at-edge";
      return `scrollLeft=${element.scrollLeft} clientWidth=${element.clientWidth} scrollWidth=${element.scrollWidth}`
        + ` offsetWidth=${(element as HTMLElement).offsetWidth}`;
    })
  ).toBe("at-edge");
  await page.mouse.wheel(400, 0);
  await expect(pageInput).toHaveValue("3");

  // Touch swipe left goes to the next page, swipe right goes back.
  await viewer.evaluate((element) => {
    const touch = (x: number, y: number) =>
      new Touch({ identifier: 1, target: element, clientX: x, clientY: y });
    element.dispatchEvent(new TouchEvent("touchstart", { touches: [touch(320, 200)], changedTouches: [touch(320, 200)], bubbles: true }));
    element.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [touch(140, 206)], bubbles: true }));
  });
  await expect(pageInput).toHaveValue("4");

  await viewer.evaluate((element) => {
    const touch = (x: number, y: number) =>
      new Touch({ identifier: 1, target: element, clientX: x, clientY: y });
    element.dispatchEvent(new TouchEvent("touchstart", { touches: [touch(140, 200)], changedTouches: [touch(140, 200)], bubbles: true }));
    element.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [touch(320, 194)], bubbles: true }));
  });
  await expect(pageInput).toHaveValue("3");

  // Page changes persist to the viewer state.
  await expect.poll(async () => page.evaluate(() => {
    const documents = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-documents") ?? "[]") as Array<{
      viewer_page: number;
    }>;
    return documents[0]?.viewer_page;
  })).toBe(3);
});

test("changes single-mode pages in place without blanking the canvas", async ({ page }) => {
  await page.unroute("**/civil-law.pdf*");
  await page.route("**/civil-law.pdf*", async (route) => {
    await route.fulfill({
      body: multiPagePdfFixture,
      contentType: "application/pdf",
    });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Import PDF" }).click();
  await expect(page.locator(".on-studio-page-total", { hasText: "8" })).toBeVisible({ timeout: 60_000 });

  await page.getByTitle("PDF view options").click();
  await page.getByRole("menuitemradio", { name: "Single page" }).click();
  const viewer = page.locator("[data-pdf-view-mode='single']");
  await expect(viewer).toBeVisible();
  const canvas = viewer.locator("canvas").first();
  await expect(page.locator("[data-pdf-page='1']")).toHaveAttribute("data-pdf-rendered", "true");

  // Tag the canvas element: page changes must reuse it, not remount it.
  await canvas.evaluate((element) => {
    (element as HTMLCanvasElement & { __stableMarker?: boolean }).__stableMarker = true;
  });

  await page.getByTitle("Next page").click();
  await expect(page.locator(".on-studio-page-input")).toHaveValue("2");

  // Same element instance, and the old bitmap stayed in place (width never
  // dropped to 0) until the new page was blitted.
  const state = await canvas.evaluate((element) => ({
    stable: (element as HTMLCanvasElement & { __stableMarker?: boolean }).__stableMarker === true,
    width: (element as HTMLCanvasElement).width,
  }));
  expect(state.stable).toBe(true);
  expect(state.width).toBeGreaterThan(0);

  await expect(page.locator("[data-pdf-page='2']")).toHaveAttribute("data-pdf-rendered", "true");
});
