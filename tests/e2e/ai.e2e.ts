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

const storageKey = "opennotion-e2e-ai-pages";
const keyStorageKey = "opennotion-e2e-ai-key";

async function openAiFromCommandPalette(page: Page) {
  await page.keyboard.press("Meta+K");
  await expect(page.getByPlaceholder("Search pages...")).toBeFocused();
  await page.locator(".on-command-panel").getByText("Ask AI", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Close AI" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ storageKey, keyStorageKey }) => {
    const loadPages = (): MockPage[] => JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    const savePages = (pages: MockPage[]) => window.localStorage.setItem(storageKey, JSON.stringify(pages));
    const sortPages = (pages: MockPage[]) =>
      [...pages].filter((page) => page.is_deleted === 0).sort((first, second) => first.sort_order - second.sort_order);
    let callbackCounter = 0;

    window.localStorage.removeItem(storageKey);
    window.localStorage.removeItem(keyStorageKey);
    window.localStorage.removeItem("opennotion-current-page-id");

    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => {
        callbackCounter += 1;
        return callbackCounter;
      },
      unregisterCallback: () => undefined,
      convertFileSrc: (filePath: string) => filePath,
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        const pages = loadPages();

        if (cmd === "list_pages" || cmd === "list_all_pages") return sortPages(pages);

        if (cmd === "get_page") return pages.find((page) => page.id === args.id) ?? null;

        if (cmd === "create_page") {
          const page: MockPage = {
            id: args.id as string,
            title: (args.title as string) || "Untitled",
            parent_id: (args.parentId ?? args.parent_id ?? null) as string | null,
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

        if (cmd === "search_pages") return [];
        if (cmd === "show_character_palette") return null;
        if (cmd === "cancel_ai_generation") return null;

        if (cmd === "get_ai_settings") {
          return {
            provider: "openrouter",
            model: "moonshotai/kimi-k2.6:free",
            trusted_mode_enabled: false,
            has_api_key: window.localStorage.getItem(keyStorageKey) === "saved",
          };
        }

        if (cmd === "get_ai_models") {
          return [
            { id: "moonshotai/kimi-k2.6:free", label: "Kimi K2.6 Free", context_length: 131072 },
            { id: "deepseek/deepseek-v4-flash:free", label: "DeepSeek V4 Flash Free", context_length: 65536 },
            { id: "qwen/qwen3-235b-a22b:free", label: "Qwen3 235B A22B Free", context_length: 40960 },
          ];
        }

        if (cmd === "save_ai_api_key") {
          window.localStorage.setItem(keyStorageKey, "saved");
          return {
            provider: "openrouter",
            model: "moonshotai/kimi-k2.6:free",
            trusted_mode_enabled: false,
            has_api_key: true,
          };
        }

        if (cmd === "clear_ai_api_key") {
          window.localStorage.removeItem(keyStorageKey);
          return {
            provider: "openrouter",
            model: "moonshotai/kimi-k2.6:free",
            trusted_mode_enabled: false,
            has_api_key: false,
          };
        }

        if (cmd === "update_ai_settings") {
          return {
            ...(args.settings as Record<string, unknown>),
            has_api_key: window.localStorage.getItem(keyStorageKey) === "saved",
          };
        }

        if (cmd === "generate_ai_action_plan" || cmd === "generate_ai_action_plan_streaming") {
          return {
            version: 1,
            summary: "Create a study page.",
            requires_confirmation: true,
            actions: [
              {
                type: "create_page",
                title: "AI Study Plan",
                parent_id: (args.request as { current_page_id?: string | null }).current_page_id ?? null,
                content_blocks: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Generated by AI.", styles: {} }],
                  },
                ],
              },
            ],
          };
        }

        if (cmd === "apply_ai_action_plan") {
          const plan = args.plan as { actions: Array<{ type: string; title?: string; parent_id?: string | null; content_blocks?: unknown[] }> };
          // Mirror the backend: search_text is plain extracted text (not raw
          // block JSON) and the timestamp comes from the caller's createdAt.
          const searchTextFromBlocks = (blocks: unknown[] | undefined): string =>
            (Array.isArray(blocks) ? blocks : [])
              .map((block) => {
                const content = (block as { content?: unknown }).content;
                return Array.isArray(content)
                  ? content.map((item) => (typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "")).join(" ")
                  : "";
              })
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
          const createdAt = (args.createdAt as string) ?? "2026-05-31T00:00:00.000Z";
          const created: string[] = [];
          const nextPages = [...pages];
          for (const action of plan.actions) {
            if (action.type !== "create_page") continue;
            const id = `ai-page-${created.length + 1}`;
            created.push(id);
            const searchText = searchTextFromBlocks(action.content_blocks);
            nextPages.unshift({
              id,
              title: action.title ?? "AI Page",
              parent_id: action.parent_id ?? null,
              content: JSON.stringify(action.content_blocks ?? []),
              search_text: searchText.length > 0 ? searchText : null,
              icon: null,
              cover_url: null,
              is_deleted: 0,
              is_favorite: 0,
              is_template: 0,
              is_database: 0,
              database_schema: null,
              properties: null,
              sort_order: -10 - created.length,
              page_kind: "note",
              created_at: createdAt,
              updated_at: createdAt,
            });
          }
          savePages(nextPages);
          return { created_page_ids: created, updated_page_ids: [], primary_page_id: created[0] ?? null };
        }

        throw new Error(`Unhandled e2e command: ${cmd}`);
      },
    };
  }, { storageKey, keyStorageKey });
});

test("opens AI from command palette and explains missing API key", async ({ page }) => {
  await page.goto("/");
  await openAiFromCommandPalette(page);

  await page.getByRole("textbox", { name: "Ask AI" }).fill("Create an exam tracker");
  await page.getByLabel("Send AI prompt").click();

  await expect(page.locator(".on-ai-chat-body").getByText("Add an OpenRouter API key in Settings before using AI.")).toBeVisible();
});

test("generates an AI create-only preview and applies it", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((key) => window.localStorage.setItem(key, "saved"), keyStorageKey);

  await page.getByText("Create first page").click();
  await expect(page.locator("textarea[placeholder='Untitled']")).toBeVisible();
  await page.locator("textarea[placeholder='Untitled']").fill("Physics");

  await openAiFromCommandPalette(page);
  await expect(page.getByText("Context: Physics")).toBeVisible();
  await page.getByRole("textbox", { name: "Ask AI" }).fill("Create a study page for this topic");
  await page.getByLabel("Send AI prompt").click();

  await expect(page.getByText("Create a study page.")).toBeVisible();
  await expect(page.locator(".on-ai-chat-body").getByText("Create page: AI Study Plan")).toBeVisible();
  // Plan preview now lists each action with a checkbox; apply the selected ones.
  await expect(page.locator(".on-ai-preview-checklist").getByText("Create page: AI Study Plan")).toBeVisible();
  await page.getByRole("button", { name: /Apply \d+ selected/i }).click();

  await expect(page.locator("textarea[placeholder='Untitled']")).toHaveValue("AI Study Plan");
  await expect(page.locator(".on-ai-chat-body").getByText("Applied 1 item.", { exact: true })).toBeVisible();
});
