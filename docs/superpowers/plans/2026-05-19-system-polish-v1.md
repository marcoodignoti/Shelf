# System Polish V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved System Polish V1 design so OpenNotion has one coherent shell UI language across light and dark themes, without changing editor, database, page-tree, or persistence behavior.
**Architecture:** Add a small tokenized CSS component layer in `src/index.css`, then apply those classes to existing shell markup in `Layout`, `Sidebar`, `CommandPalette`, `SettingsModal`, and delete-confirmation modal markup. Keep React component state, handlers, data attributes, keyboard behavior, z-index intent, and store calls unchanged.
**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, Zustand, Vitest, Tauri v2, lucide-react.

---

## Source Spec

- Approved design: `docs/superpowers/specs/2026-05-19-system-polish-v1-design.md`
- Direction: Hybrid Productive
- Scope: Foundation + Shell
- Explicit non-goals: database behavior, drag/drop behavior, editor behavior, page ordering semantics, persistence semantics, navigation model, new feature surfaces

## Current Worktree Constraint

- `src/components/DatabaseTableView.tsx` is already modified and belongs to separate database drag/drop work.
- Do not edit, stage, or commit `src/components/DatabaseTableView.tsx` in this polish plan.
- Every commit command below stages only explicit files.

## File Structure Map

```text
src/
  index.css
    Existing theme tokens and BlockNote overrides.
    Add blue-gray light/dark tokens and local component classes:
    on-icon-button, on-shell-row, on-shell-row-active, on-section-label,
    on-menu-item, on-menu-item-danger, on-popover, on-modal-overlay,
    on-modal-panel, on-modal-header, on-modal-body, on-modal-footer,
    on-button-secondary, on-button-danger, on-selectable-tile,
    on-selectable-tile-active, on-kbd.

  components/
    Layout.tsx
      App shell wrapper and sidebar toggle. Apply icon-button treatment only.

    Sidebar.tsx
      Sidebar navigation, page rows, context menus, move menu, new page menu,
      template/favorite/private sections, settings footer, delete confirmation.
      Apply row/menu/popover/modal classes while preserving all drag, keyboard,
      selection, rename, context menu, move, favorite, template, and delete logic.

    CommandPalette.tsx
      Search modal, input, result sections, selected result state.
      Apply modal shell, row/menu, section-label, and kbd classes. Do not change
      filtering, search debounce, keyboard navigation, or result selection.

    SettingsModal.tsx
      Settings shell, appearance choices, backup buttons/status.
      Apply modal shell, icon button, selectable tile, and shared button classes.
      Do not change import/export behavior.

    PageEditor.tsx
      Page delete confirmation modal only.
      Apply shared modal/button classes. Do not change editor, BlockNote,
      page actions, subpage, cover, icon, favorite, template, or move behavior.
```

## Task 1: Add Foundation Tokens And Component Classes

- [ ] Edit `src/index.css`.
- [ ] Replace the light token values inside `:root, .light` with blue-gray shell values:

```css
--background: 210 24% 98%;
--foreground: 222 28% 12%;
--card: 0 0% 100%;
--card-foreground: 222 28% 12%;
--popover: 0 0% 100%;
--popover-foreground: 222 28% 12%;
--primary: 222 28% 12%;
--primary-foreground: 210 24% 98%;
--secondary: 214 24% 94%;
--secondary-foreground: 222 28% 16%;
--muted: 214 24% 94%;
--muted-foreground: 215 14% 42%;
--accent: 214 28% 90%;
--accent-foreground: 222 28% 12%;
--destructive: 0 72% 48%;
--destructive-foreground: 0 0% 98%;
--border: 214 18% 84%;
--input: 214 18% 84%;
--ring: 222 28% 18%;
--radius: 0.5rem;
```

- [ ] Replace the dark token values inside `.dark` with:

```css
--background: 222 22% 8%;
--foreground: 214 24% 92%;
--card: 222 20% 10%;
--card-foreground: 214 24% 92%;
--popover: 222 20% 10%;
--popover-foreground: 214 24% 92%;
--primary: 214 24% 92%;
--primary-foreground: 222 22% 8%;
--secondary: 222 18% 12%;
--secondary-foreground: 214 20% 88%;
--muted: 222 16% 15%;
--muted-foreground: 215 12% 62%;
--accent: 220 16% 18%;
--accent-foreground: 214 24% 92%;
--destructive: 0 62% 42%;
--destructive-foreground: 0 0% 98%;
--border: 220 14% 22%;
--input: 220 14% 22%;
--ring: 214 24% 82%;
```

- [ ] In the existing `@layer components` block, before the BlockNote selectors, add these component classes:

```css
.on-icon-button {
  @apply inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50;
}

.on-shell-row {
  @apply flex w-full items-center rounded-md px-3 py-1.5 text-[13.5px] text-foreground/80 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-secondary;
}

.on-shell-row-active {
  @apply bg-accent text-foreground shadow-sm;
}

.on-section-label {
  @apply px-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground;
}

.on-menu-item {
  @apply flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-popover-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring;
}

.on-menu-item-danger {
  @apply text-destructive hover:bg-destructive/10 hover:text-destructive;
}

.on-popover {
  @apply overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl;
}

.on-modal-overlay {
  @apply fixed inset-0 z-[100] flex bg-background/80 backdrop-blur-sm;
}

.on-modal-panel {
  @apply overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl;
}

.on-modal-header {
  @apply flex items-center justify-between border-b border-border px-6 py-4;
}

.on-modal-body {
  @apply p-6;
}

.on-modal-footer {
  @apply flex justify-end gap-2 border-t border-border/60 px-4 py-3;
}

.on-button-secondary {
  @apply inline-flex items-center justify-center rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background;
}

.on-button-danger {
  @apply inline-flex items-center justify-center rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 focus-visible:ring-offset-background;
}

.on-selectable-tile {
  @apply flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-4 text-card-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background;
}

.on-selectable-tile-active {
  @apply border-primary bg-accent text-foreground shadow-sm;
}

.on-kbd {
  @apply rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground;
}
```

- [ ] Keep `.bn-*`, block drag, and BlockNote dark-mode overrides unchanged except for token color output through variables.
- [ ] Run `npm run build`.
- [ ] Run `npm run test`.
- [ ] Run `git diff --check -- src/index.css`.
- [ ] Commit only this file:

```bash
git add src/index.css
git commit -m "style: add system polish foundation"
```

## Task 2: Polish Layout Chrome

- [ ] Edit `src/components/Layout.tsx`.
- [ ] Preserve `isSidebarOpen`, `toggleSidebar`, fixed position logic, `data-tauri-drag-region`, and `<main>` behavior.
- [ ] Change the root shell background to a stable app surface:

```tsx
<div className="flex h-screen overflow-hidden bg-background text-foreground font-sans">
```

- [ ] Replace the sidebar toggle button class with:

```tsx
className="on-icon-button"
```

- [ ] Keep `title="Toggle sidebar"` and `<PanelLeft className="h-4 w-4" />` unchanged.
- [ ] Run `npm run build`.
- [ ] Run `npm run test`.
- [ ] Run `git diff --check -- src/components/Layout.tsx`.
- [ ] Commit only this file:

```bash
git add src/components/Layout.tsx
git commit -m "style: polish app shell chrome"
```

## Task 3: Polish Sidebar Rows, Sections, Popovers, And Footer

- [ ] Edit `src/components/Sidebar.tsx`.
- [ ] Do not alter store destructuring, state names, drag/drop helper functions, keyboard handlers, context-menu handlers, move handlers, delete handlers, `data-page-id`, refs, or event semantics.
- [ ] In the sidebar root, keep width and focus behavior, but refine the shell surface:

```tsx
className="w-60 bg-secondary/95 border-r border-border flex flex-col h-full overflow-hidden text-secondary-foreground outline-none ring-0 focus:outline-none focus:ring-0"
```

- [ ] Replace top navigation button classes for Home, New page, Search, and Settings with `on-shell-row` plus active state for Home:

```tsx
className={`on-shell-row ${currentPageId === HOME_PAGE_ID ? 'on-shell-row-active' : ''}`}
```

For New page, Search, and Settings:

```tsx
className="on-shell-row"
```

- [ ] Replace repeated section labels (`Templates`, `Favorites`, `Private`) with:

```tsx
<div className="on-section-label mb-1 mt-4">Templates</div>
```

Use the same pattern for Favorites and Private.

- [ ] Replace top-level template/favorite row class strings with:

```tsx
className="group on-shell-row mb-[1px] justify-between py-[3px] text-[13px]"
```

- [ ] In `PageItem`, replace the page row class with this pattern, preserving `dropClass` and dragged opacity:

```tsx
className={`group on-shell-row mb-[1px] justify-between py-[3px] text-[13px] select-none ${currentPageId === page.id ? 'on-shell-row-active' : ''} ${dropClass} ${draggedPageId === page.id ? 'opacity-45' : ''}`}
```

- [ ] Keep the inline left/right padding style exactly because it controls tree depth.
- [ ] Replace small row action button hover classes with `on-icon-button h-6 w-6 rounded-md`:

```tsx
className="on-icon-button mr-0.5 h-6 w-6 rounded-md"
```

Use this for favorite, move, add subpage, delete, disclosure buttons where sizing still fits. For disclosure buttons that must be invisible without children, keep the existing `invisible` conditional appended.

- [ ] Replace new-page popover, move popover, and page context menu wrappers with `on-popover`, preserving their fixed positioning, `z-*`, width, and inline `style`:

```tsx
className="fixed z-[140] w-56 on-popover"
className="fixed z-[130] w-56 on-popover"
className="fixed z-[140] w-44 on-popover"
```

- [ ] Replace menu item class strings with `on-menu-item`; append `on-menu-item-danger` for delete.
- [ ] Keep separators as `className="my-1 h-px bg-border"`.
- [ ] Keep empty sidebar state markup, but change its action button to text-tokenized hover only if needed:

```tsx
className="mt-2 block text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
```

- [ ] Run `npm run build`.
- [ ] Run `npm run test`.
- [ ] Run `git diff --check -- src/components/Sidebar.tsx`.
- [ ] Commit only this file:

```bash
git add src/components/Sidebar.tsx
git commit -m "style: polish sidebar shell"
```

## Task 4: Polish Command Palette

- [ ] Edit `src/components/CommandPalette.tsx`.
- [ ] Preserve all state, effects, search debounce, `handleModalKeyDown`, flattened result logic, `onMouseEnter`, `onClick`, and keyboard behavior.
- [ ] Change overlay wrapper to:

```tsx
className="on-modal-overlay items-start justify-center pt-[20vh]"
```

- [ ] Change the palette panel to:

```tsx
className="on-modal-panel flex w-[500px] max-w-[90vw] flex-col"
```

- [ ] Change the input header to:

```tsx
className="flex items-center border-b border-border px-4 py-3"
```

- [ ] Change the input class to include a visible focus state without adding borders:

```tsx
className="flex-1 border-none bg-transparent text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
```

- [ ] Replace the `ESC` hint class with `on-kbd`.
- [ ] Replace section label class with:

```tsx
className="on-section-label flex items-center gap-1.5 pb-1 pt-1"
```

- [ ] Change result row class so selected rows are visibly active:

```tsx
className={`flex cursor-pointer items-start rounded-md px-3 py-2 text-sm transition-colors ${isSelected ? 'bg-accent text-foreground' : 'text-foreground/80 hover:bg-accent hover:text-foreground'}`}
```

- [ ] Leave `HighlightedText` behavior unchanged.
- [ ] Run `npm run build`.
- [ ] Run `npm run test`.
- [ ] Run `git diff --check -- src/components/CommandPalette.tsx`.
- [ ] Commit only this file:

```bash
git add src/components/CommandPalette.tsx
git commit -m "style: polish command palette"
```

## Task 5: Polish Settings And Delete Confirmation Modals

- [ ] Edit `src/components/SettingsModal.tsx`.
- [ ] Preserve `handleExport`, `handleImport`, backup status, theme setters, Tauri dialog/fs calls, and store calls.
- [ ] Change overlay wrapper to:

```tsx
className="on-modal-overlay items-center justify-center p-4"
```

- [ ] Change panel wrapper to:

```tsx
className="on-modal-panel flex w-full max-w-lg flex-col"
```

- [ ] Change header wrapper to `className="on-modal-header"` and close button to `className="on-icon-button"`.
- [ ] Change body wrapper to `className="on-modal-body space-y-8"`.
- [ ] For Light, Dark, and System buttons, use:

```tsx
className={`on-selectable-tile ${theme === 'light' ? 'on-selectable-tile-active' : ''}`}
```

Use the matching theme string for each button.

- [ ] Change export/import buttons to:

```tsx
className="on-button-secondary w-full gap-2"
```

- [ ] Edit `src/components/Sidebar.tsx` delete confirmation modal only.
- [ ] Change overlay wrapper to:

```tsx
className="on-modal-overlay z-50 items-center justify-center"
```

- [ ] Change panel wrapper to:

```tsx
className="on-modal-panel w-[420px]"
```

- [ ] Keep destructive icon/copy exactly, but change footer buttons to:

```tsx
className="on-button-secondary"
className="on-button-danger"
```

- [ ] Edit `src/components/PageEditor.tsx` delete confirmation modal only.
- [ ] Change overlay wrapper to:

```tsx
className="on-modal-overlay z-[150] items-center justify-center"
```

- [ ] Change panel wrapper to:

```tsx
className="on-modal-panel w-[420px]"
```

- [ ] Keep delete copy and child-page conditional exactly.
- [ ] Change footer buttons to `on-button-secondary` and `on-button-danger`.
- [ ] Do not change any PageEditor behavior outside the delete confirmation modal.
- [ ] Run `npm run build`.
- [ ] Run `npm run test`.
- [ ] Run `git diff --check -- src/components/SettingsModal.tsx src/components/Sidebar.tsx src/components/PageEditor.tsx`.
- [ ] Commit only these files:

```bash
git add src/components/SettingsModal.tsx src/components/Sidebar.tsx src/components/PageEditor.tsx
git commit -m "style: unify shell modals"
```

## Task 6: Browser QA And Final Cleanup

- [ ] Start or reuse the Vite dev server:

```bash
npm run dev -- --host 127.0.0.1
```

- [ ] Use the Browser plugin against the local app URL.
- [ ] Smoke-check Home page render:
  - no framework error overlay
  - no blank app shell
  - sidebar toggle still opens/closes
  - main content remains document-like and unframed
- [ ] Smoke-check sidebar:
  - Home selected state visible
  - New page and Search rows hover/focus visually match Settings
  - Templates/Favorites/Private labels use same style
  - context menu still opens on page right-click when pages exist
  - move/new-page popovers render above sidebar and stay readable
- [ ] Smoke-check command palette:
  - `Meta+K` opens
  - typing filters or shows empty/search state
  - arrow selection state is visible
  - Enter still selects a result when one exists
  - Escape closes
- [ ] Smoke-check settings:
  - Settings opens
  - Light/Dark/System choices remain clickable
  - dark mode contrast is readable
  - backup buttons remain visible and aligned
- [ ] Smoke-check delete confirmation if a disposable page is available:
  - modal uses same visual shell
  - Cancel closes
  - Delete behavior unchanged
- [ ] Check browser console for relevant runtime errors. Ignore unrelated extension noise if present.
- [ ] Run final verification:

```bash
npm run build
npm run test
git diff --check -- src/index.css src/components/Layout.tsx src/components/Sidebar.tsx src/components/CommandPalette.tsx src/components/SettingsModal.tsx src/components/PageEditor.tsx
git status --short
```

- [ ] If QA required fixes, commit only explicit polish files:

```bash
git add src/index.css src/components/Layout.tsx src/components/Sidebar.tsx src/components/CommandPalette.tsx src/components/SettingsModal.tsx src/components/PageEditor.tsx
git commit -m "fix: refine system polish QA"
```

- [ ] Confirm `src/components/DatabaseTableView.tsx` remains unstaged unless the user explicitly asks to include separate database work.

## Self-Review Checklist

- [ ] Spec coverage: foundation tokens, shell rows, icon buttons, menus, popovers, command palette, settings, and delete modals are covered.
- [ ] Non-goal protection: no database row behavior, drag/drop, editor behavior, page ordering, persistence, or navigation model changes are planned.
- [ ] Placeholder scan: this plan contains no unresolved implementation placeholders.
- [ ] Type consistency: all class changes are string-only JSX changes and require no new TypeScript types.
- [ ] Risk control: commits are small and file-scoped; dirty database work is explicitly excluded.
- [ ] Validation: build, tests, diff check, and browser smoke are required before completion.
