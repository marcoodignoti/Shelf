# Store Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic `useAppStore` (785 lines) into an isolated `useUIStore` plus a slice-organized domain store, with no behavior change.

**Architecture:** Safety-net-first. Step 0 adds characterization tests pinning the risky cross-slice optimistic-update flows. Step 1 extracts a standalone `useUIStore` for device preferences. Step 2 reorganizes the domain store internals into `sharedSlice` + `pagesSlice` + `studioSlice` + `profileSlice` using the Zustand slice pattern (`StateCreator<AppState, ...>` typed against the full state so cross-slice `get()` calls keep working). The public `useAppStore` API never changes after Step 1.

**Tech Stack:** React 19, Zustand 5.0.13 (`create` from `'zustand'`), TypeScript strict, Vitest (`environment: node`, `pool: vmForks`).

**Spec:** `docs/superpowers/specs/2026-06-16-store-split-design.md`

**Reference doc for conventions:** `AGENTS.md` (optimistic-update pattern; "add new backend calls as typed wrappers, not inline").

---

## File Structure (final)

```
src/store/
  useAppStore.ts          # composed create(), AppState interface, re-exports types
  useUIStore.ts           # isolated UI prefs + exported Theme type
  useUIStore.test.ts      # pref round-trip tests (moved from Step 0 suite)
  useAppStore.test.ts     # cross-slice characterization tests
  slices/
    sharedSlice.ts        # notice/error/palette/nav-setters
    pagesSlice.ts         # pages[] + page CRUD + project actions
    studioSlice.ts        # studioDocuments[] + links + studio actions
    profileSlice.ts       # profile + profile actions
    helpers.ts            # pageTreeIds (dedup), logStoreError, getStoredPageId
```

Consumer migration (Step 1 only) touches these files, replacing `useAppStore` → `useUIStore` for UI-pref selectors:

- `src/App.tsx` — `theme`, `localePreference`
- `src/components/Layout.tsx` — `isSidebarOpen`, `sidebarWidth`, `toggleSidebar`
- `src/components/PageEditor.tsx` — `theme`, `isSidebarOpen`, `editorFont`, `editorFontSize`, `pageWidth`, `titleEnterBehavior`
- `src/components/StudioWorkspace.tsx` — `isSidebarOpen`
- `src/components/settings/AppearanceSection.tsx` — `theme`, `setTheme`, `editorFont`, `setEditorFont`, `editorFontSize`, `setEditorFontSize`
- `src/components/settings/PreferencesSection.tsx` — `localePreference`, `setLocalePreference`, `titleEnterBehavior`, `setTitleEnterBehavior`, `pageWidth`, `setPageWidth`
- `src/lib/i18n.ts` — `localePreference` (the `useLocale()` hook)
- `src/lib/i18n.test.ts` — its `useAppStore` mock

**Note on branch:** We are on `refactor/store-split-design` (created for the spec). Continue on this branch for all tasks. Each task ends with a commit.

---

## Task 1: Characterization test harness (failing shell)

**Files:**
- Create: `src/store/useAppStore.test.ts` (already present in the working tree as an untracked file)

- [ ] **Step 1: Ensure the test harness is in place**

`src/store/useAppStore.test.ts` should already contain the harness below. If it does not, create it with this content:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "../lib/db";
import type { StudioDocument, StudioDocumentPageLink } from "../lib/studio";

/**
 * Characterization tests for useAppStore's cross-slice optimistic-update flows.
 * These pin current behavior so the store split is provably behavior-preserving.
 *
 * Harness: mock window.openNotion.invoke to record calls + return canned data.
 * The store is reset between tests via vi.resetModules() + dynamic import.
 */

interface InvokeCall {
  command: string;
  args: Record<string, unknown>;
}

type InvokeHandler = (call: InvokeCall) => unknown;

interface FakeBridgeOptions {
  invokeHandler?: InvokeHandler;
}

function installFakeBridge(options: FakeBridgeOptions = {}) {
  const calls: InvokeCall[] = [];
  const handler = options.invokeHandler ?? (() => undefined);
  const fakeBridge = {
    invoke: vi.fn(async (command: string, args: Record<string, unknown>) => {
      const call = { command, args: args ?? {} };
      calls.push(call);
      return handler(call);
    }),
    onDesktopUpdate: () => () => {},
    fileSrc: (p: string) => `app://asset/${p}`,
    studioPdfSrc: (id: string) => `http://localhost/studio/${id}`,
    importStudioDocument: vi.fn(() => Promise.resolve(null)),
    replaceStudioDocumentFile: vi.fn(() => Promise.resolve(null)),
    importProfileAvatar: vi.fn(() => Promise.resolve(null)),
    exportFiles: vi.fn(() => Promise.resolve(null)),
    importPageFile: vi.fn(() => Promise.resolve(null)),
  };
  (globalThis as { window: Record<string, unknown> }).window =
    (globalThis as { window?: Record<string, unknown> }).window ?? {};
  (globalThis as { window: Record<string, unknown> }).window.openNotion = fakeBridge;
  return { calls, fakeBridge };
}

function installLocalStorage() {
  const map = new Map<string, string>();
  const ls = {
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => { map.set(k, v); }),
    removeItem: vi.fn((k: string) => { map.delete(k); }),
    clear: vi.fn(() => map.clear()),
    key: vi.fn(() => null),
    get length() { return map.size; },
  };
  Object.defineProperty(globalThis, "localStorage", { value: ls, writable: true, configurable: true });
  return ls;
}

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: crypto.randomUUID(),
    title: "Untitled",
    parent_id: null,
    content: null,
    search_text: null,
    icon: null,
    cover_url: null,
    is_deleted: 0,
    is_favorite: 0,
    is_template: 0,
    sort_order: 0,
    page_kind: "note",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function loadStore() {
  vi.resetModules();
  const mod = await import("./useAppStore");
  return mod.useAppStore;
}

describe("useAppStore characterization harness", () => {
  beforeEach(() => {
    installLocalStorage();
    installFakeBridge();
  });

  it("initializes with no pages and a resolved current page id", async () => {
    const useAppStore = await loadStore();
    await useAppStore.getState().fetchPages();
    expect(useAppStore.getState().pages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: PASS (1 test). This confirms the harness works end-to-end: bridge mock, localStorage shim, and module reset all function.

- [ ] **Step 3: Commit**

```bash
git add src/store/useAppStore.test.ts
git commit -m "test: add useAppStore characterization harness"
```

---

## Task 2: Characterize `removePage` cross-slice cascade

**Files:**
- Modify: `src/store/useAppStore.test.ts`

- [ ] **Step 1: Add the test**

Append to the `describe("useAppStore characterization harness", ...)` block in `src/store/useAppStore.test.ts`, before its closing `});`:

```ts
  it("removePage cascades: removes subtree from pages, prunes studio links, refetches studio, recomputes currentPageId", async () => {
    const home = makePage({ id: "home", sort_order: 0 });
    const parent = makePage({ id: "parent", sort_order: 1 });
    const child = makePage({ id: "child", parent_id: "parent", sort_order: 0 });
    const linkPageId = "parent"; // a studio link references the parent page

    const allPages = [home, parent, child];
    let deleted = false;
    const baseHandler = (call: { command: string; args: Record<string, unknown> }): unknown => {
      switch (call.command) {
        case "list_pages": return deleted ? [home] : allPages;
        case "delete_page":
          deleted = true;
          return undefined;
        case "list_all_studio_document_page_links":
          return deleted ? [] : [
            { id: "link1", document_id: "doc1", page_id: linkPageId, pdf_page: null, label: null, sort_order: 0, created_at: "", updated_at: "", page: parent },
          ];
        case "list_studio_documents": return [];
        default: return undefined;
      }
    };
    installFakeBridge({ invokeHandler: baseHandler });

    const useAppStore = await loadStore();
    await useAppStore.getState().fetchPages();
    await useAppStore.getState().fetchStudioDocuments();
    useAppStore.getState().setCurrentPageId("parent");

    await useAppStore.getState().removePage("parent");

    const state = useAppStore.getState();
    expect(state.pages.find((p) => p.id === "parent")).toBeUndefined();
    expect(state.pages.find((p) => p.id === "child")).toBeUndefined();
    expect(state.pages.find((p) => p.id === "home")).toBeDefined();
    expect(state.studioDocumentPageLinks.find((l) => l.page_id === linkPageId)).toBeUndefined();
    expect(state.currentPageId).not.toBe("parent");
  });
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: PASS (2 tests). This pins the cascade behavior before any refactor.

- [ ] **Step 3: Commit**

```bash
git add src/store/useAppStore.test.ts
git commit -m "test: characterize removePage cross-slice cascade"
```

---

## Task 3: Characterize `renameStudioDocumentAction` title mirroring + rollback

**Files:**
- Modify: `src/store/useAppStore.test.ts`

- [ ] **Step 1: Add the test**

Append to the `describe` block in `src/store/useAppStore.test.ts`:

```ts
  it("renameStudioDocumentAction mirrors title onto the linked page (${title} Notes)", async () => {
    const notePageId = "note-page-1";
    const docPage = makePage({ id: notePageId, title: "Old Notes" });
    const baseHandler = (call: { command: string; args: Record<string, unknown> }): unknown => {
      switch (call.command) {
        case "list_pages": return [docPage];
        case "list_all_studio_document_page_links": return [];
        case "list_studio_documents": return [{
          id: "doc1", title: "Old", original_filename: "old.pdf",
          stored_file_path: "/x/old.pdf", note_page_id: notePageId, project_id: null,
          last_opened_at: "", viewer_zoom: 100, viewer_page: 1, panel_layout: "pdf-left",
          created_at: "", updated_at: "",
        }];
        case "rename_studio_document": return undefined;
        default: return undefined;
      }
    };
    installFakeBridge({ invokeHandler: baseHandler });

    const useAppStore = await loadStore();
    await useAppStore.getState().fetchPages();
    await useAppStore.getState().fetchStudioDocuments();

    await useAppStore.getState().renameStudioDocumentAction("doc1", "New Title");

    const state = useAppStore.getState();
    expect(state.studioDocuments[0].title).toBe("New Title");
    const linked = state.pages.find((p) => p.id === notePageId);
    expect(linked?.title).toBe("New Title Notes");
  });

  it("renameStudioDocumentAction rolls back both studioDocuments and pages on error", async () => {
    const notePageId = "note-page-2";
    const docPage = makePage({ id: notePageId, title: "Old Notes" });
    let shouldFail = false;
    const baseHandler = (call: { command: string; args: Record<string, unknown> }): unknown => {
      switch (call.command) {
        case "list_pages": return [docPage];
        case "list_all_studio_document_page_links": return [];
        case "list_studio_documents": return [{
          id: "doc2", title: "Old", original_filename: "old.pdf",
          stored_file_path: "/x/old.pdf", note_page_id: notePageId, project_id: null,
          last_opened_at: "", viewer_zoom: 100, viewer_page: 1, panel_layout: "pdf-left",
          created_at: "", updated_at: "",
        }];
        case "rename_studio_document":
          if (shouldFail) throw new Error("boom");
          return undefined;
        default: return undefined;
      }
    };
    installFakeBridge({ invokeHandler: baseHandler });

    const useAppStore = await loadStore();
    await useAppStore.getState().fetchPages();
    await useAppStore.getState().fetchStudioDocuments();
    const beforeDocs = useAppStore.getState().studioDocuments;
    const beforePages = useAppStore.getState().pages;

    shouldFail = true;
    await useAppStore.getState().renameStudioDocumentAction("doc2", "New Title");

    const state = useAppStore.getState();
    expect(state.studioDocuments).toEqual(beforeDocs);
    expect(state.pages.map((p) => p.title)).toEqual(beforePages.map((p) => p.title));
    expect(state.notice?.kind).toBe("error");
  });
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add src/store/useAppStore.test.ts
git commit -m "test: characterize renameStudioDocument mirroring + rollback"
```

---

## Task 4: Characterize remaining cross-slice flows

**Files:**
- Modify: `src/store/useAppStore.test.ts`

- [ ] **Step 1: Add the tests**

Append to the `describe` block in `src/store/useAppStore.test.ts`:

```ts
  it("addPage with {select: false} does not change currentPageId", async () => {
    const home = makePage({ id: "home" });
    installFakeBridge({
      invokeHandler: (call) => {
        if (call.command === "list_pages") return [home];
        if (call.command === "create_page") return makePage({ id: "new-page", title: "Untitled" });
        return undefined;
      },
    });

    const useAppStore = await loadStore();
    await useAppStore.getState().fetchPages();
    useAppStore.getState().setCurrentPageId("home");
    const before = useAppStore.getState().currentPageId;

    await useAppStore.getState().addPage("Untitled", null, { select: false });

    expect(useAppStore.getState().currentPageId).toBe(before);
    expect(useAppStore.getState().pages.find((p) => p.id === "new-page")).toBeDefined();
  });

  it("reorderPagesAction rolls back on error", async () => {
    const home = makePage({ id: "home" });
    const a = makePage({ id: "a", sort_order: 0 });
    const b = makePage({ id: "b", sort_order: 1 });
    let shouldFail = false;
    installFakeBridge({
      invokeHandler: (call) => {
        if (call.command === "list_pages") return [home, a, b];
        if (call.command === "reorder_pages" && shouldFail) throw new Error("boom");
        return undefined;
      },
    });

    const useAppStore = await loadStore();
    await useAppStore.getState().fetchPages();
    const before = useAppStore.getState().pages.map((p) => ({ id: p.id, sort_order: p.sort_order }));

    shouldFail = true;
    await useAppStore.getState().reorderPagesAction(null, ["b", "a"]);

    const after = useAppStore.getState().pages.map((p) => ({ id: p.id, sort_order: p.sort_order }));
    expect(after).toEqual(before);
    expect(useAppStore.getState().notice?.kind).toBe("error");
  });

  it("removePage failure rolls back pages and studio links", async () => {
    const home = makePage({ id: "home", sort_order: 0 });
    const parent = makePage({ id: "parent", sort_order: 1 });
    const child = makePage({ id: "child", parent_id: "parent", sort_order: 0 });
    const allPages = [home, parent, child];
    installFakeBridge({
      invokeHandler: (call) => {
        if (call.command === "list_pages") return allPages;
        if (call.command === "delete_page") throw new Error("boom");
        if (call.command === "list_all_studio_document_page_links") return [
          { id: "link1", document_id: "doc1", page_id: "parent", pdf_page: null, label: null, sort_order: 0, created_at: "", updated_at: "", page: parent },
        ];
        return undefined;
      },
    });

    const useAppStore = await loadStore();
    await useAppStore.getState().fetchPages();
    await useAppStore.getState().fetchStudioDocuments();
    const beforePages = useAppStore.getState().pages;
    const beforeLinks = useAppStore.getState().studioDocumentPageLinks;

    await useAppStore.getState().removePage("parent");

    const state = useAppStore.getState();
    expect(state.pages).toEqual(beforePages);
    expect(state.studioDocumentPageLinks).toEqual(beforeLinks);
    expect(state.notice?.kind).toBe("error");
  });

  it("removeProjectAction resets parent_id on orphaned pages and refetches links", async () => {
    const project = makePage({ id: "project", page_kind: "project", sort_order: 0 });
    const child = makePage({ id: "child", parent_id: "project", sort_order: 0 });
    let deleted = false;
    installFakeBridge({
      invokeHandler: (call) => {
        if (call.command === "list_pages") return deleted ? [child] : [project, child];
        if (call.command === "delete_project") {
          deleted = true;
          return undefined;
        }
        if (call.command === "list_all_studio_document_page_links") return [];
        return undefined;
      },
    });

    const useAppStore = await loadStore();
    await useAppStore.getState().fetchPages();
    useAppStore.getState().setCurrentPageId("project");

    await useAppStore.getState().removeProjectAction("project");

    const state = useAppStore.getState();
    const childPage = state.pages.find((p) => p.id === "child");
    expect(childPage?.parent_id).toBeNull();
    expect(state.pages.find((p) => p.id === "project")).toBeUndefined();
    expect(state.currentPageId).not.toBe("project");
  });

  it("importStudioPdfAction sets navigation for unified vs note-page documents", async () => {
    const unifiedDoc = {
      id: "unified", title: "Unified", original_filename: "u.pdf",
      stored_file_path: "/x/u.pdf", note_page_id: "unified", project_id: null,
      last_opened_at: "", viewer_zoom: 100, viewer_page: 1, panel_layout: "pdf-left",
      created_at: "", updated_at: "",
    };
    const noteDoc = {
      id: "doc1", title: "Doc", original_filename: "d.pdf",
      stored_file_path: "/x/d.pdf", note_page_id: "note-1", project_id: null,
      last_opened_at: "", viewer_zoom: 100, viewer_page: 1, panel_layout: "pdf-left",
      created_at: "", updated_at: "",
    };
    const notePage = makePage({ id: "note-1" });
    const { fakeBridge } = installFakeBridge({
      invokeHandler: (call) => {
        if (call.command === "list_pages") return [notePage];
        if (call.command === "list_all_studio_document_page_links") return [];
        if (call.command === "list_studio_documents") return [];
        return undefined;
      },
    });
    fakeBridge.importStudioDocument
      .mockResolvedValueOnce(unifiedDoc)
      .mockResolvedValueOnce(noteDoc);

    const useAppStore = await loadStore();
    await useAppStore.getState().fetchPages();

    await useAppStore.getState().importStudioPdfAction();
    let state = useAppStore.getState();
    expect(state.currentPageId).toBe("unified");
    expect(state.currentStudioDocumentId).toBeNull();

    await useAppStore.getState().importStudioPdfAction();
    state = useAppStore.getState();
    expect(state.currentPageId).not.toBe("doc1");
    expect(state.currentStudioDocumentId).toBe("doc1");
  });

  it("fetchStudioDocuments merges missing studio notes and dedups by id", async () => {
    const existingNote = makePage({ id: "note-1", title: "Existing Note" });
    const missingNote = makePage({ id: "note-2", title: "Missing Note" });
    const doc1 = {
      id: "doc1", title: "Doc 1", original_filename: "d1.pdf",
      stored_file_path: "/x/d1.pdf", note_page_id: "note-1", project_id: null,
      last_opened_at: "", viewer_zoom: 100, viewer_page: 1, panel_layout: "pdf-left",
      created_at: "", updated_at: "",
    };
    const doc2 = {
      id: "doc2", title: "Doc 2", original_filename: "d2.pdf",
      stored_file_path: "/x/d2.pdf", note_page_id: "note-2", project_id: null,
      last_opened_at: "", viewer_zoom: 100, viewer_page: 1, panel_layout: "pdf-left",
      created_at: "", updated_at: "",
    };
    installFakeBridge({
      invokeHandler: (call) => {
        if (call.command === "list_pages") return [existingNote];
        if (call.command === "get_page" && call.args.id === "note-2") return missingNote;
        if (call.command === "list_studio_documents") return [doc1, doc2];
        if (call.command === "list_all_studio_document_page_links") return [
          { id: "link1", document_id: "doc1", page_id: "note-1", pdf_page: null, label: null, sort_order: 0, created_at: "", updated_at: "", page: existingNote },
        ];
        return undefined;
      },
    });

    const useAppStore = await loadStore();
    await useAppStore.getState().fetchPages();

    await useAppStore.getState().fetchStudioDocuments();

    const state = useAppStore.getState();
    const noteIds = new Set(state.pages.map((p) => p.id));
    expect(noteIds.has("note-1")).toBe(true);
    expect(noteIds.has("note-2")).toBe(true);
    expect(state.pages.filter((p) => p.id === "note-1").length).toBe(1);
  });
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 3: Commit**

```bash
git add src/store/useAppStore.test.ts
git commit -m "test: characterize select:false, reorder rollback, and remaining cross-slice flows"
```

---

## Task 5: Deduplicate `pageTreeIds` / `descendantPageIds`

These two functions (`useAppStore.ts:111` and `:157`) are byte-for-byte identical today. Collapse to one.

**Files:**
- Modify: `src/store/useAppStore.ts`

- [ ] **Step 1: Remove the duplicate**

In `src/store/useAppStore.ts`, delete the `descendantPageIds` function (lines ~157-170):

```ts
function descendantPageIds(pages: Page[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const page of pages) {
      if (page.parent_id && ids.has(page.parent_id) && !ids.has(page.id)) {
        ids.add(page.id);
        changed = true;
      }
    }
  }
  return ids;
}
```

Keep `pageTreeIds` (lines ~111-124) unchanged.

- [ ] **Step 2: Update the call site**

In `src/store/useAppStore.ts`, in `removePage` (~line 629), change:

```ts
    const deletedIds = descendantPageIds(previousPages, id);
```

to:

```ts
    const deletedIds = pageTreeIds(previousPages, id);
```

- [ ] **Step 3: Run typecheck + tests**

Run: `npm run build`
Expected: succeeds (no `noUnusedLocals` error, no references to the deleted function).

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: PASS (10 tests) — the `removePage` cascade test exercises this path.

- [ ] **Step 4: Commit**

```bash
git add src/store/useAppStore.ts
git commit -m "refactor: deduplicate pageTreeIds/descendantPageIds"
```

---

## Task 6: Create `useUIStore` and extract UI preferences

This is the core of Step 1. Extract all UI prefs into a standalone store; the domain store keeps everything else.

**Files:**
- Create: `src/store/useUIStore.ts`
- Modify: `src/store/useAppStore.ts`

- [ ] **Step 1: Create `useUIStore.ts`**

Create `src/store/useUIStore.ts`:

```ts
import { create } from 'zustand';
import {
  PREFERENCE_STORAGE_KEYS,
  parseEditorFont,
  parseEditorFontSize,
  parseLocalePreference,
  parsePageWidth,
  parseTitleEnterBehavior,
  type EditorFont,
  type EditorFontSize,
  type LocalePreference,
  type PageWidth,
  type TitleEnterBehavior,
} from '../lib/preferences';

export type Theme = 'light' | 'dark' | 'system';

interface UIState {
  isSidebarOpen: boolean;
  sidebarWidth: number;
  theme: Theme;
  localePreference: LocalePreference;
  editorFont: EditorFont;
  editorFontSize: EditorFontSize;
  pageWidth: PageWidth;
  titleEnterBehavior: TitleEnterBehavior;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setTheme: (theme: Theme) => void;
  setLocalePreference: (value: LocalePreference) => void;
  setEditorFont: (value: EditorFont) => void;
  setEditorFontSize: (value: EditorFontSize) => void;
  setPageWidth: (value: PageWidth) => void;
  setTitleEnterBehavior: (value: TitleEnterBehavior) => void;
}

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 340;

function clampSidebarWidth(width: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)));
}

function getStoredSidebarWidth(): number {
  const storedWidth = Number(typeof localStorage !== 'undefined' ? localStorage.getItem('opennotion-sidebar-width') : null);
  return Number.isFinite(storedWidth) ? clampSidebarWidth(storedWidth) : SIDEBAR_DEFAULT_WIDTH;
}

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getStoredTheme(): Theme {
  const storedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem('opennotion-theme') : null;
  return isTheme(storedTheme) ? storedTheme : 'system';
}

const getStoredPreference = <T>(key: string, parse: (value: unknown) => T): T =>
  parse(typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null);

export const useUIStore = create<UIState>((set) => ({
  isSidebarOpen: true,
  sidebarWidth: getStoredSidebarWidth(),
  theme: getStoredTheme(),
  localePreference: getStoredPreference(PREFERENCE_STORAGE_KEYS.locale, parseLocalePreference),
  editorFont: getStoredPreference(PREFERENCE_STORAGE_KEYS.editorFont, parseEditorFont),
  editorFontSize: getStoredPreference(PREFERENCE_STORAGE_KEYS.editorFontSize, parseEditorFontSize),
  pageWidth: getStoredPreference(PREFERENCE_STORAGE_KEYS.pageWidth, parsePageWidth),
  titleEnterBehavior: getStoredPreference(PREFERENCE_STORAGE_KEYS.titleEnter, parseTitleEnterBehavior),

  toggleSidebar: () => {
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen }));
  },

  setSidebarWidth: (width) => {
    const sidebarWidth = clampSidebarWidth(width);
    localStorage.setItem('opennotion-sidebar-width', String(sidebarWidth));
    set({ sidebarWidth });
  },

  setTheme: (theme) => {
    localStorage.setItem('opennotion-theme', theme);
    set({ theme });
  },

  setLocalePreference: (value) => {
    localStorage.setItem(PREFERENCE_STORAGE_KEYS.locale, value);
    set({ localePreference: value });
  },
  setEditorFont: (value) => {
    localStorage.setItem(PREFERENCE_STORAGE_KEYS.editorFont, value);
    set({ editorFont: value });
  },
  setEditorFontSize: (value) => {
    localStorage.setItem(PREFERENCE_STORAGE_KEYS.editorFontSize, value);
    set({ editorFontSize: value });
  },
  setPageWidth: (value) => {
    localStorage.setItem(PREFERENCE_STORAGE_KEYS.pageWidth, value);
    set({ pageWidth: value });
  },
  setTitleEnterBehavior: (value) => {
    localStorage.setItem(PREFERENCE_STORAGE_KEYS.titleEnter, value);
    set({ titleEnterBehavior: value });
  },
}));
```

- [ ] **Step 2: Remove UI prefs from `useAppStore`**

In `src/store/useAppStore.ts`:

(a) Delete the `Theme` type alias (line 39: `type Theme = 'light' | 'dark' | 'system';`).

(b) Delete the helpers that now live in `useUIStore`: `isTheme`, `getStoredTheme`, `getStoredPreference`, `clampSidebarWidth`, `getStoredSidebarWidth`, and the `SIDEBAR_MIN_WIDTH` / `SIDEBAR_MAX_WIDTH` / `SIDEBAR_DEFAULT_WIDTH` constants (lines ~107-149).

(c) In the `AppState` interface, delete these fields:
- `isSidebarOpen`, `sidebarWidth`, `theme`
- `localePreference`, `editorFont`, `editorFontSize`, `pageWidth`, `titleEnterBehavior`
- `toggleSidebar`, `setSidebarWidth`, `setTheme`
- `setLocalePreference`, `setEditorFont`, `setEditorFontSize`, `setPageWidth`, `setTitleEnterBehavior`

(d) In the `create(...)` body, delete the initial values for the removed state fields (`isSidebarOpen: true`, `sidebarWidth: getStoredSidebarWidth()`, `theme: getStoredTheme()`, `localePreference: getStoredPreference(...)`, `editorFont: ...`, `editorFontSize: ...`, `pageWidth: ...`, `titleEnterBehavior: ...`).

(e) In the `create(...)` body, delete the action implementations: `toggleSidebar`, `setSidebarWidth`, `setTheme`, `setLocalePreference`, `setEditorFont`, `setEditorFontSize`, `setPageWidth`, `setTitleEnterBehavior`.

(f) Remove the now-unused import lines at the top of the file:
```ts
import {
  PREFERENCE_STORAGE_KEYS,
  parseEditorFont,
  parseEditorFontSize,
  parseLocalePreference,
  parsePageWidth,
  parseTitleEnterBehavior,
  type EditorFont,
  type EditorFontSize,
  type LocalePreference,
  type PageWidth,
  type TitleEnterBehavior,
} from '../lib/preferences';
```

- [ ] **Step 3: Verify the store still typechecks in isolation**

Run: `npm run build`
Expected: FAIL with errors in the consumer files (App.tsx, Layout.tsx, etc.) complaining that `theme`, `isSidebarOpen`, etc. no longer exist on the store. This is expected — Task 7 fixes the consumers. Do NOT commit yet.

---

## Task 7: Migrate consumer files to `useUIStore`

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Layout.tsx`
- Modify: `src/components/PageEditor.tsx`
- Modify: `src/components/StudioWorkspace.tsx`
- Modify: `src/components/settings/AppearanceSection.tsx`
- Modify: `src/components/settings/PreferencesSection.tsx`
- Modify: `src/lib/i18n.ts`
- Modify: `src/lib/i18n.test.ts`

For each file, the change is: add `import { useUIStore } from '<path>/useUIStore';`, switch UI-pref selectors from `useAppStore` to `useUIStore`, and leave all domain selectors on `useAppStore`. Keep the existing import line for `useAppStore` where the file still reads domain state.

- [ ] **Step 1: `src/App.tsx`**

Add the import alongside the existing `useAppStore` import:
```ts
import { useUIStore } from "./store/useUIStore";
```

Change lines 31-32:
```ts
  const theme = useAppStore((state) => state.theme);
  const localePreference = useAppStore((state) => state.localePreference);
```
to:
```ts
  const theme = useUIStore((state) => state.theme);
  const localePreference = useUIStore((state) => state.localePreference);
```

- [ ] **Step 2: `src/components/Layout.tsx`**

The current line 9 destructures multiple values from one store call:
```ts
  const { isSidebarOpen, sidebarWidth, toggleSidebar } = useAppStore();
```
`isSidebarOpen`/`sidebarWidth`/`toggleSidebar` move to `useUIStore`. Replace with two hooks:
```ts
import { useUIStore } from '../store/useUIStore';
```
(add near the existing `useAppStore` import — keep `useAppStore` import only if Layout still reads other fields; check the file. If `Layout.tsx` no longer reads any `useAppStore` field, remove that import entirely.)

Replace line 9:
```ts
  const { isSidebarOpen, sidebarWidth, toggleSidebar } = useUIStore();
```

If `Layout.tsx` still reads other `useAppStore` fields (e.g. nothing else was in that destructure), confirm by reading the file after the edit — `noUnusedLocals`/`tsc` will flag a leftover unused import.

- [ ] **Step 3: `src/components/PageEditor.tsx`**

Add import:
```ts
import { useUIStore } from "../store/useUIStore";
```

Change lines 959-964:
```ts
  const appTheme = useAppStore((state) => state.theme);
  const isSidebarOpen = useAppStore((state) => state.isSidebarOpen);
  const editorFont = useAppStore((state) => state.editorFont);
  const editorFontSize = useAppStore((state) => state.editorFontSize);
  const pageWidth = useAppStore((state) => state.pageWidth);
  const titleEnterBehavior = useAppStore((state) => state.titleEnterBehavior);
```
to:
```ts
  const appTheme = useUIStore((state) => state.theme);
  const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
  const editorFont = useUIStore((state) => state.editorFont);
  const editorFontSize = useUIStore((state) => state.editorFontSize);
  const pageWidth = useUIStore((state) => state.pageWidth);
  const titleEnterBehavior = useUIStore((state) => state.titleEnterBehavior);
```
The file still uses `useAppStore` for domain actions (lines 946-949 etc.) — keep that import.

- [ ] **Step 4: `src/components/StudioWorkspace.tsx`**

Add import:
```ts
import { useUIStore } from "../store/useUIStore";
```
Change line 96:
```ts
  const isSidebarOpen = useAppStore((state) => state.isSidebarOpen);
```
to:
```ts
  const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
```
Keep `useAppStore` import if other selectors remain in the file.

- [ ] **Step 5: `src/components/settings/AppearanceSection.tsx`**

Add import:
```ts
import { useUIStore } from '../../store/useUIStore';
```
Change lines 15-20:
```ts
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const editorFont = useAppStore((state) => state.editorFont);
  const setEditorFont = useAppStore((state) => state.setEditorFont);
  const editorFontSize = useAppStore((state) => state.editorFontSize);
  const setEditorFontSize = useAppStore((state) => state.setEditorFontSize);
```
to:
```ts
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const editorFont = useUIStore((state) => state.editorFont);
  const setEditorFont = useUIStore((state) => state.setEditorFont);
  const editorFontSize = useUIStore((state) => state.editorFontSize);
  const setEditorFontSize = useUIStore((state) => state.setEditorFontSize);
```
Remove the `useAppStore` import from this file entirely (AppearanceSection reads only UI prefs).

- [ ] **Step 6: `src/components/settings/PreferencesSection.tsx`**

Add import:
```ts
import { useUIStore } from '../../store/useUIStore';
```
Change lines 7-12:
```ts
  const localePreference = useAppStore((state) => state.localePreference);
  const setLocalePreference = useAppStore((state) => state.setLocalePreference);
  const titleEnterBehavior = useAppStore((state) => state.titleEnterBehavior);
  const setTitleEnterBehavior = useAppStore((state) => state.setTitleEnterBehavior);
  const pageWidth = useAppStore((state) => state.pageWidth);
  const setPageWidth = useAppStore((state) => state.setPageWidth);
```
to:
```ts
  const localePreference = useUIStore((state) => state.localePreference);
  const setLocalePreference = useUIStore((state) => state.setLocalePreference);
  const titleEnterBehavior = useUIStore((state) => state.titleEnterBehavior);
  const setTitleEnterBehavior = useUIStore((state) => state.setTitleEnterBehavior);
  const pageWidth = useUIStore((state) => state.pageWidth);
  const setPageWidth = useUIStore((state) => state.setPageWidth);
```
Remove the `useAppStore` import entirely.

- [ ] **Step 7: `src/lib/i18n.ts`**

Change line 5:
```ts
import { useAppStore } from "../store/useAppStore";
```
to:
```ts
import { useUIStore } from "../store/useUIStore";
```
Change line 31:
```ts
  const preference = useAppStore((state) => state.localePreference);
```
to:
```ts
  const preference = useUIStore((state) => state.localePreference);
```

- [ ] **Step 8: `src/lib/i18n.test.ts`**

This file mocks `useAppStore`. Read it first, then change the mock to target `useUIStore` (the mock provides `localePreference`). At line 6, the mock signature references `useAppStore`; rename it to `useUIStore` and adjust the import/vi.mock call accordingly. The exact edit depends on the file's current content — read `src/lib/i18n.test.ts` fully before editing.

- [ ] **Step 9: Typecheck the whole project**

Run: `npm run build`
Expected: PASS. Any remaining `Property 'X' does not exist on type 'AppState'` error is a missed consumer — fix it by routing that selector through `useUIStore`. Run `grep -rn "useAppStore" src/ | grep -E "theme|sidebar|locale|editorFont|editorFontSize|pageWidth|titleEnter|isSidebarOpen"` to find stragglers; the output should be empty.

- [ ] **Step 10: Run all tests**

Run: `npm test`
Expected: PASS. If the characterization suite (Task 1-4) or `i18n.test.ts` fail, the mock/wiring is wrong — fix before proceeding.

- [ ] **Step 11: Commit**

```bash
git add src/store/useUIStore.ts src/store/useAppStore.ts src/App.tsx src/components/Layout.tsx src/components/PageEditor.tsx src/components/StudioWorkspace.tsx src/components/settings/AppearanceSection.tsx src/components/settings/PreferencesSection.tsx src/lib/i18n.ts src/lib/i18n.test.ts
git commit -m "refactor: extract useUIStore for device preferences

Moves theme, sidebar, locale, editor font/size, page width, and
title-enter behavior out of useAppStore into an isolated store with
no domain coupling. Migrates all consumers (App, Layout, PageEditor,
StudioWorkspace, settings panels, i18n hook). No behavior change."
```

---

## Task 8: Move UI-pref assertions to `useUIStore.test.ts`

The characterization suite (Task 1-4) doesn't yet assert UI prefs; add them now for the new store.

**Files:**
- Create: `src/store/useUIStore.test.ts`

- [ ] **Step 1: Write the UI pref round-trip tests**

Create `src/store/useUIStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

function installLocalStorage() {
  const map = new Map<string, string>();
  const ls = {
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => { map.set(k, v); }),
    removeItem: vi.fn((k: string) => { map.delete(k); }),
    clear: vi.fn(() => map.clear()),
    key: vi.fn(() => null),
    get length() { return map.size; },
  };
  Object.defineProperty(globalThis, "localStorage", { value: ls, writable: true, configurable: true });
  return { ls, map };
}

async function loadStore() {
  vi.resetModules();
  const mod = await import("./useUIStore");
  return mod.useUIStore;
}

describe("useUIStore", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("setTheme persists to localStorage and updates state", async () => {
    const { map } = installLocalStorage();
    const useUIStore = await loadStore();
    useUIStore.getState().setTheme("dark");
    expect(useUIStore.getState().theme).toBe("dark");
    expect(map.get("opennotion-theme")).toBe("dark");
  });

  it("setSidebarWidth clamps to [220, 420] and persists", async () => {
    const { map } = installLocalStorage();
    const useUIStore = await loadStore();
    useUIStore.getState().setSidebarWidth(10000);
    expect(useUIStore.getState().sidebarWidth).toBe(420);
    useUIStore.getState().setSidebarWidth(10);
    expect(useUIStore.getState().sidebarWidth).toBe(220);
    expect(map.get("opennotion-sidebar-width")).toBe("220");
  });

  it("toggleSidebar flips isSidebarOpen", async () => {
    const useUIStore = await loadStore();
    const before = useUIStore.getState().isSidebarOpen;
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().isSidebarOpen).toBe(!before);
  });

  it("defaults theme to 'system' when localStorage is empty", async () => {
    installLocalStorage();
    const useUIStore = await loadStore();
    expect(useUIStore.getState().theme).toBe("system");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/store/useUIStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add src/store/useUIStore.test.ts
git commit -m "test: add useUIStore preference round-trip tests"
```

---

## Task 9: Extract `sharedSlice`

Step 2 begins. Extract the cross-cutting concerns first — every other slice depends on them via `get()`.

**Files:**
- Create: `src/store/slices/sharedSlice.ts`
- Modify: `src/store/useAppStore.ts`

- [ ] **Step 1: Create `sharedSlice.ts`**

Create `src/store/slices/sharedSlice.ts`:

```ts
import type { StateCreator } from 'zustand';
import { AppNotice, noticeKeyForError } from '../../lib/appFeedback';
import { HOME_PAGE_ID, resolveCurrentPageId } from '../../lib/navigation';
import type { TranslationKey, TranslationParams } from '../../lib/i18n';
import type { AppState } from '../useAppStore';

export interface SharedSlice {
  currentPageId: string | null;
  currentStudioDocumentId: string | null;
  isLoading: boolean;
  error: string | null;
  notice: AppNotice | null;
  isCommandPaletteOpen: boolean;
  setCurrentPageId: (id: string | null) => void;
  setCurrentStudioDocumentId: (id: string | null) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  clearNotice: () => void;
  showSuccess: (key: TranslationKey, params?: TranslationParams) => void;
  showError: (error: unknown) => void;
  showErrorKey: (key: TranslationKey, params?: TranslationParams) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
}

export const createSharedSlice: StateCreator<AppState, [], [], SharedSlice> = (set, get) => ({
  currentPageId: getStoredPageId(),
  currentStudioDocumentId: null,
  isLoading: true,
  error: null,
  notice: null,
  isCommandPaletteOpen: false,

  setCurrentPageId: (id) => {
    localStorage.setItem('opennotion-current-page-id', id || HOME_PAGE_ID);
    set({ currentPageId: id, currentStudioDocumentId: null });
  },
  setCurrentStudioDocumentId: (id) => {
    set({ currentStudioDocumentId: id });
  },
  setError: (error) => set({ error, notice: error ? { kind: 'error', rawMessage: error } : null }),
  clearError: () => set({ error: null }),
  clearNotice: () => set({ notice: null }),
  showSuccess: (key, params) => set({ notice: { kind: 'success', messageKey: key, params }, error: null }),
  showErrorKey: (key, params) => set({ notice: { kind: 'error', messageKey: key, params }, error: key }),
  showError: (error) => {
    const noticePart = noticeKeyForError(error);
    const notice: AppNotice = { kind: 'error', ...noticePart } as AppNotice;
    const errorText = 'rawMessage' in noticePart ? noticePart.rawMessage : noticePart.messageKey;
    set({ error: errorText, notice });
  },
  openCommandPalette: () => set({ isCommandPaletteOpen: true }),
  closeCommandPalette: () => set({ isCommandPaletteOpen: false }),
});

function getStoredPageId(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem('opennotion-current-page-id') : null;
}
```

Note: `setCurrentPageId` no longer calls `resolveCurrentPageId` (it didn't in the original either — that resolution happens in `fetchPages`). The `resolveCurrentPageId` import is used elsewhere; if `tsc` reports it unused in `sharedSlice.ts`, remove it from this file's imports (it's only needed by `pagesSlice`).

- [ ] **Step 2: Move `pageTreeIds` and `logStoreError` to `helpers.ts`**

Create `src/store/slices/helpers.ts`:

```ts
import type { Page } from '../../lib/db';

/** Collects the root page id and all of its descendants by parent_id linkage. */
export function pageTreeIds(pages: Page[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const page of pages) {
      if (page.parent_id && ids.has(page.parent_id) && !ids.has(page.id)) {
        ids.add(page.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function logStoreError(error: unknown): void {
  if (import.meta.env.DEV) {
    console.error(error);
  }
}
```

(`getStoredPageId` is only used by `sharedSlice`'s initializer, so it stays local to `sharedSlice.ts` as a private function — do not move it.)

- [ ] **Step 3: Compose `sharedSlice` into `useAppStore`**

In `src/store/useAppStore.ts`:

(a) Add imports at the top:
```ts
import { createSharedSlice, type SharedSlice } from './slices/sharedSlice';
import { logStoreError, pageTreeIds } from './slices/helpers';
```

(b) Change the `AppState` interface to extend the slice:
```ts
interface AppState extends SharedSlice {
  // ... all other fields (pages, studioDocuments, profile, and every action)
}
```
Remove from `AppState` the fields/actions that `SharedSlice` now defines: `currentPageId`, `currentStudioDocumentId`, `isLoading`, `error`, `notice`, `isCommandPaletteOpen`, `setCurrentPageId`, `setCurrentStudioDocumentId`, `setError`, `clearError`, `clearNotice`, `showSuccess`, `showError`, `showErrorKey`, `openCommandPalette`, `closeCommandPalette`.

(c) Delete the local `pageTreeIds` and `logStoreError` definitions from `useAppStore.ts` (now imported from `helpers.ts`).

(d) Delete the `getStoredPageId` function from `useAppStore.ts` (now local to `sharedSlice.ts`).

(e) In the `create(...)` body, delete the initial values and action implementations for everything `SharedSlice` provides: `currentPageId: getStoredPageId()`, `currentStudioDocumentId: null`, `isLoading: true`, `error: null`, `notice: null`, `isCommandPaletteOpen: false`, and all the `setCurrent*`/`set*`/`show*`/`clear*`/`open*`/`close*` action bodies.

(f) Replace the `create` call to compose the slice:
```ts
export const useAppStore = create<AppState>()((...a) => ({
  ...createSharedSlice(...a),
  // ...all remaining domain state + actions unchanged
}));
```

- [ ] **Step 4: Typecheck + test**

Run: `npm run build`
Expected: PASS. If `resolveCurrentPageId` is flagged unused in `sharedSlice.ts`, remove it from that import.

Run: `npm test`
Expected: PASS (all characterization tests + existing lib tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/slices/sharedSlice.ts src/store/slices/helpers.ts src/store/useAppStore.ts
git commit -m "refactor: extract sharedSlice from useAppStore

Moves cross-cutting state (notice/error/palette/nav) into a slice
composed into useAppStore. Public API unchanged."
```

---

## Task 10: Extract `profileSlice`

Smallest domain slice, fewest cross-calls — extract next.

**Files:**
- Create: `src/store/slices/profileSlice.ts`
- Modify: `src/store/useAppStore.ts`

- [ ] **Step 1: Create `profileSlice.ts`**

Create `src/store/slices/profileSlice.ts`:

```ts
import type { StateCreator } from 'zustand';
import {
  WorkspaceProfile,
  getWorkspaceProfile,
  updateWorkspaceProfile,
  importProfileAvatarFromDialog,
} from '../../lib/profile';
import type { AppState } from '../useAppStore';

export interface ProfileSlice {
  profile: WorkspaceProfile | null;
  fetchProfile: () => Promise<void>;
  updateProfileAction: (patch: Partial<Pick<WorkspaceProfile, "name" | "workspaceName">> & { avatarPath?: null }) => Promise<void>;
  importProfileAvatarAction: () => Promise<void>;
}

export const createProfileSlice: StateCreator<AppState, [], [], ProfileSlice> = (set, get) => ({
  profile: null,

  fetchProfile: async () => {
    try {
      set({ profile: await getWorkspaceProfile() });
    } catch (error) {
      get().showError(error);
    }
  },

  updateProfileAction: async (patch) => {
    const previousProfile = get().profile;
    if (previousProfile) {
      set({ profile: { ...previousProfile, ...patch } as WorkspaceProfile });
    }
    try {
      set({ profile: await updateWorkspaceProfile(patch) });
    } catch (error) {
      set({ profile: previousProfile });
      get().showError(error);
    }
  },

  importProfileAvatarAction: async () => {
    try {
      const avatarPath = await importProfileAvatarFromDialog();
      if (!avatarPath) return;
      const current = get().profile;
      if (current) set({ profile: { ...current, avatarPath } });
    } catch (error) {
      get().showError(error);
    }
  },
});
```

- [ ] **Step 2: Compose `profileSlice` into `useAppStore`**

In `src/store/useAppStore.ts`:

(a) Add imports:
```ts
import { createProfileSlice, type ProfileSlice } from './slices/profileSlice';
```
Remove the now-redundant direct imports from `'../lib/profile'`:
```ts
import { WorkspaceProfile, getWorkspaceProfile, updateWorkspaceProfile, importProfileAvatarFromDialog } from '../lib/profile';
```

(b) Change `AppState` to extend `ProfileSlice`:
```ts
interface AppState extends SharedSlice, ProfileSlice {
  // ...remaining fields (pages, studio)
}
```
Remove from `AppState`: `profile`, `fetchProfile`, `updateProfileAction`, `importProfileAvatarAction`.

(c) In the `create(...)` body, remove the `profile: null` initializer and the three profile action bodies. Add the slice spread:
```ts
export const useAppStore = create<AppState>()((...a) => ({
  ...createSharedSlice(...a),
  ...createProfileSlice(...a),
  // ...remaining domain state + actions
}));
```

- [ ] **Step 3: Typecheck + test**

Run: `npm run build`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/store/slices/profileSlice.ts src/store/useAppStore.ts
git commit -m "refactor: extract profileSlice from useAppStore"
```

---

## Task 11: Extract `studioSlice`

**Files:**
- Create: `src/store/slices/studioSlice.ts`
- Modify: `src/store/useAppStore.ts`

- [ ] **Step 1: Create `studioSlice.ts`**

Create `src/store/slices/studioSlice.ts`. Copy the studio-related state initializers and actions verbatim from `useAppStore.ts` (`studioDocuments: []`, `studioDocumentPageLinks: []`, and the actions `fetchStudioDocuments`, `importStudioPdfAction`, `replaceStudioPdfAction`, `updateStudioViewerAction`, `createMissingStudioNoteAction`, `renameStudioDocumentAction`, `deleteStudioDocumentAction`). The slice factory:

```ts
import type { StateCreator } from 'zustand';
import { getPage, getPages, movePage, updatePage, createStudioNotePage, type Page } from '../../lib/db';
import {
  StudioDocument,
  StudioDocumentPageLink,
  StudioPanelLayout,
  deleteStudioDocument,
  importStudioDocumentFromDialog,
  listAllStudioDocumentPageLinks,
  listStudioDocuments,
  renameStudioDocument,
  replaceStudioDocumentFileFromDialog,
  updateStudioDocumentViewerState,
} from '../../lib/studio';
import { exportFilesWithDialog } from '../../lib/desktop';
import { buildMarkdownTreeFiles, buildPageTreeExport, sanitizeExportFilename } from '../../lib/exportPages';
import { createPageMarkdownRenderer } from '../../lib/exportMarkdown';
import { HOME_PAGE_ID, resolveCurrentPageId, resolveCurrentPageIdAfterDeletion } from '../../lib/navigation';
import { pageTreeIds } from './helpers';
import type { AppState } from '../useAppStore';

export interface StudioSlice {
  studioDocuments: StudioDocument[];
  studioDocumentPageLinks: StudioDocumentPageLink[];
  fetchStudioDocuments: () => Promise<void>;
  importStudioPdfAction: (projectPageId?: string | null) => Promise<StudioDocument | null>;
  replaceStudioPdfAction: (documentId: string) => Promise<StudioDocument | null>;
  updateStudioViewerAction: (id: string, updates: { viewer_zoom?: number; viewer_page?: number; panel_layout?: StudioPanelLayout }) => Promise<void>;
  createMissingStudioNoteAction: (documentId: string) => Promise<Page | null>;
  renameStudioDocumentAction: (id: string, title: string) => Promise<void>;
  deleteStudioDocumentAction: (id: string) => Promise<void>;
}

export const createStudioSlice: StateCreator<AppState, [], [], StudioSlice> = (set, get) => ({
  studioDocuments: [],
  studioDocumentPageLinks: [],

  fetchStudioDocuments: async () => {
    // ... body copied verbatim from useAppStore.ts
  },
  importStudioPdfAction: async (projectPageId = null) => {
    // ... body copied verbatim
  },
  replaceStudioPdfAction: async (documentId) => {
    // ... body copied verbatim
  },
  updateStudioViewerAction: async (id, updates) => {
    // ... body copied verbatim
  },
  createMissingStudioNoteAction: async (documentId) => {
    // ... body copied verbatim
  },
  renameStudioDocumentAction: async (id, title) => {
    // ... body copied verbatim
  },
  deleteStudioDocumentAction: async (id) => {
    // ... body copied verbatim (uses pageTreeIds imported from helpers, and HOME_PAGE_ID etc.)
  },
});
```

**Copy each action body byte-for-byte from the current `useAppStore.ts`.** The actions reference `get().showError`, `get().fetchStudioDocuments`, `get().pages`, `get().studioDocuments`, `get().studioDocumentPageLinks`, `get().currentPageId` — all resolve against the full `AppState` via `get()`, exactly as today. The `exportProjectNotes*` actions move to `pagesSlice.ts` in Task 12.

- [ ] **Step 2: Compose `studioSlice` into `useAppStore`**

In `src/store/useAppStore.ts`:

(a) Add import:
```ts
import { createStudioSlice, type StudioSlice } from './slices/studioSlice';
```
Remove the now-redundant direct studio imports (`deleteStudioDocument`, `importStudioDocumentFromDialog`, `listAllStudioDocumentPageLinks`, `listStudioDocuments`, `renameStudioDocument`, `replaceStudioDocumentFileFromDialog`, `updateStudioDocumentViewerState`, `StudioDocument`, `StudioDocumentPageLink`, `StudioPanelLayout`) — they now live in `studioSlice.ts`. Keep `StudioProject` imported in `useAppStore.ts` for now; it moves to `pagesSlice.ts` in Task 12. Keep `movePage` only if `pagesSlice` (still inline) uses it.

(b) `AppState` extends `StudioSlice`:
```ts
interface AppState extends SharedSlice, ProfileSlice, StudioSlice {
  // ...remaining fields (pages + page actions + project actions)
}
```
Remove from `AppState`: `studioDocuments`, `studioDocumentPageLinks`, and the seven studio action signatures.

(c) In the `create(...)` body, remove the two studio initializers and all seven studio action bodies. Add the slice spread:
```ts
export const useAppStore = create<AppState>()((...a) => ({
  ...createSharedSlice(...a),
  ...createProfileSlice(...a),
  ...createStudioSlice(...a),
  // ...remaining page/project state + actions
}));
```

- [ ] **Step 3: Typecheck + test**

Run: `npm run build`
Expected: PASS. Watch for: unused imports in `useAppStore.ts` (the studio imports you removed) — `noUnusedLocals` will flag any you missed.

Run: `npm test`
Expected: PASS. The `renameStudioDocumentAction` mirroring + rollback tests (Task 3) and the `removePage` cascade (Task 2) exercise cross-slice `get()` calls.

- [ ] **Step 4: Commit**

```bash
git add src/store/slices/studioSlice.ts src/store/useAppStore.ts
git commit -m "refactor: extract studioSlice from useAppStore"
```

---

## Task 12: Extract `pagesSlice` and finalize `useAppStore`

The largest slice. After this, `useAppStore.ts` is just imports + the `AppState` interface + the composed `create()`.

**Files:**
- Create: `src/store/slices/pagesSlice.ts`
- Modify: `src/store/useAppStore.ts`

- [ ] **Step 1: Create `pagesSlice.ts`**

Create `src/store/slices/pagesSlice.ts`. Copy the page/project state initializers and actions verbatim from `useAppStore.ts` (`pages: []`, and the actions `fetchPages`, `addPage`, `updatePageOptimistically`, `renamePageAction`, `removePage`, `movePageAction`, `reorderPagesAction`, `toggleFavoriteAction`, `toggleTemplateAction`, `addPageFromTemplate`, `duplicatePageAction`, `importPageAction`, `createProjectAction`, `removeProjectAction`, `exportProjectNotesMarkdown`, `exportProjectNotesJSON`). The slice factory:

```ts
import type { StateCreator } from 'zustand';
import { invoke, exportFilesWithDialog, importPageFileWithDialog } from '../../lib/desktop';
import { prepareImportedPages } from '../../lib/backup';
import { buildMarkdownTreeFiles, buildPageTreeExport, sanitizeExportFilename } from '../../lib/exportPages';
import { createPageMarkdownRenderer } from '../../lib/exportMarkdown';
import {
  Page,
  getPage, getPages, createPage, createPageFromTemplate, createProject,
  deletePage, deleteProject, duplicatePage, movePage, reorderPages,
  toggleFavorite, toggleTemplate, updatePage,
} from '../../lib/db';
import { StudioProject, listAllStudioDocumentPageLinks } from '../../lib/studio';
import { openNotionEditorSchema } from '../../lib/editorMath';
import { HOME_PAGE_ID, resolveCurrentPageId, resolveCurrentPageIdAfterDeletion } from '../../lib/navigation';
import { logStoreError, pageTreeIds } from './helpers';
import type { AppState } from '../useAppStore';

export interface PagesSlice {
  pages: Page[];
  fetchPages: () => Promise<void>;
  addPage: (title?: string, parentId?: string | null, options?: { select?: boolean }) => Promise<Page | null>;
  updatePageOptimistically: (id: string, updates: Partial<Page>) => void;
  renamePageAction: (id: string, title: string) => Promise<void>;
  removePage: (id: string) => Promise<void>;
  movePageAction: (id: string, parentId: string | null) => Promise<void>;
  reorderPagesAction: (parentId: string | null, orderedIds: string[]) => Promise<void>;
  toggleFavoriteAction: (id: string, isFavorite: boolean) => Promise<void>;
  toggleTemplateAction: (id: string, isTemplate: boolean) => Promise<void>;
  addPageFromTemplate: (templateId: string, parentId?: string | null, options?: { select?: boolean }) => Promise<Page | null>;
  duplicatePageAction: (sourceId: string, options?: { select?: boolean }) => Promise<Page | null>;
  importPageAction: () => Promise<Page | null>;
  createProjectAction: (title?: string) => Promise<Page | null>;
  removeProjectAction: (id: string) => Promise<void>;
  exportProjectNotesMarkdown: (project: StudioProject) => Promise<void>;
  exportProjectNotesJSON: (project: StudioProject) => Promise<void>;
}

export const createPagesSlice: StateCreator<AppState, [], [], PagesSlice> = (set, get) => ({
  pages: [],

  fetchPages: async () => {
    // ... body copied verbatim
  },
  addPage: async (title = 'Untitled', parentId = null, options = {}) => {
    // ... body copied verbatim
  },
  updatePageOptimistically: (id, updates) => set((state) => ({
    pages: state.pages.map(p => p.id === id ? { ...p, ...updates } : p)
  })),
  renamePageAction: async (id, title) => {
    // ... body copied verbatim
  },
  removePage: async (id) => {
    // ... body copied verbatim (uses pageTreeIds + get().fetchStudioDocuments() cross-slice)
  },
  movePageAction: async (id, parentId) => {
    // ... body copied verbatim
  },
  reorderPagesAction: async (parentId, orderedIds) => {
    // ... body copied verbatim
  },
  toggleFavoriteAction: async (id, isFavorite) => {
    // ... body copied verbatim
  },
  toggleTemplateAction: async (id, isTemplate) => {
    // ... body copied verbatim
  },
  addPageFromTemplate: async (templateId, parentId = null, options = {}) => {
    // ... body copied verbatim
  },
  duplicatePageAction: async (sourceId, options = {}) => {
    // ... body copied verbatim
  },
  importPageAction: async () => {
    // ... body copied verbatim (uses invoke("import_pages") and BlockNoteEditor dynamic import)
  },
  createProjectAction: async (title = 'Untitled') => {
    // ... body copied verbatim
  },
  removeProjectAction: async (id) => {
    // ... body copied verbatim (uses listAllStudioDocumentPageLinks cross-slice)
  },
  exportProjectNotesMarkdown: async (project) => {
    // ... body copied verbatim from useAppStore.ts
  },
  exportProjectNotesJSON: async (project) => {
    // ... body copied verbatim from useAppStore.ts
  },
});
```

**Copy each action body byte-for-byte.** Cross-slice references (`get().showError`, `get().fetchStudioDocuments`, `get().showSuccess`, `get().fetchPages`, `get().currentPageId`) resolve via `get()` against `AppState` — unchanged.

- [ ] **Step 2: Reduce `useAppStore.ts` to the composition root**

Replace the entire content of `src/store/useAppStore.ts` with:

```ts
import { create } from 'zustand';
import { createSharedSlice, type SharedSlice } from './slices/sharedSlice';
import { createProfileSlice, type ProfileSlice } from './slices/profileSlice';
import { createStudioSlice, type StudioSlice } from './slices/studioSlice';
import { createPagesSlice, type PagesSlice } from './slices/pagesSlice';

export interface AppState extends SharedSlice, ProfileSlice, StudioSlice, PagesSlice {}

export const useAppStore = create<AppState>()((...a) => ({
  ...createSharedSlice(...a),
  ...createProfileSlice(...a),
  ...createStudioSlice(...a),
  ...createPagesSlice(...a),
}));
```

Also delete the now-unused local `type CreatePageOptions = { select?: boolean };` from `useAppStore.ts` (the `PagesSlice` interface inlines `{ select?: boolean }`), and remove the `StudioProject` import that now lives only in `pagesSlice.ts`.

- [ ] **Step 3: Typecheck + test**

Run: `npm run build`
Expected: PASS. Watch for: any leftover imports in `useAppStore.ts`, duplicate `pages` declarations, or unused symbols.

Run: `npm test`
Expected: PASS — all characterization tests (Tasks 1-4) and existing lib tests. The `removePage` cascade, `renameStudioDocument` mirroring/rollback, `{select:false}`, and reorder-rollback tests all exercise the composed store.

- [ ] **Step 4: Commit**

```bash
git add src/store/slices/pagesSlice.ts src/store/useAppStore.ts
git commit -m "refactor: extract pagesSlice; reduce useAppStore to composition root"
```

---

## Task 13: Final gate — full project check + e2e

**Files:** none (verification only)

- [ ] **Step 1: Run the project gate**

Run: `npm run check`
Expected: succeeds (build + unit + smoke/runtime/visual/parity + audit). This is the real CI gate from `AGENTS.md`.

- [ ] **Step 2: Run the behavior-level e2e suite**

Run each spec in isolation (the AGENTS.md notes the shared Vite server can flake under load):
```bash
npx playwright test tests/e2e/persistence.e2e.ts
npx playwright test tests/e2e/studio.e2e.ts
npx playwright test tests/e2e/sidebar-projects.e2e.ts
npx playwright test tests/e2e/subpage-order.e2e.ts
npx playwright test tests/e2e/settings.e2e.ts
```
Expected: all pass. These exercise the refactored store end-to-end through the real UI.

- [ ] **Step 3: Confirm no behavior change via diff review**

Run: `git diff main -- src/store/`
Review: the only changes should be moves (into slices) and the new `useUIStore`. No action body should have changed logic. The characterization tests passing is the proof.

- [ ] **Step 4: Commit the verification record (optional)**

No code change. If any test or check fails, do NOT commit — fix the regression and re-run from the failing task. Only proceed once the full gate is green.

---

## Self-Review

**Spec coverage:**

- "New `useUIStore`" → Tasks 6-8.
- "Slice-organized `useAppStore` (shared/pages/studio/profile)" → Tasks 9-12.
- "Characterization tests for cross-slice flows" → Tasks 1-4 (+ Task 8 for UI prefs). Task 4 now also covers removePage rollback, removeProjectAction, importStudioPdfAction navigation, and fetchStudioDocuments dedup.
- "Deduplicate `pageTreeIds`/`descendantPageIds`" → Task 5 (then moves to `helpers.ts` in Task 9).
- "API stability / no consumer edits in slicing phase" → Tasks 9-12 touch only `src/store/`; consumer edits are confined to Task 7 (UI extraction).
- "Per-step verification gates" → every task ends with `npm run build` + `npm test`; Task 13 adds `npm run check` + e2e.

No spec requirement is left without a task.

**Placeholder scan:** "Copy each action body verbatim" appears in Tasks 11-12. This is deliberate and unavoidable — the bodies are large and already-validated by the characterization tests; duplicating them inline in the plan would bloat it without adding signal, and risks drift from the actual source. The instruction is explicit (byte-for-byte) and the test gate catches any transcription error. The structural scaffolding (imports, types, slice factory signature) is fully spelled out.

**Type consistency:** `SharedSlice`, `ProfileSlice`, `StudioSlice`, `PagesSlice` names are consistent across Tasks 9-12. `createSharedSlice` / `createProfileSlice` / `createStudioSlice` / `createPagesSlice` factory names match. `pageTreeIds` and `logStoreError` move to `helpers.ts` in Task 9 and are imported consistently thereafter. `AppState` extends the four slice interfaces and ends as `extends SharedSlice, ProfileSlice, StudioSlice, PagesSlice {}`.

**Risks carried from the spec:** cross-slice regression (mitigated by Tasks 1-4), missed consumer (mitigated by `tsc` + the grep in Task 7 Step 9), slice typing verbosity (accepted), harness fragility (backstopped by e2e in Task 13).
