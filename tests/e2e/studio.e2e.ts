import { expect, test, type Page } from "@playwright/test";

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
    const projectsKey = "opennotion-e2e-studio-projects";
    const linksKey = "opennotion-e2e-studio-page-links";
    const pagesKey = "opennotion-e2e-pages";
    const resetKey = "opennotion-e2e-studio-reset";
    const load = <T,>(key: string): T[] => JSON.parse(window.localStorage.getItem(key) ?? "[]");
    const save = <T,>(key: string, value: T[]) => window.localStorage.setItem(key, JSON.stringify(value));

    if (window.localStorage.getItem(resetKey) !== "done") {
      window.localStorage.removeItem(documentsKey);
      window.localStorage.removeItem(projectsKey);
      window.localStorage.removeItem(linksKey);
      window.localStorage.removeItem(pagesKey);
      window.localStorage.removeItem("opennotion-current-page-id");
      window.localStorage.removeItem("opennotion-current-studio-document-id");
      window.localStorage.removeItem("opennotion-workspace-mode");
      window.localStorage.setItem(resetKey, "done");
    }

    window.openNotion = {
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "list_pages") return load(pagesKey).filter((item: any) => item.page_kind === "note" || item.page_kind === "studio_note");
        if (cmd === "list_studio_documents") return load(documentsKey);
        if (cmd === "list_studio_projects") return load(projectsKey);
        if (cmd === "list_studio_document_page_links") {
          const document = load<any>(documentsKey).find((candidate) => candidate.id === args.documentId);
          if (!document) return [];
          const pages = load<any>(pagesKey);
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
          const document = {
            id: args.documentId as string,
            title: "civil-law",
            original_filename: "civil-law.pdf",
            stored_file_path: "/tmp/civil-law.pdf",
            note_page_id: args.notePageId as string,
            project_id: null,
            last_opened_at: args.importedAt as string,
            viewer_zoom: 100,
            viewer_page: 1,
            panel_layout: "pdf-left",
            created_at: args.importedAt as string,
            updated_at: args.importedAt as string,
          };
          const shouldSkipNote = window.localStorage.getItem("opennotion-e2e-missing-studio-note") === "1";
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
          if (!shouldSkipNote) {
            save(pagesKey, [note, ...load<any>(pagesKey).filter((page) => page.id !== note.id)]);
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
        if (cmd === "create_studio_project") {
          const project = {
            id: args.id as string,
            name: args.name as string,
            parent_id: (args.parentId as string | null) ?? null,
            sort_order: load<any>(projectsKey).length,
            created_at: args.createdAt as string,
            updated_at: args.createdAt as string,
          };
          save(projectsKey, [...load<any>(projectsKey), project]);
          return project;
        }
        if (cmd === "rename_studio_project") {
          save(projectsKey, load<any>(projectsKey).map((project) =>
            project.id === args.id ? { ...project, name: args.name, updated_at: args.updatedAt } : project
          ));
          return null;
        }
        if (cmd === "update_studio_project_parent") {
          save(projectsKey, load<any>(projectsKey).map((project) =>
            project.id === args.id ? {
              ...project,
              parent_id: (args.parentId as string | null) ?? null,
              updated_at: args.updatedAt,
            } : project
          ));
          return null;
        }
        if (cmd === "delete_studio_project") {
          save(projectsKey, load<any>(projectsKey).filter((project) => project.id !== args.id));
          save(documentsKey, load<any>(documentsKey).map((document) =>
            document.project_id === args.id ? { ...document, project_id: null, updated_at: args.updatedAt } : document
          ));
          return null;
        }
        if (cmd === "update_studio_document_project") {
          save(documentsKey, load<any>(documentsKey).map((document) =>
            document.id === args.id ? { ...document, project_id: args.projectId ?? null, updated_at: args.updatedAt } : document
          ));
          return null;
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
        if (cmd === "search_pages") return [];
        throw new Error(`Unhandled e2e command: ${cmd}`);
      },
      open: async () => "/tmp/civil-law.pdf",
      save: async () => null,
      fileSrc: (filePath: string) => filePath,
    };
  });
});

async function submitProjectDialog(page: Page, title: string, name: string) {
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Project name").fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();
}

test("auto-dismisses Studio success notices", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Studio" }).click();

  await page.getByRole("button", { name: "New Studio project" }).click();
  await submitProjectDialog(page, "New Studio project", "Physics");

  const notice = page.locator(".on-notice").filter({ hasText: "Studio project created." });
  await expect(notice).toBeVisible();
  await expect(notice).toBeHidden({ timeout: 5_500 });
});

test("imports PDF and opens Studio split view", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Studio" }).click();
  await page.getByRole("button", { name: "Import PDF" }).click();

  await expect(page.getByText("civil-law").first()).toBeVisible();
  await expect(page.locator(".on-studio-tree-title", { hasText: /^Projects$/ })).toBeVisible();
  await expect(page.getByText("Inbox")).toBeVisible();
  await expect(page.getByText("Recent")).toBeHidden();
  await expect(page.locator(".on-studio-section-subtitle", { hasText: "1 PDF / 0 projects" })).toBeVisible();
  await expect(page.locator("canvas[aria-label='civil-law']")).toBeVisible();
  await expect(page.locator("textarea[placeholder='Untitled']")).toHaveValue("civil-law Notes");

  await page.getByTitle("Swap PDF and notes").click();
  await expect(page.getByText("100%")).toBeVisible();
});

test("uses normal note editor scale inside Studio notes", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Studio" }).click();
  await page.getByRole("button", { name: "Import PDF" }).click();

  const title = page.locator("textarea[placeholder='Untitled']").first();
  const editorShell = page.locator(".max-w-3xl").filter({ has: title });
  await expect(title).toHaveValue("civil-law Notes");
  await expect(editorShell).toBeVisible();
  await expect.poll(async () => title.evaluate((element) => getComputedStyle(element).fontSize)).toBe("36px");
  await expect.poll(async () => editorShell.evaluate((element) => getComputedStyle(element).paddingTop)).toBe("80px");
});

test("opens Studio notes in a dedicated Notes sidebar section", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Studio" }).click();
  await page.getByRole("button", { name: "Import PDF" }).click();

  await page.getByRole("button", { name: "Note", exact: true }).click();
  await expect(page.locator(".on-section-label", { hasText: "Studio notes" })).toBeVisible();
  await expect(page.getByText("No private pages yet.")).toBeVisible();
  await expect(page.locator("[data-studio-note-project-id='studio-inbox']")).toBeVisible();
  await expect(page.locator(".on-studio-note-document-node", { hasText: "civil-law" })).toBeVisible();

  const studioNoteRow = page.locator("[data-studio-note-id]", { hasText: "civil-law Notes" });
  await expect(studioNoteRow).toBeVisible();
  await studioNoteRow.click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toHaveValue("civil-law Notes");
});

test("deletes a primary Studio note without recreating it automatically", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Studio" }).click();
  await page.getByRole("button", { name: "Import PDF" }).click();

  const studioNoteId = await page.evaluate(() => {
    const pages = JSON.parse(window.localStorage.getItem("opennotion-e2e-pages") ?? "[]") as Array<{
      id: string;
      title: string;
    }>;
    return pages.find((item) => item.title === "civil-law Notes")?.id ?? null;
  });
  expect(studioNoteId).toBeTruthy();
  await page.evaluate((id) => {
    window.localStorage.setItem("opennotion-e2e-deleted-studio-note-id", id);
  }, studioNoteId);

  await page.getByLabel("Delete linked note civil-law Notes").click();
  await page.locator(".on-delete-dialog").getByRole("button", { name: "Delete" }).click();

  await page.waitForFunction(() => {
    const deletedId = window.localStorage.getItem("opennotion-e2e-deleted-studio-note-id");
    const pages = JSON.parse(window.localStorage.getItem("opennotion-e2e-pages") ?? "[]") as Array<{ title: string }>;
    return Boolean(deletedId) && !pages.some((item: any) => item.id === deletedId);
  });
  await expect(page.getByText("Linked note missing.")).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.getByText("Linked note missing.")).toBeVisible();

  await page.getByRole("button", { name: "Note", exact: true }).click();
  await expect(page.locator("[data-studio-note-id]", { hasText: "civil-law Notes" })).toBeHidden();
});

test("groups Studio notes by nested Studio project folders in Notes", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Studio" }).click();

  await page.getByRole("button", { name: "New Studio project" }).click();
  await submitProjectDialog(page, "New Studio project", "Physics");
  const physicsProjectId = await page.evaluate(() => {
    const projects = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-projects") ?? "[]") as Array<{
      id: string;
      name: string;
    }>;
    return projects.find((item) => item.name === "Physics")?.id;
  });
  expect(physicsProjectId).toBeTruthy();

  const physicsProject = page.locator(`[data-studio-project-id='${physicsProjectId}']`);
  await physicsProject.getByLabel("Actions for project Physics").click();
  await page.getByRole("menuitem", { name: "New subfolder" }).click();
  await submitProjectDialog(page, "New Studio subfolder", "Mechanics");

  const mechanicsProjectId = await page.evaluate(() => {
    const projects = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-projects") ?? "[]") as Array<{
      id: string;
      name: string;
    }>;
    return projects.find((item) => item.name === "Mechanics")?.id;
  });
  expect(mechanicsProjectId).toBeTruthy();

  await page.locator(`[data-studio-project-id='${mechanicsProjectId}']`).getByRole("button", { name: "Select project Mechanics" }).click();
  await page.getByRole("button", { name: "Import PDF" }).click();
  await page.getByTitle("New linked note").click();
  await expect(page.getByRole("button", { name: "civil-law Note", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Note", exact: true }).click();
  const notesPhysicsProject = page.locator(`[data-studio-note-project-id='${physicsProjectId}']`);
  const notesMechanicsProject = page.locator(`[data-studio-note-project-id='${mechanicsProjectId}']`);

  await expect(notesPhysicsProject).toBeVisible();
  await expect(notesMechanicsProject).toBeVisible();
  await expect(notesMechanicsProject).toHaveAttribute("data-studio-note-project-parent-id", physicsProjectId!);
  await expect(notesMechanicsProject).toHaveAttribute("data-studio-note-project-depth", "1");
  await expect(notesMechanicsProject.locator(".on-studio-note-document-node", { hasText: "civil-law" })).toBeVisible();
  await expect(notesMechanicsProject.getByRole("button", { name: "civil-law Notes", exact: true })).toBeVisible();
  await expect(notesMechanicsProject.getByRole("button", { name: "civil-law Note", exact: true })).toBeVisible();

  await notesPhysicsProject.getByRole("button", { name: /Physics/ }).click();
  await expect(notesMechanicsProject).toBeHidden();
});

test("creates multiple linked notes and PDF bookmarks for a Studio document", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Studio" }).click();
  await page.getByRole("button", { name: "Import PDF" }).click();

  await page.getByTitle("New linked note").click();
  await expect(page.getByRole("button", { name: "civil-law Note", exact: true })).toBeVisible();

  await page.getByTitle("Bookmark current PDF page").click();
  await expect(page.locator(".on-studio-linked-page-chip", { hasText: /civil-law p\. 1/ })).toBeVisible();
  await expect(page.locator(".on-studio-linked-page-badge", { hasText: "p. 1" })).toBeVisible();

  await page.waitForFunction(() => {
    const pages = JSON.parse(window.localStorage.getItem("opennotion-e2e-pages") ?? "[]") as Array<{
      page_kind: string;
    }>;
    const links = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-page-links") ?? "[]") as Array<{
      pdf_page: number | null;
    }>;
    return pages.filter((item) => item.page_kind === "studio_note").length >= 3 &&
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

  await page.getByRole("button", { name: "Studio" }).click();
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

test("organizes Studio documents into projects with inline rename and drag drop", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Studio" }).click();

  await page.getByRole("button", { name: "New Studio project" }).click();
  await submitProjectDialog(page, "New Studio project", "Physics");

  const physicsProjectId = await page.evaluate(() => {
    const projects = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-projects") ?? "[]") as Array<{
      id: string;
      name: string;
    }>;
    return projects.find((item) => item.name === "Physics")?.id;
  });
  expect(physicsProjectId).toBeTruthy();

  const physicsProject = page.locator(`[data-studio-project-id='${physicsProjectId}']`);
  await expect(physicsProject).toBeVisible();
  await expect(physicsProject.getByText("Drop PDFs here")).toBeVisible();

  await physicsProject.getByLabel("Actions for project Physics").click();
  await page.getByRole("menuitem", { name: "Rename project" }).click();
  await physicsProject.getByLabel("Project name").fill("Mechanics");
  await physicsProject.getByLabel("Project name").press("Enter");

  const mechanicsProject = page.locator("[data-studio-project-id]").filter({ hasText: "Mechanics" });
  await expect(mechanicsProject).toBeVisible();

  await page.getByRole("button", { name: "Import PDF" }).click();
  await page
    .locator("[data-studio-project-id='studio-inbox'] [data-studio-document-id]")
    .filter({ hasText: "civil-law" })
    .dragTo(mechanicsProject);

  await expect(
    page.locator("[data-studio-project-id]").filter({ hasText: "Mechanics" }).locator("[role='button'][title='civil-law.pdf']")
  ).toBeVisible();
  await page.waitForFunction(() => {
    const documents = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-documents") ?? "[]") as Array<{
      title: string;
      project_id: string | null;
    }>;
    const projects = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-projects") ?? "[]") as Array<{
      id: string;
      name: string;
    }>;
    const project = projects.find((item) => item.name === "Mechanics");
    return Boolean(project && documents.some((document) => document.title === "civil-law" && document.project_id === project.id));
  });
});

test("creates nested Studio project folders and moves projects into folders", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Studio" }).click();

  await page.getByRole("button", { name: "New Studio project" }).click();
  await submitProjectDialog(page, "New Studio project", "Physics");
  const physicsProjectId = await page.evaluate(() => {
    const projects = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-projects") ?? "[]") as Array<{
      id: string;
      name: string;
    }>;
    return projects.find((item) => item.name === "Physics")?.id;
  });
  expect(physicsProjectId).toBeTruthy();
  const physicsProject = page.locator(`[data-studio-project-id='${physicsProjectId}']`);

  await physicsProject.getByLabel("Actions for project Physics").click();
  await page.getByRole("menuitem", { name: "New subfolder" }).click();
  await submitProjectDialog(page, "New Studio subfolder", "Mechanics");

  const mechanicsProjectId = await page.evaluate(() => {
    const projects = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-projects") ?? "[]") as Array<{
      id: string;
      name: string;
    }>;
    return projects.find((item) => item.name === "Mechanics")?.id;
  });
  expect(mechanicsProjectId).toBeTruthy();
  let mechanicsProject = page.locator(`[data-studio-project-id='${mechanicsProjectId}']`);
  await expect(mechanicsProject).toHaveAttribute("data-studio-project-parent-id", physicsProjectId!);
  await expect(mechanicsProject).toHaveAttribute("data-studio-project-depth", "1");
  await physicsProject.getByRole("button", { name: "Toggle project Physics" }).click();
  await expect(mechanicsProject).toBeHidden();
  await physicsProject.getByRole("button", { name: "Toggle project Physics" }).click();
  await expect(mechanicsProject).toBeVisible();

  await page.getByRole("button", { name: "New Studio project" }).click();
  await submitProjectDialog(page, "New Studio project", "Chemistry");
  const chemistryProjectId = await page.evaluate(() => {
    const projects = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-projects") ?? "[]") as Array<{
      id: string;
      name: string;
    }>;
    return projects.find((item) => item.name === "Chemistry")?.id;
  });
  expect(chemistryProjectId).toBeTruthy();
  const chemistryProject = page.locator(`[data-studio-project-id='${chemistryProjectId}']`);
  await chemistryProject.locator("[data-studio-project-drag-handle]").dragTo(physicsProject);
  mechanicsProject = page.locator(`[data-studio-project-id='${mechanicsProjectId}']`);
  await expect(chemistryProject).toHaveAttribute("data-studio-project-parent-id", physicsProjectId!);
  await expect(chemistryProject).toHaveAttribute("data-studio-project-depth", "1");

  await physicsProject.getByRole("button", { name: "Select project Physics" }).click();
  await page.getByRole("button", { name: "Import PDF" }).click();
  await page
    .locator(`[data-studio-project-id='${physicsProjectId}'] [data-studio-document-id]`)
    .filter({ hasText: "civil-law" })
    .dragTo(mechanicsProject);

  await expect(mechanicsProject.locator("[role='button'][title='civil-law.pdf']")).toBeVisible();
  await page.waitForFunction((targetProjectId) => {
    const documents = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-documents") ?? "[]") as Array<{
      title: string;
      project_id: string | null;
    }>;
    return documents.some((document) => document.title === "civil-law" && document.project_id === targetProjectId);
  }, mechanicsProjectId);
});

test("navigates Studio folders and creates content in the current folder", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Studio" }).click();

  await page.getByRole("button", { name: "New Studio project" }).click();
  await submitProjectDialog(page, "New Studio project", "Physics");
  const physicsProjectId = await page.evaluate(() => {
    const projects = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-projects") ?? "[]") as Array<{
      id: string;
      name: string;
    }>;
    return projects.find((item) => item.name === "Physics")?.id;
  });
  expect(physicsProjectId).toBeTruthy();
  const physicsProject = page.locator(`[data-studio-project-id='${physicsProjectId}']`);

  await physicsProject.getByLabel("Actions for project Physics").click();
  await page.getByRole("menuitem", { name: "New subfolder" }).click();
  await submitProjectDialog(page, "New Studio subfolder", "Mechanics");
  const mechanicsProjectId = await page.evaluate(() => {
    const projects = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-projects") ?? "[]") as Array<{
      id: string;
      name: string;
    }>;
    return projects.find((item) => item.name === "Mechanics")?.id;
  });
  expect(mechanicsProjectId).toBeTruthy();

  await physicsProject.getByRole("button", { name: "Select project Physics" }).click();
  await expect(page.locator(`[data-studio-current-project-id='${physicsProjectId}']`)).toBeVisible();
  await expect(page.getByRole("button", { name: "New Studio subfolder" })).toBeVisible();

  await page.getByRole("button", { name: "New Studio subfolder" }).click();
  await submitProjectDialog(page, "New Studio subfolder", "Thermodynamics");

  await page.waitForFunction((parentProjectId) => {
    const projects = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-projects") ?? "[]") as Array<{
      name: string;
      parent_id: string | null;
    }>;
    return projects.some((project) => project.name === "Thermodynamics" && project.parent_id === parentProjectId);
  }, physicsProjectId);

  const mechanicsProject = page.locator(`[data-studio-project-id='${mechanicsProjectId}']`);
  await mechanicsProject.getByRole("button", { name: "Select project Mechanics" }).click();
  await expect(page.locator(`[data-studio-current-project-id='${mechanicsProjectId}']`)).toBeVisible();

  await page.getByRole("button", { name: "Import PDF" }).click();
  await page.waitForFunction((targetProjectId) => {
    const documents = JSON.parse(window.localStorage.getItem("opennotion-e2e-studio-documents") ?? "[]") as Array<{
      title: string;
      project_id: string | null;
    }>;
    return documents.some((document) => document.title === "civil-law" && document.project_id === targetProjectId);
  }, mechanicsProjectId);
});

test("switches Studio PDF view mode between continuous, single page, and two pages", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Studio" }).click();
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
  await page.getByRole("button", { name: "Studio" }).click();
  await page.getByRole("button", { name: "Import PDF" }).click();
  await expect(page.locator(".on-studio-page-total", { hasText: "8" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-pdf-page='1']")).toBeVisible();

  const viewer = page.locator("[data-pdf-view-mode='continuous']");
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
  await page.getByRole("button", { name: "Studio" }).click();
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
  await page.getByRole("button", { name: "Studio" }).click();
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
  await page.getByRole("button", { name: "Studio" }).click();
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
    window.localStorage.setItem("opennotion-workspace-mode", "studio");
    window.localStorage.setItem("opennotion-current-studio-document-id", "missing-doc");
    window.localStorage.setItem("opennotion-e2e-studio-documents", JSON.stringify([{
      id: "missing-doc",
      title: "Missing Source",
      original_filename: "missing.pdf",
      stored_file_path: "/tmp/missing.pdf",
      note_page_id: "missing-note",
      project_id: null,
      last_opened_at: now,
      viewer_zoom: 100,
      viewer_page: 1,
      panel_layout: "pdf-left",
      created_at: now,
      updated_at: now,
    }]));
    window.localStorage.setItem("opennotion-e2e-pages", JSON.stringify([{
      id: "missing-note",
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
      page_kind: "studio_note",
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
  await page.getByRole("button", { name: "Studio" }).click();
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
  expect(styles!.pageGroupBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles!.zoomGroupBackground).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles!.pageTotalBackground).toBe("rgba(0, 0, 0, 0)");
  expect(styles!.zoomBackground).toBe("rgba(0, 0, 0, 0)");
  expect(styles!.pageTotalColor).toBe(styles!.zoomColor);
});

test("keeps Studio toolbar in flow above PDF and notes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Studio" }).click();
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
  await page.getByRole("button", { name: "Studio" }).click();
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
      content: string | null;
      search_text: string | null;
    }>;
    return pages.some((item) =>
      item.page_kind === "studio_note" &&
      (item.content ?? "").includes('"type":"formula"') &&
      (item.search_text ?? "").includes("\\int_0^1 x^2 dx")
    );
  });
  expect(duplicateKeyErrors).toEqual([]);
});

test("keeps Studio top bar clear of the sidebar toggle when sidebar is closed", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Studio" }).click();
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
  await page.getByRole("button", { name: "Studio" }).click();
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
  await page.getByRole("button", { name: "Studio" }).click();
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
  await page.getByRole("button", { name: "Studio" }).click();
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
