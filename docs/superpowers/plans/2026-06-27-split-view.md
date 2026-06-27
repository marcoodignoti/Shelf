# Split View (two pages side-by-side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user place two note pages side-by-side in a resizable primary/secondary split, opened via a toolbar button + searchable page picker, persisted across restarts.

**Architecture:** A new `splitSlice` in the Zustand store tracks `secondaryPageId`, `splitViewRatio`, and `activePane`. `App.tsx` renders a new `SplitView` component (two existing `Editor` instances + a draggable divider reusing the sidebar's pointer-drag pattern) when `secondaryPageId` is set. A reusable `PageSearchResults` component is extracted from `CommandPalette` to power both the command palette and the split-view page picker. Sidebar becomes `activePane`-aware for highlighting and click-targeting.

**Tech Stack:** React 19 + TypeScript, Zustand (slice pattern), Tailwind 4, lucide-react icons, Vitest (node env; jsdom for component tests via `// @vitest-environment jsdom`), Playwright e2e. No backend changes.

**Spec:** `docs/superpowers/specs/2026-06-27-split-view-design.md`

---

## File Structure

**New:**
- `src/store/slices/splitSlice.ts` — Zustand slice: split state + actions + localStorage persistence + sanitization. (+ `splitSlice.test.ts`)
- `src/components/SplitView.tsx` — two-pane layout with draggable divider + focus tracking. (+ `SplitView.test.tsx`)
- `src/components/PageSearchResults.tsx` — reusable search-input + results list (extracted from CommandPalette). (+ `PageSearchResults.test.tsx`)
- `tests/e2e/split-view.e2e.ts` — e2e coverage.

**Modified:**
- `src/store/useAppStore.ts` — compose `SplitSlice`.
- `src/store/slices/pagesSlice.ts` — `removePage` clears split when deleted page matches primary/secondary.
- `src/App.tsx` — render `SplitView` branch; register keyboard shortcuts.
- `src/components/PageEditor.tsx` — toolbar split button + dropdown menu.
- `src/components/CommandPalette.tsx` — consume `PageSearchResults`.
- `src/components/Sidebar.tsx` — `activePane`-aware highlight + click target.
- `src/lib/locales/en.ts`, `src/lib/locales/it.ts` — new i18n keys.

---

## Task 1: i18n keys

**Files:**
- Modify: `src/lib/locales/en.ts`
- Modify: `src/lib/locales/it.ts`

- [ ] **Step 1: Add keys to `en.ts`**

Find an existing `editor.` key (e.g. `editor.turnIntoDatabase`) and add these after the `editor.` block, before the next namespace:

```ts
  "editor.splitView": "Split view",
  "editor.splitViewOpen": "Open beside",
  "editor.chooseSplitPage": "Choose page for panel…",
  "editor.swapPanels": "Swap panels",
  "editor.closeSecondary": "Close secondary panel",
  "editor.alreadyOpen": "Already open",
  "commandPalette.searchSplit": "Search a page to place beside…",
```

- [ ] **Step 2: Add the same keys to `it.ts`**

```ts
  "editor.splitView": "Dividi vista",
  "editor.splitViewOpen": "Apri a fianco",
  "editor.chooseSplitPage": "Scegli pagina per il pannello…",
  "editor.swapPanels": "Scambia pannelli",
  "editor.closeSecondary": "Chiudi pannello secondario",
  "editor.alreadyOpen": "Già aperta",
  "commandPalette.searchSplit": "Cerca una pagina da affiancare…",
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/locales/en.ts src/lib/locales/it.ts
git commit -m "feat(i18n): add split view translation keys"
```

---

## Task 2: `splitSlice` (store state + actions + persistence)

**Files:**
- Create: `src/store/slices/splitSlice.ts`
- Test: `src/store/slices/splitSlice.test.ts`
- Modify: `src/store/useAppStore.ts`

- [ ] **Step 1: Write the failing test**

Create `src/store/slices/splitSlice.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../useAppStore";

function resetStore() {
  useAppStore.setState({
    pages: [
      { id: "p1", title: "A" },
      { id: "p2", title: "B" },
      { id: "p3", title: "C" },
    ] as any,
    currentPageId: "p1",
    secondaryPageId: null,
    splitViewRatio: 0.5,
    activePane: "primary",
  });
}

describe("splitSlice", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStore();
  });

  it("openInSplit sets secondaryPageId without touching currentPageId", () => {
    useAppStore.getState().openInSplit("p2");
    const s = useAppStore.getState();
    expect(s.secondaryPageId).toBe("p2");
    expect(s.currentPageId).toBe("p1");
    expect(localStorage.getItem("opennotion-secondary-page-id")).toBe("p2");
  });

  it("openInSplit with the current page results in no split (sanitization)", () => {
    useAppStore.getState().openInSplit("p1");
    expect(useAppStore.getState().secondaryPageId).toBeNull();
  });

  it("swapSplit exchanges primary and secondary", () => {
    useAppStore.getState().openInSplit("p2");
    useAppStore.getState().swapSplit();
    const s = useAppStore.getState();
    expect(s.currentPageId).toBe("p2");
    expect(s.secondaryPageId).toBe("p1");
  });

  it("closeSplit clears secondaryPageId and storage", () => {
    useAppStore.getState().openInSplit("p2");
    useAppStore.getState().closeSplit();
    expect(useAppStore.getState().secondaryPageId).toBeNull();
    expect(localStorage.getItem("opennotion-secondary-page-id")).toBeNull();
  });

  it("setSplitViewRatio clamps to [0.2, 0.8] and persists", () => {
    useAppStore.getState().setSplitViewRatio(0.05);
    expect(useAppStore.getState().splitViewRatio).toBe(0.2);
    useAppStore.getState().setSplitViewRatio(0.95);
    expect(useAppStore.getState().splitViewRatio).toBe(0.8);
    useAppStore.getState().setSplitViewRatio(0.4);
    expect(useAppStore.getState().splitViewRatio).toBe(0.4);
    expect(localStorage.getItem("opennotion-split-ratio")).toBe("0.4");
  });

  it("setActivePane updates activePane", () => {
    useAppStore.getState().setActivePane("secondary");
    expect(useAppStore.getState().activePane).toBe("secondary");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/slices/splitSlice.test.ts`
Expected: FAIL — `splitSlice` / `openInSplit` not defined (store doesn't compose the slice yet).

- [ ] **Step 3: Write the slice implementation**

Create `src/store/slices/splitSlice.ts`:

```ts
import type { StateCreator } from 'zustand';
import type { AppState } from '../useAppStore';

export type SplitPane = 'primary' | 'secondary';

const SPLIT_RATIO_MIN = 0.2;
const SPLIT_RATIO_MAX = 0.8;
const SPLIT_RATIO_DEFAULT = 0.5;

const SECONDARY_PAGE_STORAGE_KEY = 'opennotion-secondary-page-id';
const SPLIT_RATIO_STORAGE_KEY = 'opennotion-split-ratio';

export interface SplitSlice {
  secondaryPageId: string | null;
  splitViewRatio: number;
  activePane: SplitPane;
  openInSplit: (id: string) => void;
  setSecondaryPageId: (id: string | null) => void;
  setSplitViewRatio: (ratio: number) => void;
  setActivePane: (pane: SplitPane) => void;
  closeSplit: () => void;
  swapSplit: () => void;
}

function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return SPLIT_RATIO_DEFAULT;
  return Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, ratio));
}

function readStoredRatio(): number {
  if (typeof localStorage === 'undefined') return SPLIT_RATIO_DEFAULT;
  const raw = localStorage.getItem(SPLIT_RATIO_STORAGE_KEY);
  return raw !== null ? clampRatio(Number(raw)) : SPLIT_RATIO_DEFAULT;
}

export const createSplitSlice: StateCreator<AppState, [], [], SplitSlice> = (set, get) => ({
  secondaryPageId: typeof localStorage !== 'undefined'
    ? localStorage.getItem(SECONDARY_PAGE_STORAGE_KEY)
    : null,
  splitViewRatio: readStoredRatio(),
  activePane: 'primary',

  openInSplit: (id) => {
    if (id === get().currentPageId) {
      get().closeSplit();
      return;
    }
    localStorage.setItem(SECONDARY_PAGE_STORAGE_KEY, id);
    set({ secondaryPageId: id, activePane: 'secondary' });
  },

  setSecondaryPageId: (id) => {
    if (id && id === get().currentPageId) {
      get().closeSplit();
      return;
    }
    if (id) {
      localStorage.setItem(SECONDARY_PAGE_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(SECONDARY_PAGE_STORAGE_KEY);
    }
    set({ secondaryPageId: id });
  },

  setSplitViewRatio: (ratio) => {
    const clamped = clampRatio(ratio);
    localStorage.setItem(SPLIT_RATIO_STORAGE_KEY, String(clamped));
    set({ splitViewRatio: clamped });
  },

  setActivePane: (pane) => set({ activePane: pane }),

  closeSplit: () => {
    localStorage.removeItem(SECONDARY_PAGE_STORAGE_KEY);
    set({ secondaryPageId: null, activePane: 'primary' });
  },

  swapSplit: () => {
    const { currentPageId, secondaryPageId } = get();
    if (!secondaryPageId) return;
    localStorage.setItem(SECONDARY_PAGE_STORAGE_KEY, currentPageId ?? '');
    if (currentPageId) {
      localStorage.setItem('opennotion-current-page-id', currentPageId);
    }
    set({ currentPageId: secondaryPageId, secondaryPageId: currentPageId });
  },
});
```

- [ ] **Step 4: Compose the slice into the store**

Modify `src/store/useAppStore.ts`:

```ts
import { create } from 'zustand';
import { createSharedSlice, type SharedSlice } from './slices/sharedSlice';
import { createProfileSlice, type ProfileSlice } from './slices/profileSlice';
import { createStudioSlice, type StudioSlice } from './slices/studioSlice';
import { createPagesSlice, type PagesSlice } from './slices/pagesSlice';
import { createSplitSlice, type SplitSlice } from './slices/splitSlice';

export interface AppState extends SharedSlice, ProfileSlice, StudioSlice, PagesSlice, SplitSlice {}

export const useAppStore = create<AppState>()((set, get, ...a) => ({
  ...createSharedSlice(set, get, ...a),
  ...createProfileSlice(set, get, ...a),
  ...createStudioSlice(set, get, ...a),
  ...createPagesSlice(set, get, ...a),
  ...createSplitSlice(set, get, ...a),
}));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/store/slices/splitSlice.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/store/slices/splitSlice.ts src/store/slices/splitSlice.test.ts src/store/useAppStore.ts
git commit -m "feat(store): add splitSlice for two-page split view state"
```

---

## Task 3: Sanitize stale split state at hydration (delete + restart)

**Files:**
- Modify: `src/store/slices/pagesSlice.ts` (removePage clears split)
- Modify: `src/store/slices/splitSlice.ts` (no change needed — sanitization is in actions; this task adds deletion cleanup)
- Test: `src/store/slices/splitSlice.test.ts` (extend)

- [ ] **Step 1: Add tests for deletion cleanup**

Append to `src/store/slices/splitSlice.test.ts`:

```ts
import { vi } from "vitest";

vi.mock("../../lib/desktop", () => ({
  invoke: vi.fn(),
  fileSrc: vi.fn(() => ""),
}));
vi.mock("../../lib/db", () => ({
  getPages: vi.fn(async () => []),
  deletePage: vi.fn(async () => {}),
  listAllStudioDocumentPageLinks: vi.fn(async () => []),
}));

describe("splitSlice deletion cleanup", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      pages: [
        { id: "p1", title: "A" },
        { id: "p2", title: "B" },
      ] as any,
      currentPageId: "p1",
      secondaryPageId: "p2",
      splitViewRatio: 0.5,
      activePane: "primary",
    });
  });

  it("removing the secondary page auto-closes the split", async () => {
    await useAppStore.getState().removePage("p2");
    expect(useAppStore.getState().secondaryPageId).toBeNull();
  });

  it("removing the primary page closes the split", async () => {
    await useAppStore.getState().removePage("p1");
    expect(useAppStore.getState().secondaryPageId).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/slices/splitSlice.test.ts`
Expected: FAIL on the two new tests (removePage doesn't touch split yet).

- [ ] **Step 3: Wire split cleanup into `removePage`**

In `src/store/slices/pagesSlice.ts`, in the `removePage` action, after the optimistic `set(...)` (the block around line 111-115 that sets `currentPageId`), also clear split state. Add inside that first `set` call:

```ts
    set((state) => ({
      pages: optimisticPages,
      studioDocumentPageLinks: state.studioDocumentPageLinks.filter((link) => !deletedIds.has(link.page_id)),
      currentPageId: resolveCurrentPageIdAfterDeletion(optimisticPages, state.currentPageId, id, deletedIds, previousPages),
      secondaryPageId: deletedIds.has(state.secondaryPageId ?? "") ? null : state.secondaryPageId,
      activePane: deletedIds.has(state.secondaryPageId ?? "") ? "primary" : state.activePane,
    }));
```

And mirror it in the success-path `set` (around line 123-127):

```ts
      set((state) => ({
        pages: mergePageMetadataWithHydratedContent(pages, state.pages),
        studioDocumentPageLinks,
        currentPageId: resolveCurrentPageIdAfterDeletion(pages, state.currentPageId, id, deletedIds, previousPages),
        secondaryPageId: deletedIds.has(state.secondaryPageId ?? "") ? null : state.secondaryPageId,
      }));
```

Note: deleting the primary page resolves `currentPageId` to something else (Home), but since `secondaryPageId` is untouched it remains — however the spec says delete-primary also closes the split. So additionally, right before the `try {` in `removePage`, add unconditional primary-delete handling:

```ts
    const willDeletePrimary = deletedIds.has(get().currentPageId ?? "");
    if (willDeletePrimary) {
      get().closeSplit();
    } else if (deletedIds.has(get().secondaryPageId ?? "")) {
      get().closeSplit();
    }
```

(Placing it before `try` ensures rollback still works because `closeSplit` only touches split fields, not `pages`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/store/slices/splitSlice.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/slices/pagesSlice.ts src/store/slices/splitSlice.test.ts
git commit -m "feat(store): auto-close split view when a split page is deleted"
```

---

## Task 4: Reusable `PageSearchResults` component

**Files:**
- Create: `src/components/PageSearchResults.tsx`
- Test: `src/components/PageSearchResults.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/PageSearchResults.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PageSearchResults } from "./PageSearchResults";

vi.mock("../lib/i18n", () => ({
  useT: () => (key: string) => key,
  useLocale: () => "en",
}));

const samplePages = [
  { id: "p1", title: "Appunti", icon: null, is_favorite: 0, is_template: 0, is_database: 0, is_deleted: 0, parent_id: null, content: null, search_text: null, cover_url: null, sort_order: 0, page_kind: "note", created_at: "", updated_at: "" },
  { id: "p2", title: "Roadmap", icon: null, is_favorite: 0, is_template: 0, is_database: 0, is_deleted: 0, parent_id: null, content: null, search_text: null, cover_url: null, sort_order: 1, page_kind: "note", created_at: "", updated_at: "" },
] as any;

describe("PageSearchResults", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("renders all pages when query is empty", () => {
    render(
      <PageSearchResults
        query=""
        pages={samplePages}
        searchResults={[]}
        onSelectPage={() => {}}
        isSearching={false}
        searchError={null}
        emptyKey="commandPalette.noPagesYet"
        noResultsKey="commandPalette.noResults"
        searchingKey="commandPalette.searching"
      />
    );
    expect(screen.getByText("Appunti")).toBeInTheDocument();
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
  });

  it("disables the page whose id equals disabledPageId and shows already-open hint", () => {
    render(
      <PageSearchResults
        query=""
        pages={samplePages}
        searchResults={[]}
        onSelectPage={() => {}}
        isSearching={false}
        searchError={null}
        disabledPageId="p1"
        alreadyOpenKey="editor.alreadyOpen"
        emptyKey="commandPalette.noPagesYet"
        noResultsKey="commandPalette.noResults"
        searchingKey="commandPalette.searching"
      />
    );
    const appuntiBtn = screen.getByText("Appunti").closest("button")!;
    expect(appuntiBtn).toBeDisabled();
    expect(screen.getByText("editor.alreadyOpen")).toBeInTheDocument();
  });

  it("calls onSelectPage when an enabled page is clicked", () => {
    const onSelect = vi.fn();
    render(
      <PageSearchResults
        query=""
        pages={samplePages}
        searchResults={[]}
        onSelectPage={onSelect}
        isSearching={false}
        searchError={null}
        emptyKey="commandPalette.noPagesYet"
        noResultsKey="commandPalette.noResults"
        searchingKey="commandPalette.searching"
      />
    );
    fireEvent.click(screen.getByText("Roadmap"));
    expect(onSelect).toHaveBeenCalledWith("p2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/PageSearchResults.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `PageSearchResults`**

Create `src/components/PageSearchResults.tsx`. It extracts the search-results section from `CommandPalette.tsx` (lines ~197-291 of the current file) into a reusable component, adding optional `disabledPageId` / `alreadyOpenKey`:

```tsx
import type { ComponentType } from "react";
import FileText from "lucide-react/dist/esm/icons/file-text.mjs";
import Star from "lucide-react/dist/esm/icons/star.mjs";
import type { Page, SearchResult } from "../lib/db";
import { pageContentPreview } from "../lib/pageContent";
import { splitSearchMatch } from "../lib/searchDisplay";
import { commandPaletteSections } from "../lib/commandPaletteSections";
import { useT } from "../lib/i18n";
import type { TranslationKey } from "../lib/i18n";

function HighlightedText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitSearchMatch(text, query).map((part, index) => (
        <span
          key={`${part.text}-${index}`}
          className={part.matched ? "rounded bg-primary/10 px-0.5 text-foreground" : undefined}
        >
          {part.text}
        </span>
      ))}
    </>
  );
}

export function PageSearchResults({
  query,
  pages,
  searchResults,
  onSelectPage,
  isSearching,
  searchError,
  disabledPageId,
  alreadyOpenKey,
  emptyKey,
  noResultsKey,
  searchingKey,
}: {
  query: string;
  pages: Page[];
  searchResults: SearchResult[];
  onSelectPage: (id: string) => void;
  isSearching: boolean;
  searchError: string | null;
  disabledPageId?: string;
  alreadyOpenKey?: TranslationKey;
  emptyKey: TranslationKey;
  noResultsKey: TranslationKey;
  searchingKey: TranslationKey;
}) {
  const t = useT();
  const sections = commandPaletteSections({ query, pages, searchResults });

  if (isSearching) {
    return <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t(searchingKey)}</div>;
  }
  if (searchError) {
    return <div className="px-4 py-8 text-center text-sm text-destructive">{searchError}</div>;
  }
  if (sections.length === 0 || sections.every((s) => s.pages.length === 0)) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        {query.trim() ? t(noResultsKey) : t(emptyKey)}
      </div>
    );
  }

  return (
    <>
      {sections.map((section) => (
        <div key={section.titleKey} className="on-command-section">
          <div className="on-command-section-title flex items-center gap-1.5">
            {section.titleKey === "commandPalette.favorites" && <Star className="h-3 w-3 fill-current" />}
            {t(section.titleKey)}
          </div>
          {section.pages.map((page) => {
            const isDisabled = disabledPageId != null && page.id === disabledPageId;
            const preview = page.matched_content ? pageContentPreview(page.matched_content, query) : null;
            const title = page.title || t("sidebar.untitled");
            return (
              <button
                type="button"
                key={`${section.titleKey}-${page.id}`}
                className={`on-command-item ${isDisabled ? "opacity-40 cursor-not-allowed" : ""}`}
                disabled={isDisabled}
                onClick={() => !isDisabled && onSelectPage(page.id)}
              >
                {page.icon ? (
                  <span className="flex h-4 w-4 items-center justify-center text-xs">{page.icon}</span>
                ) : (
                  <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    <HighlightedText text={title} query={query} />
                  </span>
                  {isDisabled && alreadyOpenKey ? (
                    <span className="block truncate text-xs text-muted-foreground">{t(alreadyOpenKey)}</span>
                  ) : preview ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      <HighlightedText text={preview} query={query} />
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/PageSearchResults.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/PageSearchResults.tsx src/components/PageSearchResults.test.tsx
git commit -m "feat: extract reusable PageSearchResults component"
```

---

## Task 5: Refactor `CommandPalette` to use `PageSearchResults`

**Files:**
- Modify: `src/components/CommandPalette.tsx`
- Test: `src/components/CommandPalette.test.tsx` (verify existing tests still pass)

- [ ] **Step 1: Replace inline results section with `<PageSearchResults>`**

In `src/components/CommandPalette.tsx`, replace the inline results block (the `isSearching ? … : searchError ? … : totalItems === 0 ? … : …sections.map…` JSX from roughly lines 198-290) with:

```tsx
        <div className="on-command-results">
          {showCommands && commandItems.length > 0 && (
            <div className="on-command-section">
              <div className="on-command-section-title">{t("commandPalette.suggested")}</div>
              {commandItems.map((command, index) => {
                const Icon = command.icon;
                const isSelected = selectedIndex === index;
                return (
                  <button
                    key={command.id}
                    type="button"
                    className={`on-command-item ${isSelected ? "on-command-item-selected" : ""}`}
                    onClick={() => void handleCommandSelect(index)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{command.label}</span>
                    </span>
                    {command.shortcut && <span className="on-command-shortcut">{command.shortcut}</span>}
                  </button>
                );
              })}
            </div>
          )}
          <PageSearchResults
            query={query}
            pages={pages}
            searchResults={searchResults}
            onSelectPage={handleSelect}
            isSearching={isSearching}
            searchError={searchError}
            emptyKey="commandPalette.noPagesYet"
            noResultsKey="commandPalette.noResults"
            searchingKey="commandPalette.searching"
          />
        </div>
```

Add the import at the top:

```ts
import { PageSearchResults } from "./PageSearchResults";
```

Note: the keyboard-nav index (`flattenedPages`, `selectedIndex`) previously tracked pages for arrow navigation. After refactor, the page list lives inside `PageSearchResults`. To keep arrow-key navigation functional, leave the existing `flattenedPages` / `handleModalKeyDown` logic intact (it still computes indices), but the visual selection highlight on pages is now internal to `PageSearchResults`. For this task, accept that mouse selection works and arrow-up/down still moves the `selectedIndex` counter (used for the command section). Full keyboard re-wiring of the page list is out of scope here — note it in the task 11 polish.

- [ ] **Step 2: Run the CommandPalette test suite**

Run: `npx vitest run src/components/CommandPalette.test.tsx`
Expected: PASS (existing tests). If a test asserted on the old internal DOM structure, update its selector to match the new component output.

- [ ] **Step 3: Commit**

```bash
git add src/components/CommandPalette.tsx src/components/CommandPalette.test.tsx
git commit -m "refactor: CommandPalette uses shared PageSearchResults"
```

---

## Task 6: `SplitView` component

**Files:**
- Create: `src/components/SplitView.tsx`
- Test: `src/components/SplitView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/SplitView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SplitView } from "./SplitView";

vi.mock("./PageEditor", () => ({
  Editor: (props: any) => (
    <div data-testid={`editor-${props.role}`} onClick={props.onSelectPage ? () => props.onSelectPage("newid") : undefined}>
      {props.page.title}
    </div>
  ),
}));

const setSplitViewRatio = vi.fn();
const setActivePane = vi.fn();

vi.mock("../store/useAppStore", () => ({
  useAppStore: (selector: any) =>
    selector({
      setSplitViewRatio,
      setActivePane,
      splitViewRatio: 0.5,
      activePane: "primary",
    }),
}));

const primary = { id: "p1", title: "Primary" } as any;
const secondary = { id: "p2", title: "Secondary" } as any;

describe("SplitView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
  afterEach(() => cleanup());

  it("renders both editors", () => {
    render(<SplitView primary={primary} secondary={secondary} pages={[]} onSelectPrimaryPage={() => {}} onSelectSecondaryPage={() => {}} />);
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Secondary")).toBeInTheDocument();
  });

  it("clicking a pane sets it active", () => {
    render(<SplitView primary={primary} secondary={secondary} pages={[]} onSelectPrimaryPage={() => {}} onSelectSecondaryPage={() => {}} />);
    fireEvent.click(screen.getByTestId("editor-secondary"));
    expect(setActivePane).toHaveBeenCalledWith("secondary");
  });

  it("divider drag updates split ratio", () => {
    render(<SplitView primary={primary} secondary={secondary} pages={[]} onSelectPrimaryPage={() => {}} onSelectSecondaryPage={() => {}} />);
    const container = screen.getByTestId("split-container");
    Object.defineProperty(container, "getBoundingClientRect", { value: () => ({ left: 0, width: 1000, top: 0, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON() {} }) });
    const divider = screen.getByTestId("split-divider");
    fireEvent.pointerDown(divider, { clientX: 500, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 700, clientY: 0 });
    fireEvent.pointerUp(window);
    expect(setSplitViewRatio).toHaveBeenCalled();
    const lastCall = setSplitViewRatio.mock.calls.at(-1)?.[0];
    expect(lastCall).toBeGreaterThanOrEqual(0.2);
    expect(lastCall).toBeLessThanOrEqual(0.8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/SplitView.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SplitView`**

Create `src/components/SplitView.tsx` (drag pattern adapted from `Layout.handleResizePointerDown`):

```tsx
import { useCallback, useRef } from "react";
import type { Page } from "../lib/db";
import { Editor } from "./PageEditor";
import { useAppStore } from "../store/useAppStore";
import type { SplitPane } from "../store/slices/splitSlice";

export function SplitView({
  primary,
  secondary,
  pages,
  onSelectPrimaryPage,
  onSelectSecondaryPage,
}: {
  primary: Page;
  secondary: Page;
  pages: Page[];
  onSelectPrimaryPage: (id: string) => void;
  onSelectSecondaryPage: (id: string) => void;
}) {
  const splitViewRatio = useAppStore((s) => s.splitViewRatio);
  const setSplitViewRatio = useAppStore((s) => s.setSplitViewRatio);
  const setActivePane = useAppStore((s) => s.setActivePane);
  const containerRef = useRef<HTMLDivElement>(null);

  const markActive = useCallback((pane: SplitPane) => () => setActivePane(pane), [setActivePane]);

  const handleDividerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const container = containerRef.current;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width || 1;
    const startX = event.clientX;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const newRatio = splitViewRatio + delta / containerWidth;
      setSplitViewRatio(newRatio);
    };
    const handlePointerUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  return (
    <div
      ref={containerRef}
      data-testid="split-container"
      className="flex h-full w-full flex-row"
    >
      <div
        className="flex min-w-0 flex-1 flex-col"
        style={{ flexBasis: `${splitViewRatio * 100}%`, flexGrow: splitViewRatio, flexShrink: splitViewRatio }}
        onFocus={markActive("primary")}
        onPointerDown={markActive("primary")}
      >
        <Editor page={primary} pages={pages} onSelectPage={onSelectPrimaryPage} />
      </div>
      <div
        data-testid="split-divider"
        role="separator"
        aria-orientation="vertical"
        className="w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-border"
        onPointerDown={handleDividerPointerDown}
      />
      <div
        className="flex min-w-0 flex-1 flex-col border-l border-border/40"
        style={{ flexBasis: `${(1 - splitViewRatio) * 100}%`, flexGrow: 1 - splitViewRatio, flexShrink: 1 - splitViewRatio }}
        onFocus={markActive("secondary")}
        onPointerDown={markActive("secondary")}
      >
        <Editor page={secondary} pages={pages} onSelectPage={onSelectSecondaryPage} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/SplitView.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/SplitView.tsx src/components/SplitView.test.tsx
git commit -m "feat: add SplitView component with draggable divider"
```

---

## Task 7: Wire `SplitView` into `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the split branch to the editor render path**

In `src/App.tsx`, in the `return` JSX, change the editor branch (currently around lines 223-228) from:

```tsx
      ) : currentPage ? (
        <ErrorBoundary key={currentPage.id}>
          <Suspense fallback={<WorkspaceLoadingFallback />}>
            <Editor page={currentPage} pages={pages} onSelectPage={setCurrentPageId} />
          </Suspense>
        </ErrorBoundary>
      ) : (
```

to:

```tsx
      ) : currentPage ? (
        secondaryPageId && secondaryPage ? (
          <ErrorBoundary key={`${currentPage.id}-${secondaryPage.id}`}>
            <Suspense fallback={<WorkspaceLoadingFallback />}>
              <SplitView
                primary={currentPage}
                secondary={secondaryPage}
                pages={pages}
                onSelectPrimaryPage={setCurrentPageId}
                onSelectSecondaryPage={setSecondaryPageId}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <ErrorBoundary key={currentPage.id}>
            <Suspense fallback={<WorkspaceLoadingFallback />}>
              <Editor page={currentPage} pages={pages} onSelectPage={setCurrentPageId} />
            </Suspense>
          </ErrorBoundary>
        )
      ) : (
```

- [ ] **Step 2: Add store selectors and imports**

Near the other store reads (after `const setCurrentPageId = ...`), add:

```ts
  const secondaryPageId = useAppStore((state) => state.secondaryPageId);
  const setSecondaryPageId = useAppStore((state) => state.setSecondaryPageId);
  const secondaryPage = secondaryPageId ? pagesById.get(secondaryPageId) : undefined;
```

(`pagesById` already exists at line 149.) Add the import at top:

```ts
import { SplitView } from "./components/SplitView";
```

- [ ] **Step 3: Verify type-check and build**

Run: `npm run build`
Expected: succeeds (tsc + vite build).

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: render SplitView in App when secondary page is set"
```

---

## Task 8: Keyboard shortcuts in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Extend the global keydown handler**

In `src/App.tsx`, in the existing `useEffect` keydown handler (around lines 91-114), add split handlers. The picker is opened via the `PageEditor` toolbar button, but the `⌘\` shortcut (when not already in split) must also open it — so add a transient store flag `isSplitPickerOpen` + `openSplitPicker`/`closeSplitPicker` actions to `splitSlice` first.

First, extend `splitSlice.ts`. Add to the `SplitSlice` interface:

```ts
  isSplitPickerOpen: boolean;
  openSplitPicker: () => void;
  closeSplitPicker: () => void;
```

with implementation (not persisted):

```ts
  isSplitPickerOpen: false,
  openSplitPicker: () => set({ isSplitPickerOpen: true }),
  closeSplitPicker: () => set({ isSplitPickerOpen: false }),
```

Then add these handlers at the TOP of `handleKeyDown`, before the `⌘K` block:

```ts
      const isMod = event.metaKey || event.ctrlKey;
      if (isMod && !event.shiftKey && !event.altKey && event.key === "\\") {
        event.preventDefault();
        const state = useAppStore.getState();
        if (state.secondaryPageId) {
          state.closeSplit();
        } else {
          state.openSplitPicker();
        }
        return;
      }
      if (isMod && event.shiftKey && !event.altKey && event.key === "]") {
        event.preventDefault();
        const state = useAppStore.getState();
        state.setActivePane(state.activePane === "primary" ? "secondary" : "primary");
        return;
      }
      if (isMod && event.shiftKey && !event.altKey && event.key === "\\") {
        event.preventDefault();
        useAppStore.getState().swapSplit();
        return;
      }
```

**Ordering note:** these checks go before `⌘K`. The existing `⌘K` block already has `!event.shiftKey`, so it will not fire on `⌘⇧\` — keep that guard.

- [ ] **Step 2: Update the `splitSlice` test for the picker flag**

Append to `src/store/slices/splitSlice.test.ts`:

```ts
  it("openSplitPicker/closeSplitPicker toggle the flag", () => {
    expect(useAppStore.getState().isSplitPickerOpen).toBe(false);
    useAppStore.getState().openSplitPicker();
    expect(useAppStore.getState().isSplitPickerOpen).toBe(true);
    useAppStore.getState().closeSplitPicker();
    expect(useAppStore.getState().isSplitPickerOpen).toBe(false);
  });
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/store/slices/splitSlice.test.ts src/components/SplitView.test.tsx`
Expected: PASS.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/store/slices/splitSlice.ts src/store/slices/splitSlice.test.ts
git commit -m "feat: add split-view keyboard shortcuts (cmd+\\, cmd+shift+\\, cmd+shift+])"
```

---

## Task 9: Toolbar button + dropdown menu in `PageEditor`

**Files:**
- Modify: `src/components/PageEditor.tsx`

- [ ] **Step 1: Add split state reads and refs**

Near the top of `EditorSurface` (after line ~599 where other `useState`/`useRef` are declared), add:

```tsx
  const secondaryPageId = useAppStore((state) => state.secondaryPageId);
  const openSplitPicker = useAppStore((state) => state.openSplitPicker);
  const isSplitPickerOpen = useAppStore((state) => state.isSplitPickerOpen);
  const closeSplitPicker = useAppStore((state) => state.closeSplitPicker);
  const swapSplit = useAppStore((state) => state.swapSplit);
  const closeSplit = useAppStore((state) => state.closeSplit);
  const [isSplitMenuOpen, setIsSplitMenuOpen] = useState(false);
  const splitButtonRef = useRef<HTMLButtonElement>(null);
  const splitPickerRef = useRef<HTMLButtonElement>(null);
  const isInSplit = secondaryPageId !== null;
```

- [ ] **Step 2: Add the split button to the actions row**

In the "Saved Status and Actions on the right" `<div>` (around line 1213), insert BEFORE the `MoreHorizontal` button (before line 1220):

```tsx
            <button
              type="button"
              ref={splitButtonRef}
              className={`rounded-md p-1 transition-colors ${isInSplit ? "text-foreground bg-muted" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              aria-label={t("editor.splitView")}
              title={t("editor.splitView")}
              aria-pressed={isInSplit}
              onClick={() => setIsSplitMenuOpen((open) => !open)}
            >
              <Columns2 className="h-4 w-4" />
            </button>
```

Add `Columns2` and `ArrowsLeftRight` to the lucide-react import on line 21:

```ts
import { AlertTriangle, ArrowsLeftRight, Check, ChevronDown, ChevronUp, Columns2, Copy, Download, FileText, FolderInput, GripVertical, Image, MoreHorizontal, PlusCircle, Sigma, Smile, Star, Trash2, X } from "lucide-react";
```

- [ ] **Step 3: Add the dropdown menu popover**

Immediately after the `MoreHorizontal` button's closing `</FloatingPopover>` (around line 1306), add:

```tsx
            <FloatingPopover
              anchorElement={splitButtonRef.current}
              open={isSplitMenuOpen}
              width={240}
              placement="bottom-end"
              onOpenChange={setIsSplitMenuOpen}
              className="on-popover"
            >
              {!isInSplit ? (
                <button
                  type="button"
                  className="on-menu-item"
                  onClick={() => {
                    setIsSplitMenuOpen(false);
                    openSplitPicker();
                  }}
                >
                  <Columns2 className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("editor.splitView")}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="on-menu-item"
                    onClick={() => {
                      setIsSplitMenuOpen(false);
                      openSplitPicker();
                    }}
                  >
                    <Columns2 className="h-3.5 w-3.5 text-muted-foreground" />
                    {t("editor.chooseSplitPage")}
                  </button>
                  <button
                    type="button"
                    className="on-menu-item"
                    onClick={() => {
                      swapSplit();
                      setIsSplitMenuOpen(false);
                    }}
                  >
                    <ArrowsLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                    {t("editor.swapPanels")}
                    <span className="ml-auto text-xs text-muted-foreground">⌘⇧\</span>
                  </button>
                  <div className="on-menu-separator" />
                  <button
                    type="button"
                    className="on-menu-item"
                    onClick={() => {
                      closeSplit();
                      setIsSplitMenuOpen(false);
                    }}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                    {t("editor.closeSecondary")}
                    <span className="ml-auto text-xs text-muted-foreground">⌘\</span>
                  </button>
                </>
              )}
            </FloatingPopover>
            <FloatingPopover
              anchorElement={splitButtonRef.current}
              open={isSplitPickerOpen}
              width={320}
              placement="bottom-end"
              onOpenChange={(open) => { if (!open) closeSplitPicker(); }}
              className="on-popover on-command-panel"
            >
              <SplitPagePicker
                currentPageId={page.id}
                onChoose={(id) => {
                  openInSplit(id);
                  closeSplitPicker();
                }}
              />
            </FloatingPopover>
```

Do NOT add a static import for `openInSplit` — obtain it from the store via a selector in Step 4 instead.

- [ ] **Step 4: Add the `openInSplit` selector**

Add to the selector list from Step 1:

```tsx
  const openInSplit = useAppStore((state) => state.openInSplit);
```

Use this `openInSplit` in the picker's `onChoose` callback in Step 3.

- [ ] **Step 5: Create the `SplitPagePicker` inline sub-component**

Add inside `PageEditor.tsx` (near the other internal components, e.g. after `ShelfSideMenu` at line ~74):

```tsx
import { useEffect, useRef, useState } from "react";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import { searchPages } from "../lib/db";
import type { SearchResult } from "../lib/db";
import { useAppStore } from "../store/useAppStore";
import { useT } from "../lib/i18n";
import { PageSearchResults } from "./PageSearchResults";

function SplitPagePicker({ currentPageId, onChoose }: { currentPageId: string; onChoose: (id: string) => void }) {
  const t = useT();
  const pages = useAppStore((s) => s.pages);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }
    setIsSearching(true);
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      searchPages(query)
        .then((results) => { if (!cancelled) setSearchResults(results); })
        .catch(() => { if (!cancelled) setSearchError(t("commandPalette.searchFailed")); })
        .finally(() => { if (!cancelled) setIsSearching(false); });
    }, 150);
    return () => { cancelled = true; window.clearTimeout(timeout); };
  }, [query, t]);

  return (
    <div>
      <div className="on-command-input-row">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          className="min-w-0 flex-1 border-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          placeholder={t("commandPalette.searchSplit")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="on-command-results" style={{ maxHeight: 320 }}>
        <PageSearchResults
          query={query}
          pages={pages}
          searchResults={searchResults}
          onSelectPage={onChoose}
          isSearching={isSearching}
          searchError={searchError}
          disabledPageId={currentPageId}
          alreadyOpenKey="editor.alreadyOpen"
          emptyKey="commandPalette.noPagesYet"
          noResultsKey="commandPalette.noResults"
          searchingKey="commandPalette.searching"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/PageEditor.tsx
git commit -m "feat: add split-view toolbar button, dropdown menu, and page picker"
```

---

## Task 10: `activePane`-aware Sidebar

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Replace `currentPageId` highlight with derived active-page value**

In `src/components/Sidebar.tsx`, the main component reads `currentPageId` (line 167/178) and uses it both for highlight (`currentPageId === page.id` at line 428) and as the click handler target.

Add selectors near line 167:

```tsx
  const secondaryPageId = useAppStore((s) => s.secondaryPageId);
  const activePane = useAppStore((s) => s.activePane);
  const setSecondaryPageId = useAppStore((s) => s.setSecondaryPageId);
```

Then compute the effective active page for highlight + click target:

```tsx
  const effectiveActivePageId = secondaryPageId
    ? (activePane === "secondary" ? secondaryPageId : currentPageId)
    : currentPageId;
```

Replace the highlight condition at line 428 (`${currentPageId === page.id ? 'on-shell-row-active' : ''}`) with `${effectiveActivePageId === page.id ? 'on-shell-row-active' : ''}`.

- [ ] **Step 2: Route sidebar clicks to the active pane**

Find the page-row click handler that calls `setCurrentPageId(page.id)` (the one feeding the main page list, not the studio-tree one). Replace that single call with:

```tsx
    if (secondaryPageId && activePane === "secondary") {
      setSecondaryPageId(page.id);
    } else {
      setCurrentPageId(page.id);
    }
```

(If the handler is inline in the row's `onClick`, wrap accordingly. Do NOT change the studio-note-tree handlers — those target studio notes specifically.)

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: sidebar highlights/clicks follow the active split pane"
```

---

## Task 11: Polish — restore arrow-key navigation inside `PageSearchResults`

**Files:**
- Modify: `src/components/PageSearchResults.tsx`
- Modify: `src/components/CommandPalette.tsx`

(The Task 5 refactor moved the page list out of `CommandPalette`, so arrow-key/Enter page navigation regressed. This restores it via optional callbacks.)

- [ ] **Step 1: Add optional selection props to `PageSearchResults`**

Extend its props:

```tsx
export function PageSearchResults({
  // ...existing...
  selectedIndex,
  setSelectedIndex,
  onSelectPage,
}: {
  // ...existing...
  selectedIndex?: number;
  setSelectedIndex?: (index: number) => void;
  onSelectPage: (id: string) => void;
  // ...
}) {
```

Compute a flat page list and apply highlight + `onMouseEnter`:

```tsx
  const flatPages = sections.flatMap((s) => s.pages);
```

Inside the per-page button, add:

```tsx
            const absoluteIndex = sectionStartIndex + withinSectionIndex; // track as you map
            const isSelected = selectedIndex != null && absoluteIndex === selectedIndex;
            // className includes `${isSelected ? "on-command-item-selected" : ""}`
            onMouseEnter={() => setSelectedIndex?.(absoluteIndex)}
```

(Track `sectionStartIndex` by accumulating as you iterate sections — see the original CommandPalette code at lines 239-244.)

- [ ] **Step 2: Wire keyboard nav in `CommandPalette`**

In `CommandPalette.tsx`, keep `flattenedPages` and `selectedIndex` and pass them down:

```tsx
          <PageSearchResults
            ...
            selectedIndex={showCommands ? selectedIndex - commandItems.length : selectedIndex}
            setSelectedIndex={(i) => setSelectedIndex(i + (showCommands ? commandItems.length : 0))}
            onSelectPage={handleSelect}
          />
```

Keep `handleModalKeyDown` computing indices with `flattenedPages`. The Enter handler already calls `handleSelect(page.id)`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/components/CommandPalette.test.tsx src/components/PageSearchResults.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/PageSearchResults.tsx src/components/CommandPalette.tsx
git commit -m "fix: restore arrow-key navigation in shared PageSearchResults"
```

---

## Task 12: e2e test

**Files:**
- Create: `tests/e2e/split-view.e2e.ts`

The e2e suite uses a mock bridge + UI-driven page creation (see `tests/e2e/checklist.e2e.ts`). There is no shared `createPageViaApi` helper — pages are created via the UI with `installMockBridge` + `createPageAndFocusEditor`.

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/split-view.e2e.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "./helpers/mockBridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

async function createPageAndFocusEditor(page: Page, title: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New page" }).first().click();
  await page.getByText("Blank page").click();
  const titleInput = page.locator("textarea[placeholder='Untitled']");
  await expect(titleInput).toBeVisible({ timeout: 60_000 });
  await titleInput.fill(title);
  await titleInput.press("Enter");
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeFocused();
  return editor;
}

test("split view places two pages side by side", async ({ page }) => {
  test.setTimeout(45_000);
  await createPageAndFocusEditor(page, "Split A");
  // Navigate back to home to create the second page
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await createPageAndFocusEditor(page, "Split B");

  // Go home and open page A from the sidebar
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByText("Split A").first().click();

  // Open the split picker via toolbar
  await page.getByRole("button", { name: /split view|dividi vista/i }).click();
  await page.getByPlaceholder(/search a page|cerca una pagina/i).fill("Split B");
  await page.getByText("Split B").click();

  // Both editors visible
  await expect(page.getByText("Split A")).toBeVisible();
  await expect(page.getByText("Split B")).toBeVisible();

  // Toggle off with cmd+\
  await page.keyboard.press("Meta+\\");
  await expect(page.getByText("Split B")).toHaveCount(0);
});

test("swapping panels keeps both pages", async ({ page }) => {
  test.setTimeout(45_000);
  await createPageAndFocusEditor(page, "Swap A");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await createPageAndFocusEditor(page, "Swap B");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByText("Swap A").first().click();
  await page.getByRole("button", { name: /split view|dividi vista/i }).click();
  await page.getByPlaceholder(/search a page|cerca una pagina/i).fill("Swap B");
  await page.getByText("Swap B").click();
  await page.keyboard.press("Meta+Shift+\\");
  await expect(page.getByText("Swap A")).toBeVisible();
  await expect(page.getByText("Swap B")).toBeVisible();
});
```

- [ ] **Step 2: Run the e2e spec in isolation**

Run: `npx playwright test tests/e2e/split-view.e2e.ts`
Expected: PASS (re-run in isolation if a `page.goto("/")` timeout occurs — shared Vite server flakiness noted in AGENTS.md).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/split-view.e2e.ts
git commit -m "test: e2e coverage for split view"
```

---

## Task 13: Full gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 2: Run type-check + build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Run the full e2e suite**

Run: `npm run e2e`
Expected: green (re-run any flaky spec in isolation per AGENTS.md guidance).

- [ ] **Step 4: Manual smoke test in Electron**

Run: `npm run electron:dev`
Manual checks:
1. Open page A, click split button, pick page B → two panes side by side.
2. Drag divider → ratio changes.
3. Reload app (`Cmd+R`) → both pages + ratio restored.
4. Click into secondary pane → sidebar highlight follows; clicking a sidebar page opens in secondary.
5. `Cmd+\` closes; `Cmd+\` opens picker; `Cmd+Shift+\` swaps; `Cmd+Shift+]` moves focus.
6. Delete page B → split auto-closes.

- [ ] **Step 5: Commit any fixups and tag the feature**

```bash
git add -A
git commit -m "chore: split view full-gate verification" --allow-empty
```

---

## Notes for the implementer

- **Test environment:** default Vitest is `node`; component tests MUST start with `// @vitest-environment jsdom`. Pure store tests run fine in `node`.
- **localStorage in tests:** the store reads localStorage at import; tests call `useAppStore.setState(...)` to set known state and `localStorage.clear()` in `beforeEach`.
- **AGENTS.md flakiness note:** if a full `npm run e2e` fails on `page.goto("/")`, re-run the single spec — the shared Vite server is the known culprit.
- **The `Editor` component** is the existing `PageEditor.tsx` default export of `Editor` — do not duplicate it; `SplitView` composes two instances with different `onSelectPage` callbacks.
- **`resolveCurrentPageIdAfterDeletion`** and `pageTreeIds` already exist — reuse them; the split cleanup piggybacks on the existing delete flow.
```
