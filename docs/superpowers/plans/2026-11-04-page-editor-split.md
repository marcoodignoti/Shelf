# PageEditor Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut `src/components/PageEditor.tsx` (1971 lines) to under ~800 lines by moving self-contained pieces into focused files, with zero behavior change.

**Architecture:** Mechanical extraction, one responsibility per task. Pure decisions move to `src/lib/` as tested functions; React-only pieces (sub-components, effect bundles) move to `src/components/editor/` as components and `use*` hooks that take exactly the refs/state they read today. No logic is rewritten while moving: the existing e2e suite is the safety net, plus new unit tests for the extracted pure functions.

**Tech Stack:** React 19, TypeScript (real BlockNote 0.56 types), Vitest + jsdom, Playwright e2e against built `dist/`.

**Spec:** Audit point 6 in this session ("spezzare i componenti grandi, estraendo logica testata in `src/lib`"). Other large files (`Sidebar.tsx`, `editorMath.tsx`, `StudioWorkspace.tsx`) are separate plans.

## Global Constraints

- No behavior, markup, class-name, aria-label or copy changes. Visual baselines in `tests/e2e/visual.e2e.ts-snapshots/` must pass **without** `--update-snapshots`.
- Exported component name `Editor` from `src/components/PageEditor.tsx` and its props stay unchanged (callers: `Layout`, split view, `StudioWorkspace`).
- Keep `useCallback`/`useMemo` dependency lists identical when moving code; a moved hook receives refs (not `.current` values).
- e2e runs against `dist/`: always `npm run build` before `npx playwright test`.
- Commit directly on `main` after each green task (owner's workflow); never stage `exports/`, the `export:fisica2` script or `latex.css` lines in `package.json`.
- Per-task gate (referred to below as **GATE**):
  `npx tsc --noEmit -p . && npx vitest run && npm run build && npx playwright test tests/e2e/persistence.e2e.ts tests/e2e/checklist.e2e.ts tests/e2e/split-view.e2e.ts tests/e2e/studio.e2e.ts tests/e2e/visual.e2e.ts --reporter=line`
  Expected: tsc silent, all unit tests pass, all listed e2e pass (re-run a single failing spec in isolation before treating it as real).

## Review Focus

1. **Title Enter behaviour per setting** (`titleEnterBehavior`, with/without modifier, IME `insertLineBreak`): Enter must still jump to the editor body or insert a newline exactly as today — covered by the new pure-function test in Task 2.
2. **Pending local edits restored on reopen** (title/icon/cover from `pendingPageSaves` win over DB values; a pending `null` icon/cover clears it) — covered by Task 1 tests.
3. **Heading rail highlight during a click-initiated smooth scroll** must not flip back to the previous heading — Task 3 keeps the `pendingHeadingScrollRef` guard inside the hook; Task 3 test pins the threshold math.
4. **Studio side menu portal** (`sideMenuPortalEl`, `?? undefined`) and the block-type popover `editor={editor}` registration must survive the move — Task 4 verification greps for both.
5. **Locale switch recreates the editor** and autosave flushes the old instance — `editor` creation stays in `EditorSurface`; no task moves it.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/pageEditorInitialFields.ts` (+ `.test.ts`) | Pure: merge page row with pending local edits into initial title/icon/cover/content |
| `src/lib/editorTitleInput.ts` (+ `.test.ts`, existing) | Add pure decision for `insertLineBreak` in the title, next to `titleEnterShouldInsertNewline` |
| `src/lib/headingScrollSpy.ts` (+ `.test.ts`) | Pure: pick the active heading from measured offsets |
| `src/components/editor/useHeadingScrollSpy.ts` | Hook: scroll-spy effect + `scrollToHeading` |
| `src/components/editor/PageHeadingRail.tsx` | Moved component |
| `src/components/editor/EditorToolbars.tsx` | Moved: `ShelfSideMenu`, `ShelfDragHandleButton`, `ShelfBlockTypeSelect`, `ShelfFormattingToolbar`, `ShelfBlockTypeItem` |
| `src/components/editor/SubpageCreateMenu.tsx` | Moved component |
| `src/components/editor/useSlashMenuScrollLock.ts` | Hook: wheel lock + scroll pin while slash menu open |
| `src/components/editor/useEditorContentSync.ts` | Hook: math normalization on change + page-link inline sync |
| `src/components/editor/PageEditorTopBar.tsx` | Component: breadcrumb, save status, split button/picker, page menu (current JSX ~1238–1519) |
| `src/components/PageEditor.tsx` | `Editor` + `EditorSurface`: state, editor creation, composition |

---

### Task 1: Initial fields from pending edits

**Files:**
- Create: `src/lib/pageEditorInitialFields.ts`, `src/lib/pageEditorInitialFields.test.ts`
- Modify: `src/components/PageEditor.tsx:611-625,666`

**Interfaces:**
- Produces: `initialEditorFields(page: Pick<Page, "title" | "icon" | "cover_url" | "content">, pending: Partial<Page> | null): { title: string; icon: string; coverUrl: string; content: string | null }` — `content` is the pending content string or `null` (caller keeps its existing fallback to `page.content`).

- [ ] **Step 1: Write failing tests** in `pageEditorInitialFields.test.ts`:
  - no pending → `{ title: page.title, icon: page.icon ?? "", coverUrl: page.cover_url ?? "", content: null }`
  - pending `{ title: "Draft" }` → title `"Draft"`, other fields from page
  - pending `{ icon: null }` with `page.icon = "📌"` → icon `""` (pending null clears)
  - pending `{ cover_url: "x.png" }` → coverUrl `"x.png"`
  - pending `{ title: 42 as never }` → title falls back to `page.title`
  - pending `{ content: "[]" }` → content `"[]"`
- [ ] **Step 2:** `npx vitest run src/lib/pageEditorInitialFields.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement by moving the `hasPendingField`/`pending*` expressions verbatim; replace them in `EditorSurface` with one `useMemo(() => initialEditorFields(page, pendingPageUpdates), [page.id])`-derived value feeding the three `useState` initializers and `pendingContent`.
- [ ] **Step 4:** Run the test → PASS, then **GATE** → PASS.
- [ ] **Step 5:** `git commit -m "Extract initial editor fields from pending edits"`

### Task 2: Title Enter decision

**Files:**
- Modify: `src/lib/editorTitleInput.ts`, `src/lib/editorTitleInput.test.ts` (create the test file if absent)
- Modify: `src/components/PageEditor.tsx:899-937`

**Interfaces:**
- Consumes: existing `titleEnterShouldInsertNewline` in the same module (unchanged).
- Produces: `titleBeforeInputAction(inputType: string, modifierWasHeld: boolean): "ignore" | "focus-body" | "insert-newline"`.

- [ ] **Step 1: Failing tests:** `("insertText", false) → "ignore"`, `("insertLineBreak", false) → "focus-body"`, `("insertLineBreak", true) → "insert-newline"`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; rewrite `handleTitleBeforeInput` as a `switch` on the result, keeping the existing side effects (blur + `focusEditorBody`, or the `requestAnimationFrame` newline commit) unchanged.
- [ ] **Step 4:** Test PASS, **GATE** PASS.
- [ ] **Step 5:** Commit `"Extract title before-input decision"`.

### Task 3: Heading rail + scroll spy

**Files:**
- Create: `src/lib/headingScrollSpy.ts` (+ test), `src/components/editor/useHeadingScrollSpy.ts`, `src/components/editor/PageHeadingRail.tsx`
- Modify: `src/components/PageEditor.tsx` (remove `PageHeadingRail` 79-147, effects/handlers ~824-1026)

**Interfaces:**
- Produces: `activeHeadingFromOffsets(headings: { id: string; top: number | null }[], containerTop: number, threshold = 140): string | null` — first heading id when none passed; skips `top === null` (unmounted); stops at the first heading below `containerTop + threshold`; `null` for an empty list.
- Produces: `useHeadingScrollSpy({ editor, scrollContainerRef, headingItems }): { activeHeadingId: string | null; scrollToHeading: (id: string) => void }` — owns `activeHeadingId` state, `pendingHeadingScrollRef`, scroll/scrollend/resize listeners.
- Produces: `PageHeadingRail` with unchanged props `{ items, activeId, onSelect }`.

- [ ] **Step 1: Failing tests** for `activeHeadingFromOffsets`: empty → `null`; all below threshold → first id; tops `[0, 100, 500]`, containerTop 0 → second id (100 ≤ 140, 500 > 140); `[null, 50]` → second id; exact boundary `top === containerTop + 140` counts as passed.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the pure function; move the effect and `scrollToHeading` into the hook, replacing the inner loop with a call that measures `getBoundingClientRect().top` per heading (null when the element is missing). Move `PageHeadingRail` verbatim.
- [ ] **Step 4:** Test PASS, **GATE** PASS.
- [ ] **Step 5:** Commit `"Move heading rail and scroll spy out of PageEditor"`.

### Task 4: Toolbars, side menu and subpage menu

**Files:**
- Create: `src/components/editor/EditorToolbars.tsx`, `src/components/editor/SubpageCreateMenu.tsx`
- Modify: `src/components/PageEditor.tsx` (remove 68-78 `ShelfSideMenu`, 148-485, 486-540)

**Interfaces:**
- Produces: named exports `ShelfSideMenu`, `ShelfFormattingToolbar` (only these two are used by `EditorSurface`; `ShelfDragHandleButton`, `ShelfBlockTypeSelect`, `ShelfBlockTypeItem` stay module-private), and `SubpageCreateMenu` with unchanged props. `ICON_OPTIONS` stays in `PageEditor.tsx` (used by the icon menu).

- [ ] **Step 1:** Move code verbatim with its imports; delete now-unused imports from `PageEditor.tsx` (tsc `noUnusedLocals` will flag them).
- [ ] **Step 2:** Verify the 0.56 fixes survived: `grep -n "editor={editor}" src/components/editor/EditorToolbars.tsx` → 1 match; `grep -n "sideMenuPortalEl ?? undefined" src/components/PageEditor.tsx` → 1 match.
- [ ] **Step 3:** **GATE** PASS.
- [ ] **Step 4:** Commit `"Move editor toolbars and subpage menu into components/editor"`.

### Task 5: Slash-menu scroll lock and content sync hooks

**Files:**
- Create: `src/components/editor/useSlashMenuScrollLock.ts`, `src/components/editor/useEditorContentSync.ts`
- Modify: `src/components/PageEditor.tsx` (effects ~1027-1083 and ~1084-1138)

**Interfaces:**
- Produces: `useSlashMenuScrollLock({ editor, scrollContainerRef, isSlashMenuOpen, setIsSlashMenuOpen }): void` — owns `slashMenuLockedScrollTopRef` and the wheel/scroll listeners.
- Produces: `useEditorContentSync({ editor, pages, queueContentSave, isNormalizingMathRef }): { handleEditorChange: () => void }` — owns math normalization on change and on mount, and the `pageLinkSyncSignature`/`pagesRef` sync effect (keep the existing eslint-disable comment and its dependency list).

- [ ] **Step 1:** Move both effect groups verbatim into the hooks; `EditorSurface` passes `handleEditorChange` from the hook to `BlockNoteView onChange`.
- [ ] **Step 2:** **GATE** PASS (persistence covers slash-menu wheel lock, math paste normalization and inline page-link refresh).
- [ ] **Step 3:** Commit `"Move slash-menu scroll lock and content sync into hooks"`.

### Task 6: Top bar component

**Files:**
- Create: `src/components/editor/PageEditorTopBar.tsx`
- Modify: `src/components/PageEditor.tsx` (JSX ~1238-1519)

**Interfaces:**
- Produces: `PageEditorTopBar(props: { page: Page; breadcrumbs: ReturnType<typeof pageBreadcrumb>; saveState: EditorSaveState; pageMenu: { open: boolean; setOpen: (open: boolean) => void; buttonRef: RefObject<HTMLButtonElement | null> }; split: { isInSplit: boolean; isMenuOpen: boolean; setMenuOpen: (open: boolean) => void; buttonRef: RefObject<HTMLButtonElement | null> }; actions: ReturnType<typeof usePageActions>; onOpenHistory: () => void }): JSX.Element` — reads split-store selectors (`openInSplit`, `swapSplit`, `closeSplit`, `isSplitPickerOpen`, `openSplitPicker`, `closeSplitPicker`) itself via `useAppStore`. Rendered only when `!isStudioVariant`, as today.

- [ ] **Step 1:** Move the JSX block verbatim; move the split-store selectors it alone uses into the component; pass the rest through the props above (adjust prop shape only if tsc shows a value the block reads that is not listed — add it, do not restructure).
- [ ] **Step 2:** **GATE** PASS (split-view e2e + visual `editor-page` baseline cover this bar).
- [ ] **Step 3:** `wc -l src/components/PageEditor.tsx` → expect ≤ ~800.
- [ ] **Step 4:** Commit `"Extract PageEditor top bar"`.

### Task 7: Final verification

- [ ] **Step 1:** `npx playwright test --reporter=line` (full suite) → all pass.
- [ ] **Step 2:** `npm run check` → exit 0.
- [ ] **Step 3:** Update the BlockNote section of `CLAUDE.md` and `AGENTS.md`: editor UI pieces live in `src/components/editor/`. Commit `"Document components/editor layout"`, then `git push origin main`.
