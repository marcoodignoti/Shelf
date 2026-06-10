import { expect, test, type Page } from "@playwright/test";

// Profiling spec for Studio PDF behavior across document sizes (#49).
// Not a budget gate: it prints measurements for docs/perf notes. Run with:
//   npx playwright test --config playwright.perf.config.ts pdf-profile
//
// The fixtures are text-heavy synthetic PDFs so pdf.js does real text layout
// and glyph rasterization work, unlike the blank-page fixtures in the
// functional suite. Scanned/image PDFs will be slower per page than these
// numbers; treat the measurements as a text-document baseline.

const LINES_PER_PAGE = 42;

function createTextPdfFixture(pageCount: number): Buffer {
  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const fontObjectId = 1;
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let nextId = 2;
  const contentIds: number[] = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const lines: string[] = [];
    for (let line = 0; line < LINES_PER_PAGE; line += 1) {
      lines.push(
        `(Page ${pageIndex + 1} line ${line + 1}: lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.) Tj T*`
      );
    }
    const stream = `BT /F1 11 Tf 14 TL 50 760 Td\n${lines.join("\n")}\nET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    contentIds.push(nextId);
    nextId += 1;
  }

  const pagesId = nextId;
  nextId += 1;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    objects.push(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentIds[pageIndex]} 0 R >>`
    );
    pageObjectIds.push(nextId);
    nextId += 1;
  }
  objects.splice(
    pagesId - 1,
    0,
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`
  );
  const catalogId = nextId;
  objects.push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

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
  body += `trailer\n<< /Root ${catalogId} 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}

async function setupStudioMock(page: Page) {
  await page.addInitScript(() => {
    const documentsKey = "opennotion-profile-documents";
    window.localStorage.clear();
    const load = (): unknown[] => JSON.parse(window.localStorage.getItem(documentsKey) ?? "[]");
    const save = (value: unknown[]) => window.localStorage.setItem(documentsKey, JSON.stringify(value));

    window.openNotion = {
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "list_pages" || cmd === "list_all_pages") return [];
        if (cmd === "get_page") return null;
        if (cmd === "list_studio_documents") return load();
        if (cmd === "list_studio_projects") return [];
        if (cmd === "list_all_studio_document_page_links" || cmd === "list_studio_document_page_links") return [];
        if (cmd === "import_studio_document") {
          const document = {
            id: args.documentId as string,
            title: "profile",
            original_filename: "profile.pdf",
            stored_file_path: "/tmp/profile.pdf",
            note_page_id: args.notePageId as string,
            project_id: null,
            last_opened_at: args.importedAt as string,
            viewer_zoom: 100,
            viewer_page: 1,
            panel_layout: "pdf-left",
            created_at: args.importedAt as string,
            updated_at: args.importedAt as string,
          };
          save([document]);
          return document;
        }
        if (cmd === "create_page") {
          return {
            id: args.id, title: args.title ?? "Untitled", parent_id: null, content: null,
            search_text: null, icon: null, cover_url: null, is_deleted: 0, is_favorite: 0,
            is_template: 0, is_database: 0, database_schema: null, properties: null,
            sort_order: 0, page_kind: "studio_note", created_at: args.createdAt, updated_at: args.createdAt,
          };
        }
        if (cmd === "update_studio_document_viewer_state") {
          const documents = load() as Array<Record<string, unknown>>;
          save(documents.map((document) => document.id === args.id ? { ...document, ...(args.updates as object) } : document));
          return null;
        }
        if (cmd === "update_page") return null;
        throw new Error(`Unhandled profile command: ${cmd}`);
      },
      open: async () => "/tmp/profile.pdf",
      save: async () => null,
      fileSrc: (filePath: string) => filePath,
    };
  });
}

type SizeSpec = { label: string; pages: number };
const SIZES: SizeSpec[] = [
  { label: "small", pages: 10 },
  { label: "medium", pages: 120 },
  { label: "large", pages: 800 },
];

for (const size of SIZES) {
  test(`profiles a ${size.label} PDF (${size.pages} pages)`, async ({ page }) => {
    const fixture = createTextPdfFixture(size.pages);
    await setupStudioMock(page);
    await page.route("**/profile.pdf*", async (route) => {
      await route.fulfill({ body: fixture, contentType: "application/pdf" });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Studio" }).click();

    // Parse: import click until the page counter knows the page count.
    const parseStart = Date.now();
    await page.getByRole("button", { name: "Import PDF" }).click();
    await expect(page.locator(".on-studio-page-total", { hasText: String(size.pages) }))
      .toBeVisible({ timeout: 90_000 });
    const parseMs = Date.now() - parseStart;

    // First render: first page canvas blitted.
    await expect(page.locator("[data-pdf-page='1']")).toHaveAttribute("data-pdf-rendered", "true", { timeout: 60_000 });
    const firstRenderMs = Date.now() - parseStart;

    // Page navigation latency in single-page mode (median-ish over 5 turns).
    await page.getByTitle("PDF view options").click();
    await page.getByRole("menuitemradio", { name: "Single page" }).click();
    await expect(page.locator("[data-pdf-page='1']")).toHaveAttribute("data-pdf-rendered", "true");
    const navSamples: number[] = [];
    for (let turn = 1; turn <= 5; turn += 1) {
      const navStart = Date.now();
      await page.getByTitle("Next page").click();
      await expect(page.locator(`[data-pdf-page='${turn + 1}']`)).toHaveAttribute("data-pdf-rendered", "true");
      navSamples.push(Date.now() - navStart);
    }
    const navAvgMs = Math.round(navSamples.reduce((sum, value) => sum + value, 0) / navSamples.length);

    // Zoom latency: one zoom-out until re-rendered at the new zoom.
    const zoomStart = Date.now();
    await page.getByTitle("Zoom out").click();
    await expect(page.locator("[data-pdf-page='6']")).toHaveAttribute("data-pdf-rendered", "true");
    const zoomMs = Date.now() - zoomStart;

    // Continuous mode: scroll through the document, then check that canvas
    // bitmaps stay bounded (off-screen pages release their memory) and read
    // the JS heap.
    await page.getByTitle("PDF view options").click();
    await page.getByRole("menuitemradio", { name: "Continuous scroll" }).click();
    const viewer = page.locator("[data-pdf-view-mode='continuous']");
    await expect(viewer).toBeVisible();
    const scrollSteps = Math.min(40, size.pages);
    for (let step = 1; step <= scrollSteps; step += 1) {
      await viewer.evaluate((element, ratio) => {
        element.scrollTop = (element.scrollHeight - element.clientHeight) * ratio;
      }, step / scrollSteps);
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(1_000);

    const canvasStats = await viewer.evaluate((element) => {
      const canvases = Array.from(element.querySelectorAll("canvas"));
      return {
        total: canvases.length,
        live: canvases.filter((canvas) => canvas.width > 0).length,
      };
    });
    const heapMb = await page.evaluate(() => {
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      return memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : -1;
    });

    console.log(
      `PDFPROFILE label=${size.label} pages=${size.pages} fixtureKb=${Math.round(fixture.length / 1024)} ` +
      `parseMs=${parseMs} firstRenderMs=${firstRenderMs} navAvgMs=${navAvgMs} zoomMs=${zoomMs} ` +
      `canvasesLive=${canvasStats.live}/${canvasStats.total} heapMb=${heapMb}`
    );

    // Sanity floor, not a budget: bitmap release must keep live canvases
    // bounded on large documents.
    if (size.pages >= 120) {
      expect(canvasStats.live).toBeLessThan(size.pages / 2);
    }
  });
}
