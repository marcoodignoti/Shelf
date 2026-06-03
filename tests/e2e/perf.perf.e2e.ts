import { expect, test, type CDPSession, type Page } from "@playwright/test";

// Budgets — set from the first measured run on the reference machine
// (measured * ~1.5). Record values in perf/README.md.
//
// STARTUP_BUDGET_MS is a coarse Node-side Date.now() measure wrapping
// page.goto("/", { waitUntil: "domcontentloaded" }) + waitFor(CTA visible). It includes Playwright IPC overhead,
// navigation latency, and poll interval — it is NOT a pure browser
// navigationStart→DCL timing. Used as a manual pre-release gate only (not CI).
const STARTUP_BUDGET_MS = 700; // baseline ~428 ms on ref machine; ×1.5 headroom for noise
const HEAP_DELTA_BUDGET_BYTES = 7 * 1024 * 1024; // baseline ~4.5 MB on ref machine; ×1.3 = ~7 MB
const EDIT_CYCLES = 200;

// Minimal desktop bridge mock mirroring tests/e2e/persistence.e2e.ts: persistence
// is backed by localStorage so React + BlockNote render for real while the
// native backend is absent. This measures FRONTEND cost only.
async function installDesktopMock(page: Page) {
  await page.addInitScript(() => {
    const storageKey = "opennotion-perf-pages";

    type MockPage = Record<string, unknown> & { id: string };

    const loadPages = (): MockPage[] =>
      JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    const savePages = (pages: MockPage[]) =>
      window.localStorage.setItem(storageKey, JSON.stringify(pages));

    window.localStorage.removeItem(storageKey);
    window.localStorage.removeItem("opennotion-current-page-id");

    window.openNotion = {
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        const now = new Date().toISOString();
        const pages = loadPages();

        if (cmd === "list_pages") {
          return pages.filter((p) => p["is_deleted"] === 0);
        }
        if (cmd === "list_all_pages") {
          return pages;
        }
        if (cmd === "get_page") {
          return pages.find((p) => p.id === args["id"]) ?? null;
        }
        if (cmd === "create_page") {
          const page: MockPage = {
            id: args["id"] as string,
            title: (args["title"] as string) || "Untitled",
            parent_id: (args["parentId"] ?? args["parent_id"] ?? null) as
              | string
              | null,
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
            created_at: (args["createdAt"] as string) ?? now,
            updated_at: (args["createdAt"] as string) ?? now,
          };
          savePages([page, ...pages]);
          return page;
        }
        if (cmd === "update_page") {
          const id = args["id"] as string;
          const updates = args["updates"] as Partial<MockPage>;
          savePages(
            pages.map((p) =>
              p.id === id
                ? { ...p, ...updates, updated_at: (args["updatedAt"] as string) ?? now }
                : p,
            ),
          );
          return null;
        }
        // Permissive default so unmodeled commands don't reject and skew timing.
        return null;
      },
      open: async () => null,
      save: async () => null,
      fileSrc: (filePath: string) => filePath,
    };
  });
}

async function jsHeapUsedBytes(
  _page: Page,
  client: CDPSession,
): Promise<number> {
  // Force GC so the delta reflects retained (leaked) memory, not garbage.
  await client.send("HeapProfiler.collectGarbage");
  const { metrics } = await client.send("Performance.getMetrics");
  const heap = (metrics as Array<{ name: string; value: number }>).find(
    (m) => m.name === "JSHeapUsedSize",
  );
  return heap?.value ?? 0;
}

test("startup to first interactive render is within budget", async ({
  page,
}) => {
  await installDesktopMock(page);
  const start = Date.now();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByText("Create first page").waitFor({ state: "visible" });
  const elapsed = Date.now() - start;
  console.log(`PERF startup: ${elapsed} ms`);
  expect(elapsed).toBeLessThanOrEqual(STARTUP_BUDGET_MS);
});

test("editing churn does not leak JS heap", async ({ page }) => {
  await installDesktopMock(page);
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByText("Create first page").click();
  const titleInput = page.locator("textarea[placeholder='Untitled']");
  await expect(titleInput).toBeVisible();
  await titleInput.fill("Heap churn");
  await titleInput.press("Enter");
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeFocused();

  const before = await jsHeapUsedBytes(page, client);
  for (let i = 0; i < EDIT_CYCLES; i++) {
    // Re-assert focus every 50 cycles: a debounced save re-render can steal
    // focus, causing pressSequentially to silently type into nothing and make
    // the heap delta meaningless. Re-click to restore focus if needed.
    if (i % 50 === 0 && i > 0) {
      const isFocused = await editor.evaluate(
        (el) => el === document.activeElement,
      );
      if (!isFocused) {
        await editor.click();
      }
      await expect(editor).toBeFocused();
    }
    await editor.pressSequentially(`line ${i} `, { delay: 0 });
    await editor.press("Enter");
  }
  const after = await jsHeapUsedBytes(page, client);

  const delta = after - before;
  console.log(`PERF heap delta: ${delta} bytes over ${EDIT_CYCLES} cycles`);
  expect(delta).toBeLessThanOrEqual(HEAP_DELTA_BUDGET_BYTES);
});
