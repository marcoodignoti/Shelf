# System Polish V1 Design

Date: 2026-05-19
Status: approved for planning
Direction: Hybrid Productive
Scope: Foundation + Shell

## Goal

Make OpenNotion feel more coherent, sharper, and more product-grade without changing editor or database behavior. The first pass should improve the perceived quality of the app shell and shared UI language while keeping implementation risk controlled.

## Selected Direction

Hybrid Productive is the chosen visual direction. It keeps the app clean and quiet, but adds stronger structure than the current neutral baseline:

- blue-gray neutral palette instead of pure grayscale
- clearer active, hover, and focus states
- restrained surfaces with consistent borders and shadows
- compact, work-focused density
- app-like shell polish without marketing-style visuals

This direction should feel between Notion's calm document surface and Obsidian's workspace/productivity traits, without copying either.

## Scope

V1 covers foundation and shell surfaces:

- global color tokens for light and dark themes
- radius, border, shadow, and focus-ring conventions
- shared class patterns for icon buttons, row buttons, menu items, popovers, modals, and segmented controls
- sidebar visual polish
- app chrome around the sidebar toggle and main content shell
- command palette visual polish
- settings modal visual polish
- destructive confirmation modal visual polish where it uses the same shell patterns

## Non-Goals

V1 must not change these systems:

- database row behavior, drag/drop behavior, table/board data behavior, sorting, filtering, or row creation
- editor block behavior, keyboard semantics, slash command behavior, or content persistence
- page tree data logic, page ordering semantics, or template/favorite persistence
- new navigation model or information architecture
- new feature surfaces

Database and editor polish can come next, after the foundation patterns are stable.

## Design Tokens

The global token layer should move from plain neutral grayscale toward a subtle blue-gray system:

- `background`: near-white in light mode, deep neutral in dark mode
- `foreground`: high contrast but not pure black/white
- `secondary` and `muted`: blue-gray shell surfaces
- `border`: visible enough to structure dense UI, not heavy
- `primary`: dark ink in light mode and light ink in dark mode
- `ring`: clear focus outline matching the foreground/primary family

Radius should be consistent and restrained:

- 6px for compact row/menu controls
- 8px for buttons, popovers, inputs, and segmented controls
- 10-12px for command palette and modal shells

Shadows should be reserved for floating surfaces:

- popovers and menus get a soft medium shadow
- modals get a slightly deeper shadow
- inline panels and rows use borders/backgrounds, not floating card shadows

## Shared UI Patterns

V1 should introduce reusable visual language through local CSS component classes or small shared helpers, depending on what best fits the current codebase. The goal is consistency without a large component rewrite.

Target patterns:

- menu item: compact row, icon slot, 12px text, 6px radius, consistent hover background
- icon button: square hit area, muted icon color, clear hover/focus state
- row button: sidebar/home list item with same padding, radius, and active state
- popover: border, background, 8-10px radius, consistent padding and shadow
- modal shell: shared overlay, card border/radius/shadow, consistent header/footer spacing
- segmented control: used for mode switches where applicable, with active segment on a raised white/dark surface

Existing behavior should remain unchanged. Refactor only class composition and minimal markup needed for visual consistency.

## Shell Surfaces

### Sidebar

The sidebar should become the strongest first impression:

- blue-gray `secondary` surface
- consistent row height and radius for Home, New page, Search, templates, favorites, private pages, settings
- clearer active row treatment
- section headers with restrained uppercase style
- less ad-hoc `bg-black/5` and `dark:bg-white/5` usage in favor of tokenized hover classes
- footer settings row aligned with other navigation rows

### Layout Chrome

The sidebar toggle should match the icon button system and remain visually stable with sidebar open or closed. The main content area should stay unframed and document-like.

### Command Palette

The palette should use the same modal shell and row pattern:

- consistent overlay
- cleaner command list rows
- clearer selected result state
- stable keyboard hint styling
- no change to filtering, grouping, or keyboard behavior

### Settings Modal

Settings should adopt the shared modal shell:

- consistent header/footer spacing
- appearance choices use the shared selectable row/card pattern
- backup buttons use shared button treatment
- no change to backup import/export behavior

### Delete Modals

Delete confirmation modals should use shared destructive icon, copy spacing, footer buttons, and modal shell. No delete logic changes.

## Accessibility And Interaction

V1 should improve visible interaction states:

- keyboard focus ring visible on buttons, inputs, and menu items
- hover states not color-only when possible; use background and text contrast
- active sidebar row has enough contrast in light and dark modes
- text remains readable at current font sizes
- no new animations required

No shortcuts or keyboard behavior should change.

## Implementation Boundaries

Preferred implementation path:

1. Add small design-system utility classes in `src/index.css`.
2. Apply those classes to shell surfaces in `Sidebar`, `Layout`, `CommandPalette`, `SettingsModal`, and confirmation modal markup.
3. Keep component structure mostly intact.
4. Avoid touching database/editor behavior files except where a shared class is already used without behavioral changes.

If a local class name is introduced, it should describe the pattern, not one component. Examples: `on-menu-item`, `on-icon-button`, `on-shell-row`, `on-popover`, `on-modal-panel`.

## Validation

Before completion, verify:

- `npm run build`
- `npm run test`
- rendered smoke check for the app load
- sidebar visual check in light and dark themes
- command palette opens and selected row state is visible
- settings modal opens and appearance options remain functional
- no framework error overlay
- no relevant console errors

If local browser data does not contain real pages, the rendered check should still cover Home, empty sidebar state, command palette, settings modal, and theme switching. Real workspace visual QA can be done by the user afterward.

## Risks

- Existing ad-hoc classes are spread across several components, so broad search-and-replace could create regressions.
- Dark theme contrast can regress if token changes are not checked visually.
- Modal and popover z-index behavior should not be changed in this pass.
- Existing database drag/drop work is currently separate and should not be mixed into this polish pass.

## Acceptance Criteria

- The app shell reads as one coherent system in light and dark modes.
- Sidebar, command palette, settings, and confirmation modal use the same visual language.
- Current app behavior remains unchanged.
- Build and test commands pass.
- Browser smoke check confirms the shell renders without overlays or relevant console errors.
