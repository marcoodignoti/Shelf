import { expect, test } from "@playwright/test";
import { installMockBridge, type MockPage, type MockStudioDocument } from "./helpers/mockBridge";

const tinyPdfFixture = createBlankPdfFixture(1);

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

const mockProfile = {
  name: "Jane Doe",
  workspaceName: "Workspace Review",
  avatarPath: null,
};

const mockPages: MockPage[] = [
  {
    id: "home-page-id",
    title: "Home Page",
    parent_id: null,
    content: null,
    search_text: null,
    icon: "🏠",
    cover_url: null,
    is_deleted: 0,
    is_favorite: 0,
    is_template: 0,
    is_database: 0,
    database_schema: null,
    properties: null,
    sort_order: 0,
    page_kind: "note",
    created_at: "2026-06-17T10:00:00Z",
    updated_at: "2026-06-17T10:00:00Z",
  },
  {
    id: "note-1",
    title: "Project Proposal",
    parent_id: null,
    content: '[{"id":"1","type":"heading","content":[{"type":"text","text":"Project Overview","styles":{}}]},{"id":"2","type":"paragraph","content":[{"type":"text","text":"This is a text block.","styles":{}}]}]',
    search_text: "Project Overview This is a text block.",
    icon: "📄",
    cover_url: null,
    is_deleted: 0,
    is_favorite: 1,
    is_template: 0,
    is_database: 0,
    database_schema: null,
    properties: null,
    sort_order: 1,
    page_kind: "note",
    created_at: "2026-06-17T10:05:00Z",
    updated_at: "2026-06-17T10:05:00Z",
  },
  {
    id: "studio-note-1",
    title: "Study Guide Notes",
    parent_id: null,
    content: '[{"id":"3","type":"paragraph","content":[{"type":"text","text":"Taking some notes next to the PDF...","styles":{}}]}]',
    search_text: "Taking some notes next to the PDF...",
    icon: "📚",
    cover_url: null,
    is_deleted: 0,
    is_favorite: 0,
    is_template: 0,
    is_database: 0,
    database_schema: null,
    properties: null,
    sort_order: 2,
    page_kind: "studio_note",
    created_at: "2026-06-17T10:10:00Z",
    updated_at: "2026-06-17T10:10:00Z",
  },
];

const mockDocuments: MockStudioDocument[] = [
  {
    id: "studio-note-1",
    title: "Study Guide",
    original_filename: "study-guide.pdf",
    stored_file_path: "/mock/study-guide.pdf",
    note_page_id: "studio-note-1",
    project_id: null,
    last_opened_at: "2026-06-17T10:10:00Z",
    viewer_zoom: 100,
    viewer_page: 1,
    panel_layout: "split",
    created_at: "2026-06-17T10:10:00Z",
    updated_at: "2026-06-17T10:10:00Z",
  },
];

test.beforeEach(async ({ page }) => {
  // Mock local PDF file request
  await page.route("**/study-guide.pdf*", async (route) => {
    await route.fulfill({
      body: tinyPdfFixture,
      contentType: "application/pdf",
    });
  });

  // Clear storage and explicitly force English locale and Home view routing to keep screenshots fully deterministic
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("opennotion-locale", "en");
    window.localStorage.setItem("opennotion-current-page-id", "__opennotion_home__");
  });
});

test.describe("Visual Regression Tests", () => {
  // Helper to standardise viewport size and styles for screenshots
  async function preparePageForScreenshot(page: any) {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Inject stylesheet to prevent visual flakiness from carets or animations
    await page.addStyleTag({
      content: `
        * {
          caret-color: transparent !important;
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `,
    });
  }

  test("Home Dashboard layout is visually correct", async ({ page }) => {
    await installMockBridge(page, {
      profile: mockProfile,
      initialPages: mockPages,
      initialStudioDocuments: mockDocuments,
    });

    await page.addInitScript(() => {
      window.localStorage.setItem("opennotion-locale", "en");
      window.localStorage.setItem("opennotion-current-page-id", "__opennotion_home__");
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Recent pages")).toBeVisible();
    await expect(page.getByText("Favorites")).toBeVisible();

    await preparePageForScreenshot(page);

    // Assert screen matches baseline
    await expect(page).toHaveScreenshot("home-dashboard.png", { animations: "disabled" });
  });

  test("Page Editor view layout is visually correct", async ({ page }) => {
    await installMockBridge(page, {
      profile: mockProfile,
      initialPages: mockPages,
      initialStudioDocuments: mockDocuments,
    });

    // Seed active page ID in local storage before navigating
    await page.addInitScript(() => {
      window.localStorage.setItem("opennotion-locale", "en");
      window.localStorage.setItem("opennotion-current-page-id", "note-1");
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    
    // Wait for the editor and page details to load
    await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();
    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
    
    // Use precise CSS selector to target H1 editor block directly, preventing outline duplication strict errors
    await expect(page.locator("h1.bn-inline-content")).toHaveText("Project Overview");

    await preparePageForScreenshot(page);

    await expect(page).toHaveScreenshot("editor-page.png", { animations: "disabled" });
  });

  test("Studio Split View layout is visually correct", async ({ page }) => {
    await installMockBridge(page, {
      profile: mockProfile,
      initialPages: mockPages,
      initialStudioDocuments: mockDocuments,
    });

    await page.addInitScript(() => {
      window.localStorage.setItem("opennotion-locale", "en");
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Click on Study Guide Notes row directly (Study Guide folder is expanded by default on fresh localStorage)
    const noteRow = page.locator(".on-studio-note-tree-row", { hasText: "Study Guide Notes" });
    await expect(noteRow).toBeVisible();
    await noteRow.click();

    // Wait for split panels and canvas helper elements to load
    await expect(page.locator('[contenteditable="true"]').first()).toBeVisible();
    await expect(page.getByText("Taking some notes next to the PDF...")).toBeVisible();
    
    // Wait for PDF view elements by checking the page total indicator
    await expect(page.locator(".on-studio-page-total", { hasText: "1" })).toBeVisible();

    await preparePageForScreenshot(page);

    await expect(page).toHaveScreenshot("studio-split-view.png", { animations: "disabled" });
  });
});
