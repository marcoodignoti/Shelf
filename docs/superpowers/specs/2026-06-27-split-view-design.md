# Split View (two pages side-by-side) — Design

Date: 2026-06-27
Status: approved in brainstorming, awaiting final document review

## Goal

Let the user place two note pages side-by-side in the same workspace (Notes mode only), so they can read/write one page while referencing another. This is a Notes-mode feature; Studio mode (PDF + note) and Home are unchanged.

Today `App.tsx` renders exactly one page at a time, driven by a single `currentPageId` in `sharedSlice`. This spec adds a resizable primary/secondary split with a page picker, persisted across restarts.

## User decisions (from brainstorming)

- **How the user opens the second page:** a button in the page editor toolbar that opens a dropdown menu (Safari-style tab menu).
- **Panel distribution:** resizable divider between the two panels (reuses the sidebar drag-handle pattern).
- **Navigation & closing model:** primary (left, `currentPageId`) + secondary (right, `secondaryPageId`). Navigation from the sidebar / inline links replaces the panel that currently has focus. Closing the secondary returns to single view.
- **Page choice:** a searchable page picker (reuses CommandPalette's search core). The user always picks which page to place beside; there is no "open the secondary with a default page" path.
- **Duplicate guard:** the page currently shown in the primary is disabled in the picker (you cannot place a page next to itself).
- **Persistence:** the split (both page IDs + ratio) survives an app restart.
- **Swap:** included — a `swapSplit` action exchanges primary and secondary.

## Out of scope (YAGNI)

- More than two panels.
- Split in Studio mode.
- Drag-and-drop pages from the sidebar into a panel.
- Vertical (stacked) layout.
- Multi-window (separate OS windows) — rejected during brainstorming.

## Architecture

### Store — new `splitSlice`

New file `src/store/slices/splitSlice.ts`, composed into `AppState` in `useAppStore.ts` alongside the existing slices.

```ts
// src/store/slices/splitSlice.ts
export interface SplitSlice {
  secondaryPageId: string | null;
  splitViewRatio: number;                 // 0.2–0.8, default 0.5
  activePane: "primary" | "secondary";    // which pane has focus (drives sidebar highlight)
  openInSplit: (id: string) => void;      // set secondaryPageId; never touches currentPageId
  setSecondaryPageId: (id: string | null) => void;
  setSplitViewRatio: (ratio: number) => void;  // clamp 0.2–0.8 + persist
  setActivePane: (pane: "primary" | "secondary") => void;
  closeSplit: () => void;                 // secondaryPageId = null (+ clear storage)
  swapSplit: () => void;                  // exchange currentPageId <-> secondaryPageId
}
```

State shape and conventions:
- `currentPageId` (already in `sharedSlice`) = **primary** panel (left).
- `secondaryPageId` = **secondary** panel (right).
- `activePane` = which pane currently has focus; determines which page the sidebar highlights and which pane a sidebar click targets. Initial value `"primary"`. When not in split, this is ignored (single view uses `currentPageId` as today).
- `splitViewRatio` is the primary panel's flex-basis fraction.

Persistence (localStorage, same mechanism as `sidebarWidth` / `currentPageId`):
- `opennotion-secondary-page-id` → `secondaryPageId`
- `opennotion-split-ratio` → `splitViewRatio`
- `activePane` and the picker state are NOT persisted (session-only).

Sanitization rules (enforced in `openInSplit` / `setSecondaryPageId` and at store init):
- If `secondaryPageId === currentPageId` → treat as "not in split" (secondaryPageId = null). This covers the restart edge case where the primary was navigated onto the secondary's page after the last session.
- `splitViewRatio` clamped to `[0.2, 0.8]` on read and on every set.

Cross-slice integration:
- `deletePage` (in `pagesSlice`) must clear `secondaryPageId` when the deleted id matches it (auto-`closeSplit`). If the primary page is deleted, also `closeSplit()` and let the existing "no page selected" flow take over. No automatic secondary→primary promotion.

### Rendering — `SplitView`

New component `src/components/SplitView.tsx`, rendered from `App.tsx` **only** in Notes-mode editor state when `secondaryPageId != null`:

```
<main>                          ← existing in Layout.tsx (unchanged)
  <SplitView>                   ← new
    <EditorPane role="primary" />     ← <Editor page={currentPage} onSelectPage={setCurrentPageId} />
    <SplitDivider />                  ← drag handle (reuses Layout.handleResizePointerDown pattern)
    <EditorPane role="secondary" />   ← <Editor page={secondaryPage} onSelectPage={setSecondaryPageId} />
  </SplitView>
</main>
```

- Layout: `flex flex-row`. Primary `flex: <ratio> 1 0`; secondary `flex: 1 1 0`. Divider fixed width (~6px), `cursor: col-resize`.
- Each pane is the existing `Editor` component (`variant="page"`), unchanged internally. The only difference is the `onSelectPage` callback passed in: primary → `setCurrentPageId`, secondary → `setSecondaryPageId`. This keeps inline page-link navigation within its own pane.
- Divider drag: same pointer-event technique as `Layout.handleResizePointerDown` (capture startX/startWidth, compute delta, call `setSplitViewRatio`). Ratio stored as primary-fraction so it is pane-agnostic.
- Focus tracking: each pane reports focus via `onFocus`/`onPointerDown` → `setActivePane("primary"|"secondary")`. Clicking into a pane sets it active. `Editor` instances are wrapped so the focus handler is on the pane container, not the editor internals.

`App.tsx` change is minimal: in the existing editor branch, branch on `secondaryPageId`:

```tsx
currentPage ? (
  secondaryPageId ? (
    <SplitView primary={currentPage} secondary={secondaryPage} ... />
  ) : (
    <Editor page={currentPage} ... />   // unchanged single-view path
  )
) : ( ...empty state... )
```

Studio, Settings-window, Home branches are untouched.

### Toolbar button + dropdown menu

A new icon button in the `PageEditor` toolbar (alongside icon/cover/star/`MoreHorizontal`). Icon: `Columns2` from lucide-react. Active state when `secondaryPageId != null` (same visual treatment as the `Star` toggle when favorited). Tooltip: "Split view".

The dropdown is a `FloatingPopover` (the same component used for the icon/cover/other-actions menus) with items, in order:

1. **Split view** (`Columns2`) → opens the page picker. Hidden when already in split.
2. **Choose page for panel…** → opens the page picker again (change the secondary). Visible only in split.
3. **Swap panels** (`ArrowsLeftRight`, accelerator `⌘⇧\`) → `swapSplit()`. Visible only in split.
4. **Close secondary panel** (`X`, accelerator `⌘\`) → `closeSplit()`. Visible only in split.

Items follow existing editor menu styling (icon-left + text, optional accelerator on the right, `muted` hover background). i18n keys below.

### Page picker (reusable)

Extract the search/list core from `CommandPalette` into a reusable unit so both the palette and the split picker share it:

- `searchPages(query)` from `src/lib/db.ts` (existing full-text search).
- `commandPaletteSections({ query, pages, searchResults })` from `src/lib/commandPaletteSections.ts` (sections into Favorites / All pages).
- `splitSearchMatch` + `HighlightedText` (match highlighting, already in CommandPalette).

The split picker is a `FloatingPopover` anchored to the toolbar button (not a centered modal). Structure: search input row on top + scrollable results list (max-height ~320px). Differences from CommandPalette:
- No "New page" command.
- The page equal to the current primary's `currentPageId` is rendered **disabled** with a muted "already open" hint (duplicate guard). `PageEditor` passes `disabledPageId={currentPage.id}` to the picker.
- Selecting a result calls `openInSplit(id)` then closes the popover. ESC / outside-click cancels without opening a split.

Shared extraction: a small `PageSearchResults` presentational component (input + list + keyboard nav) consumed by both `CommandPalette` (modal shell) and the split picker (popover shell). The command items stay specific to CommandPalette; the page list is the shared part.

### Sidebar behavior

- When NOT in split: unchanged. Clicking a page sets `currentPageId`.
- When in split: clicking a page opens it in the **active** pane — i.e. calls `setCurrentPageId` if `activePane === "primary"`, else `setSecondaryPageId`. The highlighted/active page in the sidebar follows `activePane`: `activePane === "primary" ? currentPageId : secondaryPageId` (falling back to `currentPageId` when `secondaryPageId` is null).

## Edge cases

- **Delete secondary page** → auto `closeSplit()` (handled in `pagesSlice.deletePage`).
- **Delete primary page** → `closeSplit()` + existing "no page selected" flow. No promotion.
- **Switch to Studio / open Settings window** → `secondaryPageId` stays in store but is not rendered; split reappears on return to Notes (if `secondaryPageId` still valid).
- **Restart with `secondaryPageId === currentPageId`** → sanitized to "not in split" (see Sanitization).
- **Restart with a stale `secondaryPageId`** (page no longer exists) → sanitized: at init, if the id is not among `pages`, clear it. (Loaded pages are available at store hydration; the slice reads via `get().pages`.)
- **Picker open + secondary already set** → "Choose page for panel…" replaces the secondary in place (no close-then-reopen).

## Keyboard shortcuts

Registered in the global `useEffect` in `App.tsx` that already handles `⌘K` / `⌘⇧A` / new-page:

| Shortcut | macOS | Windows | Action |
|---|---|---|---|
| Toggle split | `⌘\` | `Ctrl+\` | If in split → `closeSplit()`; if not → open the picker |
| Swap panels | `⌘⇧\` | `Ctrl+Shift+\` | `swapSplit()` |
| Move focus between panes | `⌘⇧]` | `Ctrl+Shift+]` | toggle `activePane` primary↔secondary |

`Tab` and `⌘1..9` are deliberately avoided (conflict with editor and other shortcuts). Accelerators are shown right-aligned in the menu items.

## i18n

New keys added to `src/lib/locales/en.ts` and `src/lib/locales/it.ts` (string-key format `"namespace.key": "value",`):

| Key | en | it |
|---|---|---|
| `editor.splitView` | Split view | Dividi vista |
| `editor.splitViewOpen` | Open beside | Apri a fianco |
| `editor.chooseSplitPage` | Choose page for panel… | Scegli pagina per il pannello… |
| `editor.swapPanels` | Swap panels | Scambia pannelli |
| `editor.closeSecondary` | Close secondary panel | Chiudi pannello secondario |
| `editor.alreadyOpen` | Already open | Già aperta |
| `commandPalette.searchSplit` | Search a page to place beside… | Cerca una pagina da affiancare… |

## Testing

Following repo conventions (`*.test.ts` co-located in `src/lib` and `src/store`; e2e in `tests/e2e`):

- **Store unit** (`src/store/slices/splitSlice.test.ts`):
  - `openInSplit` sets `secondaryPageId` without touching `currentPageId`.
  - `swapSplit` exchanges the two ids.
  - `closeSplit` clears `secondaryPageId` and its storage key.
  - `setSplitViewRatio` clamps to `[0.2, 0.8]` and persists.
  - Sanitization: `openInSplit(currentPageId)` results in no split.
  - Stale id at init: non-existent `secondaryPageId` is cleared.
- **Pure unit** (`src/lib/pageSearchResults.test.ts` for the shared extraction): the `disabledPageId` page is excluded/disabled in the rendered list.
- **Component** (`src/components/SplitView.test.tsx`):
  - Renders two `Editor` instances with distinct `onSelectPage` callbacks.
  - Divider drag calls `setSplitViewRatio` with the expected value from the pointer delta.
  - Pane focus updates `activePane` via `setActivePane`.
- **e2e** (`tests/e2e/split-view.e2e.ts`):
  - Open page A → toolbar button → picker → choose page B → assert two panes side by side.
  - Drag divider → reload → assert ratio persisted.
  - `⌘\` opens/closes.
  - Delete page B → split auto-closes.

## Files touched (summary)

New:
- `src/store/slices/splitSlice.ts` (+ `.test.ts`)
- `src/components/SplitView.tsx` (+ `.test.tsx`)
- `src/components/PageSearchResults.tsx` (+ `.test.ts`) — shared picker core
- `tests/e2e/split-view.e2e.ts`

Modified:
- `src/store/useAppStore.ts` — compose `SplitSlice`
- `src/store/slices/pagesSlice.ts` — `deletePage` clears split on match
- `src/App.tsx` — branch to `SplitView` when `secondaryPageId` set; register shortcuts
- `src/components/PageEditor.tsx` — toolbar button + dropdown menu
- `src/components/CommandPalette.tsx` — consume shared `PageSearchResults`
- `src/components/Sidebar.tsx` — active-pane-aware highlight + click target
- `src/lib/locales/en.ts`, `src/lib/locales/it.ts` — new keys

No backend (`electron/*.cjs`) changes — split view is pure renderer state.
