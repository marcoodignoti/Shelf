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
  page_kind: "note" | "studio_note" | "project";
  created_at: string;
  updated_at: string;
};

const storageKey = "opennotion-e2e-sidebar-projects-pages";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    const loadPages = (): MockPage[] => JSON.parse(window.localStorage.getItem(key) ?? "[]");
    const savePages = (pages: MockPage[]) => window.localStorage.setItem(key, JSON.stringify(pages));
    const sortPages = (pages: MockPage[]) =>
      [...pages].filter((p) => p.is_deleted === 0).sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return b.created_at.localeCompare(a.created_at);
      });

    window.localStorage.removeItem(key);
    window.localStorage.removeItem("opennotion-current-page-id");

    window.openNotion = {
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        const pages = loadPages();

        if (cmd === "list_pages") return sortPages(pages);
        if (cmd === "list_all_pages") return pages;
        if (cmd === "get_page") return pages.find((p) => p.id === args.id) ?? null;

        if (cmd === "create_page") {
          const parentId = (args.parentId ?? args.parent_id ?? null) as string | null;
          const p: MockPage = {
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
          savePages([p, ...pages]);
          return p;
        }

        if (cmd === "create_project") {
          const minSort = pages
            .filter((p) => p.page_kind === "project")
            .reduce((min, p) => Math.min(min, p.sort_order), 0);
          const p: MockPage = {
            id: args.id as string,
            title: (args.title as string) || "Untitled project",
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
            sort_order: minSort - 1,
            page_kind: "project",
            created_at: args.createdAt as string,
            updated_at: args.createdAt as string,
          };
          savePages([p, ...pages]);
          return p;
        }

        if (cmd === "update_page") {
          const id = args.id as string;
          const updates = args.updates as Partial<MockPage>;
          savePages(pages.map((p) => (p.id === id ? { ...p, ...updates, updated_at: args.updatedAt as string } : p)));
          return null;
        }

        if (cmd === "move_page") {
          const id = args.id as string;
          const parentId = (args.parentId ?? args.parent_id ?? null) as string | null;
          savePages(pages.map((p) => (p.id === id ? { ...p, parent_id: parentId, updated_at: args.updatedAt as string } : p)));
          return null;
        }

        if (cmd === "toggle_favorite") {
          const id = args.id as string;
          const isFavorite = args.isFavorite as boolean;
          savePages(pages.map((p) => (p.id === id ? { ...p, is_favorite: isFavorite ? 1 : 0 } : p)));
          return null;
        }

        if (cmd === "delete_project") {
          const id = args.id as string;
          savePages(
            pages
              .filter((p) => p.id !== id)
              .map((p) => (p.parent_id === id ? { ...p, parent_id: null } : p))
          );
          return null;
        }

        if (cmd === "delete_page") {
          const deleteIds = new Set<string>([args.id as string]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const p of pages) {
              if (p.parent_id && deleteIds.has(p.parent_id) && !deleteIds.has(p.id)) {
                deleteIds.add(p.id);
                changed = true;
              }
            }
          }
          savePages(pages.filter((p) => !deleteIds.has(p.id)));
          return null;
        }

        if (cmd === "reorder_pages") {
          const orderedIds = args.orderedIds as string[];
          const parentId = (args.parentId ?? null) as string | null;
          savePages(pages.map((p) => {
            if (p.parent_id !== parentId) return p;
            const idx = orderedIds.indexOf(p.id);
            return idx === -1 ? p : { ...p, sort_order: idx };
          }));
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
  }, storageKey);
});

function projectRow(page: import("@playwright/test").Page, title: string) {
  return page.locator(".on-sidebar-project-row", { hasText: title });
}

function sidebarPageRow(page: import("@playwright/test").Page, title: string) {
  return page.locator(".on-sidebar-page-row:not(.on-sidebar-project-row)", { hasText: title });
}

test("creates a project from the sidebar section button", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Projects section should show "No projects" initially
  await expect(page.getByText("No projects")).toBeVisible();

  // Click the "New project" button in the Projects section heading
  await page.getByRole("button", { name: "New project" }).click();

  // A project row should appear (rename mode is activated, so an input is visible)
  const renameInput = page.locator(".on-sidebar-project-row .on-sidebar-rename-input");
  await expect(renameInput).toBeVisible({ timeout: 5_000 });

  // Confirm rename with a custom title
  await renameInput.fill("My Research");
  await renameInput.press("Enter");

  // The project row should now show the title
  await expect(projectRow(page, "My Research")).toBeVisible();
  await expect(page.getByText("No projects")).not.toBeVisible();
});

test("renames a project via context menu", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Create a project first
  await page.getByRole("button", { name: "New project" }).click();
  const renameInput = page.locator(".on-sidebar-project-row .on-sidebar-rename-input");
  await expect(renameInput).toBeVisible({ timeout: 5_000 });
  await renameInput.fill("Old Name");
  await renameInput.press("Enter");
  await expect(projectRow(page, "Old Name")).toBeVisible();

  // Right-click to open context menu
  await projectRow(page, "Old Name").click({ button: "right" });
  await expect(page.getByText("Rename")).toBeVisible();
  await page.getByText("Rename").click();

  // Rename input should appear again
  const renameInput2 = page.locator(".on-sidebar-project-row .on-sidebar-rename-input");
  await expect(renameInput2).toBeVisible({ timeout: 5_000 });
  await renameInput2.fill("New Name");
  await renameInput2.press("Enter");

  await expect(projectRow(page, "New Name")).toBeVisible();
  await expect(projectRow(page, "Old Name")).not.toBeVisible();
});

test("adds a page inside a project via context menu", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Create project
  await page.getByRole("button", { name: "New project" }).click();
  const renameInput = page.locator(".on-sidebar-project-row .on-sidebar-rename-input");
  await expect(renameInput).toBeVisible({ timeout: 5_000 });
  await renameInput.fill("Study");
  await renameInput.press("Enter");
  await expect(projectRow(page, "Study")).toBeVisible();

  // Right-click project → New page
  await projectRow(page, "Study").click({ button: "right" });
  const newPageMenuItem = page.locator(".on-menu-item", { hasText: "New page" });
  await expect(newPageMenuItem).toBeVisible();
  await newPageMenuItem.click();

  // The project should expand and a child page rename input should appear
  const childRenameInput = page.locator(".on-sidebar-project-children .on-sidebar-rename-input");
  await expect(childRenameInput).toBeVisible({ timeout: 5_000 });
  await childRenameInput.fill("Chapter 1");
  await childRenameInput.press("Enter");

  // Verify the child page is shown inside the project
  const projectChildren = page.locator(".on-sidebar-project-children-open");
  await expect(projectChildren).toBeVisible();
  await expect(projectChildren.getByText("Chapter 1")).toBeVisible();

  // Verify mock storage: child page has parent_id = project id
  const childParent = await page.evaluate((key) => {
    const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
    const child = pages.find((p) => p.title === "Chapter 1");
    const project = pages.find((p) => p.title === "Study");
    return { childParentId: child?.parent_id, projectId: project?.id };
  }, storageKey);

  expect(childParent.childParentId).toBe(childParent.projectId);
});

test("pins and unpins a project", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Create project
  await page.getByRole("button", { name: "New project" }).click();
  const renameInput = page.locator(".on-sidebar-project-row .on-sidebar-rename-input");
  await expect(renameInput).toBeVisible({ timeout: 5_000 });
  await renameInput.fill("Pinned Project");
  await renameInput.press("Enter");
  await expect(projectRow(page, "Pinned Project")).toBeVisible();

  // Right-click → Add to Favorites
  await projectRow(page, "Pinned Project").click({ button: "right" });
  await page.getByText("Add to Favorites").click();

  // Should appear in the Pinned section now
  // Wait for the mock to update and re-render
  await page.waitForTimeout(300);

  // Verify in storage that is_favorite is 1
  const favState = await page.evaluate((key) => {
    const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
    return pages.find((p) => p.title === "Pinned Project")?.is_favorite;
  }, storageKey);
  expect(favState).toBe(1);

  // Unpin: right-click → Remove from Favorites
  await projectRow(page, "Pinned Project").first().click({ button: "right" });
  await page.getByText("Remove from Favorites").click();
  await page.waitForTimeout(300);

  const unfavState = await page.evaluate((key) => {
    const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
    return pages.find((p) => p.title === "Pinned Project")?.is_favorite;
  }, storageKey);
  expect(unfavState).toBe(0);
});

test("deletes a project and reparents children to root", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Create project
  await page.getByRole("button", { name: "New project" }).click();
  const renameInput = page.locator(".on-sidebar-project-row .on-sidebar-rename-input");
  await expect(renameInput).toBeVisible({ timeout: 5_000 });
  await renameInput.fill("Doomed Project");
  await renameInput.press("Enter");
  await expect(projectRow(page, "Doomed Project")).toBeVisible();

  // Add a page inside
  await projectRow(page, "Doomed Project").click({ button: "right" });
  await page.locator(".on-menu-item", { hasText: "New page" }).click();
  const childRenameInput = page.locator(".on-sidebar-project-children .on-sidebar-rename-input");
  await expect(childRenameInput).toBeVisible({ timeout: 5_000 });
  await childRenameInput.fill("Orphan Page");
  await childRenameInput.press("Enter");

  // Verify child is inside the project
  await expect(page.locator(".on-sidebar-project-children-open").getByText("Orphan Page")).toBeVisible();

  // Right-click project → Delete
  await projectRow(page, "Doomed Project").click({ button: "right" });
  await page.locator(".on-menu-item-danger").click();

  // Confirm delete dialog
  const confirmButton = page.getByRole("button", { name: "Delete" });
  await expect(confirmButton).toBeVisible({ timeout: 3_000 });
  await confirmButton.click();

  // The project should be gone
  await expect(projectRow(page, "Doomed Project")).not.toBeVisible();

  // The orphan page should now be in the root Pages section
  await expect(sidebarPageRow(page, "Orphan Page")).toBeVisible();

  // Verify mock storage: orphan page has parent_id = null
  const orphanParent = await page.evaluate((key) => {
    const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
    return pages.find((p) => p.title === "Orphan Page")?.parent_id;
  }, storageKey);
  expect(orphanParent).toBeNull();
});

test("move page into project via page context menu", async ({ page }) => {
  // Seed a root page via localStorage before navigating
  await page.addInitScript((key) => {
    const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
    const seeded: MockPage = {
      id: "loose-page",
      title: "Loose Page",
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
      created_at: "2026-06-14T10:00:00.000Z",
      updated_at: "2026-06-14T10:00:00.000Z",
    };
    window.localStorage.setItem(key, JSON.stringify([seeded, ...pages]));
  }, storageKey);

  await page.goto("/", { waitUntil: "domcontentloaded" });

  // The loose page should be visible in the sidebar
  await expect(sidebarPageRow(page, "Loose Page")).toBeVisible();

  // Create a project
  await page.getByRole("button", { name: "New project" }).click();
  const renameInput = page.locator(".on-sidebar-project-row .on-sidebar-rename-input");
  await expect(renameInput).toBeVisible({ timeout: 5_000 });
  await renameInput.fill("Target Project");
  await renameInput.press("Enter");
  await expect(projectRow(page, "Target Project")).toBeVisible();

  // Right-click the loose page → Move
  const pageRow = sidebarPageRow(page, "Loose Page");
  await pageRow.click({ button: "right" });
  await page.locator(".on-page-action-popover .on-menu-item", { hasText: "Move" }).click();

  // The move popover should show the project as target
  // The move menu is a separate portal with class `on-popover` (z-[130])
  const moveTarget = page.locator(".on-popover .on-menu-item", { hasText: "Target Project" });
  await expect(moveTarget).toBeVisible({ timeout: 5_000 });
  await moveTarget.click();

  // Verify in storage: page was moved into the project
  const movedParent = await page.evaluate((key) => {
    const pages = JSON.parse(window.localStorage.getItem(key) ?? "[]") as MockPage[];
    const loosePage = pages.find((p) => p.title === "Loose Page");
    const project = pages.find((p) => p.title === "Target Project");
    return { parentId: loosePage?.parent_id, projectId: project?.id };
  }, storageKey);
  expect(movedParent.parentId).toBe(movedParent.projectId);
});

