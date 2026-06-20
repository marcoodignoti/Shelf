# AI Assistant Popover — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorming complete, pending implementation plan)
**Goal:** Embed the official ChatGPT and Gemini web apps inside Shelf as a draggable popover, so the user can reach an AI assistant without leaving the app.

## Problem & Non-goals

**Problem.** Today a Shelf user who wants AI help must switch to a browser. The user wants the convenience of having ChatGPT and Gemini a click/shortcut away, directly inside Shelf.

**Non-goals (explicitly out of scope):**

- **No local/private AI.** This feature embeds the official cloud pages of OpenAI and Google. Conversations are not local; they are sent to the providers' servers. This is accepted by the user. The design honors the user's privacy requirement as: *"it's OK that the AI is cloud, as long as Shelf itself doesn't spy on anything"* — see the Security section.
- **No AI integration with Shelf content.** The assistant cannot read notes, Studio documents, or any Shelf data. It is a separate embedded browser surface, not an "agent over your workspace." (A future BYO-key API integration would be a separate project.)
- **No API key management.** The user logs into ChatGPT/Gemini with their existing accounts, inside the embedded page, exactly as they would in a browser.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Presentation | **Draggable popover** overlaid on the app (not a detached window, not a sidebar dock) |
| Provider UI | **Single switcher** in the popover header — one provider visible at a time, the other paused in memory |
| Providers | **Both ChatGPT and Gemini** |
| Entry points | **Sidebar button** (end of nav) + **keyboard shortcut `Cmd+Shift+A`** (no command palette, no titlebar icon) |
| State persistence | **Full state** across app launches: window bounds (x, y, w, h), last provider used, and provider login cookies |
| Auto-reopen on boot | **No** — popover opens only when the user explicitly invokes it |
| Footer transparency | **Yes** — small always-visible footer stating which provider serves the chat |
| Sidebar button icon | `MessageSquare` from lucide-react, no open-state indicator |
| Always-on-top | Tied to Shelf focus: popover hides when Shelf goes to background, reappears when Shelf regains focus |
| Default bounds | 420 × 640, anchored to the bottom-right of the main window with 16px margin |
| Resizable range | min 320 × 400, max 560 × 900 |

## Architecture

### Approach chosen: child frameless BrowserWindow + `<webview>` (Approach 2)

Three approaches were considered; this is the selected one. Rationale:

- A popover drawn *inside* the main React surface (Approach 1) would require an `<iframe>`, but (a) the renderer CSP is `frame-src 'none'` (`electron/main.cjs:566`) and cannot be relaxed without weakening the whole app, and (b) ChatGPT and Gemini send `X-Frame-Options: DENY` / CSP `frame-ancestors`, so they cannot be embedded in an iframe at all.
- A detached independent window (Approach 3) was rejected because it loses the "popover overlaid on the app" feel and would not hide/reappear with Shelf focus.
- The chosen approach — a **frameless child `BrowserWindow`** whose bounds *are* the popover's geometry (native drag/resize, trivial persistence), loading a minimal React shell that embeds each provider in a `<webview>` — gives the strongest isolation (each `<webview>` is a separate Chromium process) at the cost of one extra Vite entry and one extra preload.

### Component map

```
[main renderer]                       [popover child window]              [provider pages]
 React UI ──────────────────────────► React popover shell ─────────────► ChatGPT / Gemini
  Sidebar button,                     ├ header: drag handle,              (in <webview>, separate
  Cmd+Shift+A shortcut                │   switcher (single), close          process, partition:
                                       └ <webview> per provider              persist:ai-assistant-*)
        │                                     ▲
        │ invoke("ai_assistant_open", …)      │
        ▼                                     │ parent bounds + provider
  electron/main.cjs ──────────────────────────┘
   creates/controls BrowserWindow(child, frameless, parent: mainWindow)
   persists state to app_metadata row "ai_assistant_state"
```

### Execution flow

1. User clicks the sidebar button (end of nav) or presses `Cmd+Shift+A`. The renderer calls `window.openNotion.aiAssistant.toggle({ provider? })`.
2. `electron/main.cjs` routes the call to `electron/ai-assistant.cjs`, which creates (first time) or shows/hides the frameless child `BrowserWindow`. `parent: mainWindow`; `alwaysOnTop` at level `floating`, gated on main-window focus.
3. The child window loads `opennotion-app://renderer/ai-assistant.html` — a second Vite build entry — a tiny React app that renders the header + two `<webview>` tags (one ChatGPT, one Gemini), only one visible at a time.
4. The header switcher toggles which `<webview>` is `visible` (the other stays mounted in memory, preserving its conversation) and persists the active provider.
5. Close (the `×` button, or `Cmd+W` inside the popover) → **hide**, not destroy. Reopening is instant and the webview sessions stay alive.

### Why the bounds = the popover geometry

Because the child window's bounds *are* the popover's position and size, persistence is just `getBounds()` / `setBounds()` with no React↔native sync during drag/resize. Drag and resize are handled by the OS directly. This was the decisive factor in choosing the child-window approach over an in-surface popover.

## Security & Privacy

This section is what concretely delivers the user's requirement: *"it's OK that the AI is cloud, as long as Shelf itself doesn't spy on anything."* Three pillars:

### 1. Strong isolation via `<webview>` + dedicated partitions

- The popover child window loads a minimal React shell (`ai-assistant.html`) containing the header (drag / switcher / close) and **two `<webview>` tags**: one for `chatgpt.com`, one for `gemini.google.com`. Only the active one is visible.
- Each `<webview>` is a **separate Chromium process** with its own persistent cookie partition:
  - `persist:ai-assistant-chatgpt`
  - `persist:ai-assistant-gemini`
- Separate partitions = ChatGPT and Gemini cookies/logins never mix with each other or with Shelf's own session, and **persist across app launches** (login remembered).

### 2. No bridge to Shelf data

- The popover React shell uses a **dedicated, minimal preload** (`electron/ai-assistant-preload.cjs`), separate from the main `preload.cjs`. It exposes a `window.aiAssistant` surface (distinct from the main renderer's `window.openNotion.aiAssistant`) with only:
  - `getInitialState()` → `{ provider }` (last provider used)
  - `setProvider(id)` → persists last provider
  - `close()` → hides the window

  The two surfaces are intentionally separate: `window.openNotion.aiAssistant.toggle()` lives in the **main renderer** (sidebar button, shortcut) and drives window lifecycle; `window.aiAssistant.*` lives in the **popover child window** and drives only in-shell behavior. They never share an object.
- It does **not** expose `invoke`, `fileSrc`, `studioPdfSrc`, or anything else. The popover shell cannot see SQLite, pages, notes, or Studio documents.
- The `<webview>` tags have **no preload at all** → ChatGPT and Gemini cannot call any Shelf API. There is no `window.openNotion` in their context.
- Drag is native via a CSS drag region (`-webkit-app-region: drag` on the header); resize is native (`resizable: true`). No IPC for movement.

### 3. Navigation restrictions

- Each `<webview>` may navigate only to its provider's origin plus its authentication domains. Allowlist:
  - **ChatGPT:** `chatgpt.com`, `auth.openai.com`, `auth0.openai.com`, `openai.com`
  - **Gemini:** `gemini.google.com`, `accounts.google.com`, `google.com`
- Any destination outside the allowlist is intercepted via `will-navigate` / `setWindowOpenHandler` in the main process and handed to `shell.openExternal` (the system browser), never rendered inside Shelf. This prevents the popover from becoming a generic browser or falling for phishing.
- The user agent is the standard Chromium UA from Electron — providers function normally. Note: a Cloudflare challenge may appear on first login; that is the normal authentication flow, not a defect.

### What Shelf actually sees

The main process tracks only: the window bounds (to restore them) and which provider is active. Shelf **does not** inject scripts into the webviews, **does not** read their DOM, **does not** intercept or log chat messages. Conversations flow directly between the user's client and OpenAI/Google's servers, exactly as they would in a standalone browser.

## UI integration

### Sidebar button

Added to the nav block in `src/components/Sidebar.tsx` (the `on-sidebar-nav` group around line 1620, which currently holds New page / Search / Import PDF / Home), **at the end**, after Home:

```tsx
<button
  className="on-shell-row"
  onClick={() => window.openNotion.aiAssistant.toggle()}
  title={t("sidebar.aiAssistant")}
>
  <MessageSquare className="on-sidebar-nav-icon" strokeWidth={1.9} />
  <span>{t("sidebar.aiAssistant")}</span>
</button>
```

Reuses the existing `on-shell-row` / `on-sidebar-nav-icon` classes — no new CSS for the button.

### Keyboard shortcut

Added in `src/App.tsx` alongside the existing `Cmd+K` handler:

```tsx
if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey
    && event.key.toLowerCase() === "a") {
  event.preventDefault();
  window.openNotion.aiAssistant.toggle();
  return;
}
```

### Open/close/hide logic

The bridge exposes a single function: `window.openNotion.aiAssistant.toggle(options?)`, with an optional `options.provider` to force a provider.

| Event | Action |
|---|---|
| `toggle()` first time | Create the frameless child `BrowserWindow` with bounds from the last saved state (or default), load `ai-assistant.html`, show |
| `toggle()` with popover visible | hide (not destroy) |
| `toggle()` with popover hidden | show + restore saved bounds |
| Click `×` in header | hide |
| `Cmd+W` inside the popover | hide (does not close the app) |
| Main window closed | popover destroyed/hidden with it |
| App quit | persist bounds + visibility flag; do **not** auto-reopen on next boot |

### always-on-top tied to Shelf focus

- `childWindow.setAlwaysOnTop(true, "floating")` plus listeners on `mainWindow`:
  - `mainWindow.on('focus', …)` → `childWindow.show()` if it was open for the user (tracked via a `wasOpenForUser` flag, distinguishing explicit hide from focus-driven hide).
  - `mainWindow.on('blur', …)` → `childWindow.hide()` if `wasOpenForUser`, debounced 100ms to avoid flicker when focus briefly passes through the webview's separate process.

### Default positioning

First open, no saved state: popover anchored to the **bottom-right** of the main window with a 16px margin, 420 × 640. Doesn't cover the sidebar or the central content; matches where users expect an assistant widget.

### Child window — properties

```js
new BrowserWindow({
  parent: mainWindow,
  frame: false,
  resizable: true,
  maximizable: false,
  fullscreenable: false,
  minWidth: 320, minHeight: 400,
  maxWidth: 560, maxHeight: 900,
  width: 420, height: 640,            // overridden by saved state when present
  show: false,                         // shown explicitly after load
  backgroundColor: /* same as main */,
  titleBarStyle: 'hidden',             // drag via CSS region
  webPreferences: {
    preload: 'ai-assistant-preload.cjs',
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: true,                  // enable <webview> in the shell
  },
});
```

## File structure

```
vite.config.ts                       # +input: ai-assistant.html
ai-assistant.html                    # NEW: popover shell HTML entry
src/ai-assistant/
  main.tsx                           # React bootstrap for the shell
  AiAssistantPopover.tsx             # root: header + webview container + footer
  AiAssistantHeader.tsx              # drag handle (-webkit-app-region: drag), switcher, close
  AssistantWebview.tsx               # <webview> wrapper + loading state
  providers.ts                       # provider list (id, label, url, partition, allowlist)
  types.ts                           # ProviderId, AssistantState
src/lib/aiAssistant.ts               # NEW: pure helpers (parseAssistantState, clampBounds, isAllowedNavigation, ...)
src/lib/aiAssistant.test.ts          # NEW: unit tests for the pure helpers
electron/ai-assistant.cjs            # NEW: child BrowserWindow lifecycle + IPC + persistence
electron/ai-assistant-preload.cjs    # NEW: minimal shell preload (getInitialState/setProvider/close)
electron/main.cjs                    # wire ai-assistant.cjs in, expose aiAssistant.toggle via IPC
electron/preload.cjs                 # expose window.openNotion.aiAssistant = { toggle }
src/components/Sidebar.tsx           # +sidebar button
src/App.tsx                          # +Cmd+Shift+A shortcut
src/lib/desktop.ts                   # +types/window.openNotion.aiAssistant surface
src/lib/i18n                         # +keys: sidebar.aiAssistant, aiAssistant.{footerOpenAI, footerGoogle, ...}
src/global.css (or index.css)        # +popover shell styles (header drag region, footer, webview container)
tests/e2e/ai-assistant.e2e.ts        # NEW: Playwright e2e for popover lifecycle + switcher
```

### React shell components (minimal)

```tsx
// AiAssistantPopover.tsx
export function AiAssistantPopover() {
  const [provider, setProvider] = useState<ProviderId>('chatgpt'); // from getInitialState()
  const [loading, setLoading] = useState(true);

  return (
    <div className="ai-popover-root">
      <AiAssistantHeader
        provider={provider}
        onProviderChange={(p) => { setProvider(p); window.aiAssistant.setProvider(p); }}
        onClose={() => window.aiAssistant.close()}
      />
      <div className="ai-popover-body">
        {PROVIDERS.map((p) => (
          <AssistantWebview key={p.id} provider={p} visible={p.id === provider} onLoadingChange={setLoading} />
        ))}
      </div>
      <footer className="ai-popover-footer">
        {provider === 'chatgpt'
          ? 'Served by OpenAI — your chats go to their servers.'
          : 'Served by Google — your chats go to their servers.'}
      </footer>
    </div>
  );
}
```

```tsx
// AiAssistantHeader.tsx — native drag handle
<div className="ai-popover-header" /* -webkit-app-region: drag */>
  <div className="ai-popover-switcher">
    <button data-active={provider === 'chatgpt'} onClick={() => onProviderChange('chatgpt')}>ChatGPT</button>
    <button data-active={provider === 'gemini'} onClick={() => onProviderChange('gemini')}>Gemini</button>
  </div>
  <button onClick={onClose} /* -webkit-app-region: no-drag */><X /></button>
</div>
```

```tsx
// AssistantWebview.tsx — both webviews always mounted, only one visible
<webview
  src={provider.url}
  partition={provider.partition}        // persist:ai-assistant-chatgpt | persist:ai-assistant-gemini
  style={{ display: visible ? 'flex' : 'none' }}
  /* navigation gating handled in main process via will-navigate */
/>
```

### Notes

1. **`<webview>` tag** requires `webviewTag: true` in the child window's `webPreferences` (not the main window's). The tag is officially "deprecated" in Electron but still fully supported, and is the recommended primitive for embedding third-party web content when strong isolation is required — which is exactly this case. The alternative (`WebContentsView`) was rejected because it reintroduces the manual bounds-sync-during-drag fragility we excluded when choosing the child-window approach.
2. **Footer and privacy text** live in the React shell, not inside the webview — invisible to the providers and non-interfering with their layout.
3. **Theming**: the shell applies the same `dark`/`light` class as the main app (read from `localStorage`), so the popover matches the user's chosen theme.

## Persistence

The existing `app_metadata` table (key/value) is reused. A new row, key `ai_assistant_state`:

```json
{
  "x": 980, "y": 120, "width": 420, "height": 640,
  "provider": "chatgpt",
  "lastOpenedAt": "2026-06-20T10:00:00Z"
}
```

- Written on: `move`/`resize` (throttled), provider switch, open/close.
- Read at boot only to know the last bounds/provider; the popover does **not** auto-open.
- Provider cookies are handled separately by Electron's `persist:*` partitions and never enter SQLite.

This follows the existing schema-evolution convention (idempotent writes, no migration framework needed).

## Error handling & edge cases

| Situation | Behavior |
|---|---|
| Login not yet done at first access | The webview shows the provider's official login page. No special handling; the `persist:*` partition remembers the session. |
| Service offline / provider down | The webview shows Chromium's native error page. We do not invent UI. |
| Popover open + main window closed | Popover destroyed/hidden with the parent. |
| Popover open + app quit | `before-quit` → persist bounds + visibility flag, destroy the child window. Does not auto-reopen on next boot. |
| Cloudflare challenge on first login | Normal flow; the webview shows the challenge, the user solves it, login proceeds. |
| Logout from inside the popover | The webview shows the login page again. Partitions persist cookies until explicit logout or app-data wipe. |
| Navigation outside provider origin (e.g. a link in a ChatGPT answer) | `will-navigate` in the main process: if the destination is not on the provider's allowlist, intercept and open it in the system browser via `shell.openExternal`. |
| New window requested by the page (e.g. Google OAuth popup) | `setWindowOpenHandler` in the webview: allowlist URLs open in a temporary `BrowserWindow` in the same partition; everything else goes to `shell.openExternal`. |
| Drag moves the popover off-screen | Clamp bounds after `move`/`resize`: the popover must stay at least partially inside the main window (titlebar always reachable). Persist clamped bounds. |
| Hide-on-blur flicker when the user clicks inside the webview | 100ms debounce + `wasOpenForUser` flag: hide only if focus does not return to Shelf or the popover within the debounce. |
| Provider switch during a streaming response | The paused provider stays mounted with its conversation preserved (no destroy). The active provider continues. |
| Long-hidden popover | No timer; webviews stay alive. Popover is hide-only. |

### Security — error paths

- If the child window fails to create (e.g. webview unsupported): catch in IPC, log, surface a `notice` via Shelf's existing notification system ("AI Assistant unavailable"). The app keeps running.
- If the `ai_assistant_state` row in `app_metadata` is corrupt: defensive parse, fall back to defaults, do not crash.

## Testing

Aligned to the repo conventions: Vitest for pure logic, Playwright for UI.

### Unit (Vitest) — pure helpers in `src/lib/aiAssistant.ts`

```
src/lib/aiAssistant.test.ts
```

Covered pure functions:

- `parseAssistantState(json): AssistantState | null` — parse + bounds validation, safe fallback
- `clampBoundsToBounds(bounds, container)` — validate bounds against the main window
- `defaultBoundsFor(parentBounds): Bounds` — default bottom-right anchoring
- `nextProvider(current)` / `providerAllowlistFor(providerId)` — allowlist lookup
- `isAllowedNavigation(providerId, url): boolean` — allowlist matching

### E2E (Playwright)

The popover is a **second Electron window**; Playwright supports multiple Electron contexts/windows.

`tests/e2e/ai-assistant.e2e.ts`:

- Open popover via sidebar button → verify the child window appears
- Open via `Cmd+Shift+A` → same verification
- Toggle via close button → verify hidden; reopen → verify bounds restored
- Switch provider → verify the active webview's origin changes (assert on `webview.src` or loaded URL)

**Skipped in CI (documented in the test):** the real provider login flow (requires live credentials + external network — flaky and inappropriate for CI).

### Runtime smoke

The existing `electron:smoke:runtime` gains a minimal check that the child window can be created without errors (validates the main-process wiring).

### Visual / parity smoke

The popover lives in a separate window, so it does **not** appear in the main-window screenshots used by the existing visual/parity smokes. No baselines need updating for those suites.

### Explicitly not auto-tested

- Real login flow with ChatGPT/Gemini (credentials + external network → flaky/inappropriate for CI).
- Exact hide-on-blur timing (timing-dependent; the runtime smoke only verifies it does not crash).
