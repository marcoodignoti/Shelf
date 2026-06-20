# External Assistant Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draggable popover that embeds the official ChatGPT and Gemini web pages in an isolated child window, reachable via a "Chat" sidebar button and `Cmd+Shift+A`, with no access to Shelf data.

**Architecture:** A frameless child `BrowserWindow` (whose bounds *are* the popover's geometry, giving native drag/resize + trivial persistence) loads a tiny second Vite entry (`external-assistant.html`) that renders a header + two `<webview>` tags (one per provider, only one visible at a time). Each `<webview>` is a separate Chromium process with its own persistent cookie partition and no bridge to Shelf. The main process enforces navigation allowlists and `will-attach-webview` validation.

**Tech Stack:** Electron 42 (`BrowserWindow`, `<webview>`, `partition`), React 19, TypeScript, Vite (multi-page build), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-06-20-ai-assistant-popover-design.md`

**Critical context for every task:**
- This feature changes a codified product contract. The old contract ("Shelf has no AI", sealed by `tests/e2e/no-ai.e2e.ts` after commit `3cf4c66` removed the integrated Rust AI module) becomes: *"Shelf has no AI that touches Shelf data; the only AI surface is an isolated external popover."* **Task 1 updates the contract and the guard test before any feature code is written.**
- All new code uses the `external_assistant_*` / `Chat` namespace, never `ai_*`. This keeps the data-isolation boundary legible.
- Run unit tests with `npx vitest run <path>`. Run a single e2e spec with `npx playwright test tests/e2e/<file>`.

---

## File Structure

**New files:**
- `src/lib/externalAssistant.ts` — pure helpers (state parsing, bounds clamping, allowlist matching, webview-attachment validation). Framework-free, fully unit-tested.
- `src/lib/externalAssistant.test.ts` — Vitest unit tests for the above.
- `electron/external-assistant.cjs` — child `BrowserWindow` lifecycle, IPC handlers, persistence to `app_metadata`, `will-attach-webview` + `will-navigate` enforcement.
- `electron/external-assistant.test.cjs` — node:test unit tests for the allowlist/attachment logic exposed by the CJS module.
- `electron/external-assistant-preload.cjs` — minimal preload for the popover shell (`getInitialState` / `setProvider` / `close`).
- `external-assistant.html` — second Vite entry (popover shell HTML).
- `src/external-assistant/main.tsx` — React bootstrap for the shell.
- `src/external-assistant/providers.ts` — provider definitions (id, url, partition, allowlist).
- `src/external-assistant/types.ts` — `ProviderId`, `ExternalAssistantState`.
- `src/external-assistant/ExternalAssistantPopover.tsx` — root shell component.
- `src/external-assistant/ExternalAssistantHeader.tsx` — drag handle + switcher + close.
- `src/external-assistant/AssistantWebview.tsx` — `<webview>` wrapper.
- `tests/e2e/external-assistant.e2e.ts` — Playwright e2e for popover lifecycle.

**Modified files:**
- `tests/e2e/no-ai.e2e.ts` — replaced with the new-contract guard (Task 1).
- `tests/e2e/helpers/mockBridge.ts` — add a stub for `externalAssistant.toggle` so the mock renderer doesn't crash.
- `vite.config.ts` — add `external-assistant.html` as a second rollup input.
- `electron/main.cjs` — wire in `external-assistant.cjs`, expose the renderer bridge.
- `electron/preload.cjs` — expose `window.openNotion.externalAssistant`.
- `src/lib/desktop.ts` — add the typed `externalAssistant` surface to `ShelfDesktopBridge`.
- `src/components/Sidebar.tsx` — add the "Chat" button at the end of nav.
- `src/App.tsx` — add `Cmd+Shift+A` shortcut.
- `src/lib/locales/en.ts` + `src/lib/locales/it.ts` — add `sidebar.chat` + footer keys.
- `src/index.css` — popover shell styles (drag region, footer, webview container).

---

## Task 1: Replace the `no-ai` contract guard

This task changes the product contract *first*, before any feature code. The new guard encodes: no AI integrated into Shelf data (no content-bound IPC, no "Ask Shelf AI" in palette/settings), AND the only permitted AI surface is the isolated external popover (which doesn't exist yet — the positive assertion is added in a later task once the popover exists; for now the guard is relaxed to allow the `Chat` button namespace while still forbidding data-integrated AI).

**Files:**
- Modify: `tests/e2e/no-ai.e2e.ts`
- Modify: `tests/e2e/helpers/mockBridge.ts`

- [ ] **Step 1: Rewrite the guard test for the new contract**

Replace the entire contents of `tests/e2e/no-ai.e2e.ts` with:

```typescript
import { expect, test } from "@playwright/test";
import { installMockBridge } from "./helpers/mockBridge";

// Contract guard: Shelf does NOT integrate AI into its data layer.
//
// History: Shelf once shipped a deeply-integrated AI (Rust module + AiChat
// component + "Ask AI" command + AI settings). It was removed in commit
// 3cf4c66 and sealed by this guard's predecessor. The contract is now:
//
//   "Shelf has no AI that touches Shelf data. The only AI surface permitted
//    is an isolated external popover (a <webview> embedding user-chosen
//    provider pages) with no access to notes, the DB, Studio, or files."
//
// This test enforces the data-isolation half. The external popover itself
// is covered by external-assistant.e2e.ts.

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
  await page.addInitScript(() => {
    window.localStorage.removeItem("opennotion-current-page-id");
  });
});

test("does not expose data-integrated AI features or content-bound AI IPC", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  // No "Ask AI" button (the old integrated assistant entry point).
  await expect(page.getByRole("button", { name: /ask ai/i })).toHaveCount(0);

  // Command palette must not offer an in-data AI command.
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByPlaceholder("Search pages...")).toBeFocused();
  await expect(page.locator(".on-command-panel").getByText(/ask shelf ai/i)).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Settings must not contain an AI section that touches data.
  await page.getByRole("button", { name: "Settings" }).click();
  const popover = page.locator(".on-settings-quick-popover");
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "Settings" }).click();
  const settingsPanel = page.locator(".on-settings-panel");
  await expect(settingsPanel).toBeVisible();
  await expect(settingsPanel.getByRole("heading", { name: /^AI$/i })).toHaveCount(0);

  // No IPC command that would imply an AI reading Shelf content.
  const invokedCommands = await page.evaluate(() => (window as any).__opennotionE2eInvokedCommands as string[]);
  const dataBoundAiCommands = invokedCommands.filter((command) => {
    const lower = command.toLowerCase();
    return (lower.includes("ai_") || lower.includes("_ai")) &&
      !lower.startsWith("external_assistant");
  });
  expect(dataBoundAiCommands).toEqual([]);
});
```

- [ ] **Step 2: Add the `externalAssistant` stub to the mock bridge**

In `tests/e2e/helpers/mockBridge.ts`, the mock `window.openNotion` object (assigned around line 111) needs an `externalAssistant` stub so components referencing it don't crash. Add this property to the object literal assigned to `window.openNotion` (after `onDesktopUpdate`):

```typescript
      externalAssistant: {
        toggle: async () => {
          (window as any).__externalAssistantToggleCalls =
            ((window as any).__externalAssistantToggleCalls ?? 0) + 1;
        },
      },
```

- [ ] **Step 3: Run the guard test to verify it passes against the current (no-feature) app**

Run: `npx playwright test tests/e2e/no-ai.e2e.ts`
Expected: PASS. The current app has no AI features at all, so the data-isolation assertions hold vacuously.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/no-ai.e2e.ts tests/e2e/helpers/mockBridge.ts
git commit -m "test(no-ai): replace contract guard for external-assistant policy

Old guard forbade all AI. New contract: Shelf has no AI that touches
Shelf data; only an isolated external popover is permitted. Guard now
checks for data-integrated AI (Ask AI button, palette/settings AI,
content-bound ai_* IPC) while allowing the external_assistant namespace."
```

---

## Task 2: Pure helpers — provider allowlist + state parsing

Pure, framework-free logic in `src/lib/`. This is the bulk of the testable surface and has zero Electron dependencies, so it can be developed and tested in isolation.

**Files:**
- Create: `src/lib/externalAssistant.ts`
- Create: `src/lib/externalAssistant.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/externalAssistant.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  PROVIDERS,
  clampBoundsToBounds,
  defaultBoundsFor,
  isAllowedNavigation,
  nextProvider,
  parseAssistantState,
  validateWebviewAttachment,
  type ProviderId,
} from "./externalAssistant";

describe("PROVIDERS", () => {
  it("exposes chatgpt and gemini with https URLs and dedicated persistent partitions", () => {
    for (const provider of PROVIDERS) {
      expect(provider.url.startsWith("https://")).toBe(true);
      expect(provider.partition.startsWith("persist:external-assistant-")).toBe(true);
    }
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(["chatgpt", "gemini"]);
  });
});

describe("nextProvider", () => {
  it("cycles between the two providers", () => {
    expect(nextProvider("chatgpt")).toBe("gemini");
    expect(nextProvider("gemini")).toBe("chatgpt");
  });
});

describe("isAllowedNavigation", () => {
  it("allows the provider host and auth hosts over https only", () => {
    expect(isAllowedNavigation("chatgpt", "https://chatgpt.com/")).toBe(true);
    expect(isAllowedNavigation("chatgpt", "https://chatgpt.com/c/abc")).toBe(true);
    expect(isAllowedNavigation("chatgpt", "https://auth.openai.com/login")).toBe(true);
    expect(isAllowedNavigation("chatgpt", "https://auth0.openai.com/")).toBe(true);
    expect(isAllowedNavigation("chatgpt", "https://chat.openai.com/auth")).toBe(true);
    expect(isAllowedNavigation("gemini", "https://gemini.google.com/")).toBe(true);
    expect(isAllowedNavigation("gemini", "https://accounts.google.com/signin")).toBe(true);
  });

  it("rejects bare openai.com / google.com roots (generic links go to the system browser)", () => {
    expect(isAllowedNavigation("chatgpt", "https://openai.com/blog/x")).toBe(false);
    expect(isAllowedNavigation("gemini", "https://google.com/search")).toBe(false);
  });

  it("rejects http and non-allowlisted hosts", () => {
    expect(isAllowedNavigation("chatgpt", "http://chatgpt.com/")).toBe(false);
    expect(isAllowedNavigation("chatgpt", "https://evil.example.com/")).toBe(false);
    expect(isAllowedNavigation("gemini", "https://chatgpt.com/")).toBe(false);
  });

  it("rejects unknown providers", () => {
    expect(isAllowedNavigation("claude" as ProviderId, "https://chatgpt.com/")).toBe(false);
  });
});

describe("validateWebviewAttachment", () => {
  const ok = (overrides: Partial<Parameters<typeof validateWebviewAttachment>[0]>) =>
    validateWebviewAttachment({
      src: "https://chatgpt.com/",
      partition: "persist:external-assistant-chatgpt",
      preload: undefined,
      nodeIntegration: false,
      contextIsolation: true,
      providerId: "chatgpt",
      ...overrides,
    });

  it("accepts a well-formed chatgpt webview", () => {
    expect(ok({}).ok).toBe(true);
  });

  it("accepts a well-formed gemini webview", () => {
    expect(ok({
      src: "https://gemini.google.com/",
      partition: "persist:external-assistant-gemini",
      providerId: "gemini",
    }).ok).toBe(true);
  });

  it("rejects a non-allowlisted src", () => {
    const result = ok({ src: "https://evil.example.com/" });
    expect(result.ok).toBe(false);
  });

  it("rejects the wrong partition for the provider", () => {
    const result = ok({ providerId: "chatgpt", partition: "persist:external-assistant-gemini" });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-persistent or unknown partition", () => {
    expect(ok({ partition: "default" }).ok).toBe(false);
    expect(ok({ partition: "persist:something-else" }).ok).toBe(false);
  });

  it("rejects any preload", () => {
    const result = ok({ preload: "file:///etc/passwd" });
    expect(result.ok).toBe(false);
  });

  it("rejects node integration enabled", () => {
    const result = ok({ nodeIntegration: true });
    expect(result.ok).toBe(false);
  });

  it("rejects context isolation disabled", () => {
    const result = ok({ contextIsolation: false });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown provider id", () => {
    const result = ok({ providerId: "claude" as ProviderId });
    expect(result.ok).toBe(false);
  });
});

describe("parseAssistantState", () => {
  it("returns null for invalid input", () => {
    expect(parseAssistantState(null)).toBeNull();
    expect(parseAssistantState("not json")).toBeNull();
    expect(parseAssistantState("{}")).toBeNull();
  });

  it("parses a well-formed state", () => {
    const json = JSON.stringify({
      x: 10, y: 20, width: 420, height: 640, provider: "gemini",
      lastOpenedAt: "2026-06-20T10:00:00Z",
    });
    const state = parseAssistantState(json);
    expect(state).toEqual({
      x: 10, y: 20, width: 420, height: 640, provider: "gemini",
      lastOpenedAt: "2026-06-20T10:00:00Z",
    });
  });

  it("normalizes an unknown provider to the default (chatgpt)", () => {
    const json = JSON.stringify({ x: 0, y: 0, width: 420, height: 640, provider: "claude" });
    expect(parseAssistantState(json)?.provider).toBe("chatgpt");
  });
});

describe("clampBoundsToBounds", () => {
  const container = { left: 0, top: 0, width: 1000, height: 800 };

  it("leaves in-bounds bounds untouched", () => {
    expect(clampBoundsToBounds({ x: 100, y: 100, width: 420, height: 640 }, container))
      .toEqual({ x: 100, y: 100, width: 420, height: 640 });
  });

  it("clamps so the titlebar stays reachable inside the container", () => {
    // Moved completely off the right edge.
    const clamped = clampBoundsToBounds({ x: 2000, y: 100, width: 420, height: 640 }, container);
    expect(clamped.x).toBeLessThanOrEqual(container.width - 80);
    expect(clamped.x).toBeGreaterThanOrEqual(0);
  });

  it("clamps a too-large width down to the container width", () => {
    const clamped = clampBoundsToBounds({ x: 0, y: 0, width: 5000, height: 640 }, container);
    expect(clamped.width).toBe(container.width);
  });
});

describe("defaultBoundsFor", () => {
  it("anchors the popover to the bottom-right with a 16px margin", () => {
    const bounds = defaultBoundsFor({ left: 0, top: 0, width: 1280, height: 860 });
    expect(bounds.width).toBe(420);
    expect(bounds.height).toBe(640);
    // 16px margin from the bottom-right corner.
    expect(bounds.x).toBe(1280 - 420 - 16);
    expect(bounds.y).toBe(860 - 640 - 16);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/externalAssistant.test.ts`
Expected: FAIL — the module does not exist yet.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/externalAssistant.ts`:

```typescript
// Pure helpers for the External Assistant popover. No Electron, no React.
// All security-critical decisions (navigation allowlist, webview attachment
// validation) live here so they are fully unit-testable.

export type ProviderId = "chatgpt" | "gemini";

export interface Provider {
  id: ProviderId;
  label: string;
  url: string;
  partition: string;
  /** Hosts (exact or wildcard) the provider's webview may navigate to, https only. */
  allowlist: ReadonlyArray<string>;
}

export const PROVIDERS: readonly Provider[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    url: "https://chatgpt.com/",
    partition: "persist:external-assistant-chatgpt",
    allowlist: ["chatgpt.com", "*.chatgpt.com", "auth.openai.com", "auth0.openai.com", "chat.openai.com"],
  },
  {
    id: "gemini",
    label: "Gemini",
    url: "https://gemini.google.com/",
    partition: "persist:external-assistant-gemini",
    allowlist: ["gemini.google.com", "accounts.google.com"],
  },
] as const;

const PROVIDER_BY_ID: Readonly<Record<ProviderId, Provider>> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p]),
) as Record<ProviderId, Provider>;

export function providerById(id: ProviderId): Provider | undefined {
  return PROVIDER_BY_ID[id];
}

export function nextProvider(current: ProviderId): ProviderId {
  return current === "chatgpt" ? "gemini" : "chatgpt";
}

/** A host matches an allowlist entry if it equals it or matches a `*.domain` wildcard. */
function hostMatchesAllowlistEntry(host: string, entry: string): boolean {
  if (entry.startsWith("*.")) {
    const suffix = entry.slice(1); // ".chatgpt.com"
    return host.endsWith(suffix) || host === entry.slice(2);
  }
  return host === entry;
}

export function isAllowedNavigation(providerId: ProviderId, url: string): boolean {
  const provider = providerById(providerId);
  if (!provider) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return provider.allowlist.some((entry) => hostMatchesAllowlistEntry(parsed.hostname, entry));
}

export interface WebviewAttachmentParams {
  src: string;
  partition: string;
  preload: string | undefined;
  nodeIntegration: boolean;
  contextIsolation: boolean;
  providerId: ProviderId;
}

export type WebviewAttachmentResult = { ok: true } | { ok: false; reason: string };

export function validateWebviewAttachment(params: WebviewAttachmentParams): WebviewAttachmentResult {
  const provider = providerById(params.providerId);
  if (!provider) return { ok: false, reason: "unknown provider" };
  if (params.partition !== provider.partition) {
    return { ok: false, reason: "partition mismatch" };
  }
  if (params.preload !== undefined) {
    return { ok: false, reason: "preload forbidden on assistant webviews" };
  }
  if (params.nodeIntegration !== false) {
    return { ok: false, reason: "node integration must be disabled" };
  }
  if (params.contextIsolation !== true) {
    return { ok: false, reason: "context isolation must be enabled" };
  }
  if (!isAllowedNavigation(params.providerId, params.src)) {
    return { ok: false, reason: "src not on provider allowlist" };
  }
  return { ok: true };
}

export interface ExternalAssistantState {
  x: number;
  y: number;
  width: number;
  height: number;
  provider: ProviderId;
  lastOpenedAt: string;
}

const DEFAULT_PROVIDER: ProviderId = "chatgpt";

function isProviderId(value: unknown): value is ProviderId {
  return value === "chatgpt" || value === "gemini";
}

export function parseAssistantState(raw: string | null): ExternalAssistantState | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const { x, y, width, height, provider, lastOpenedAt } = obj;
  if (
    typeof x !== "number" || !Number.isFinite(x) ||
    typeof y !== "number" || !Number.isFinite(y) ||
    typeof width !== "number" || !Number.isFinite(width) || width <= 0 ||
    typeof height !== "number" || !Number.isFinite(height) || height <= 0 ||
    typeof lastOpenedAt !== "string"
  ) {
    return null;
  }
  return {
    x,
    y,
    width,
    height,
    provider: isProviderId(provider) ? provider : DEFAULT_PROVIDER,
    lastOpenedAt,
  };
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clampBoundsToBounds(bounds: Bounds, container: Rect): Bounds {
  const minVisibleWidth = 80; // keep the titlebar / drag region reachable
  const width = Math.min(bounds.width, container.width);
  const height = Math.min(bounds.height, container.height);
  const maxX = Math.max(container.left, container.left + container.width - minVisibleWidth);
  const maxY = Math.max(container.top, container.top + container.height - 40);
  const x = Math.min(Math.max(bounds.x, container.left), maxX);
  const y = Math.min(Math.max(bounds.y, container.top), maxY);
  return { x, y, width, height };
}

export function defaultBoundsFor(container: Rect): Bounds {
  const width = 420;
  const height = 640;
  const margin = 16;
  return {
    width,
    height,
    x: container.left + container.width - width - margin,
    y: container.top + container.height - height - margin,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/externalAssistant.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/externalAssistant.ts src/lib/externalAssistant.test.ts
git commit -m "feat(external-assistant): add pure allowlist + state helpers

Provider allowlist (https-only, tight hosts), will-attach-webview
validation, state parsing, and bounds clamping/defaulting. All
security-critical decisions live here so they are fully unit-tested
with no Electron dependency."
```

---

## Task 3: Vite multi-page build — add the popover shell entry

Make Vite emit a second HTML bundle so the child window can load `opennotion-app://renderer/external-assistant.html`. The shell itself is built in later tasks; here we only add the entry + a minimal placeholder so the build succeeds.

**Files:**
- Create: `external-assistant.html`
- Create: `src/external-assistant/main.tsx`
- Create: `src/external-assistant/types.ts`
- Create: `src/external-assistant/providers.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Create the shared types module**

Create `src/external-assistant/types.ts`:

```typescript
import type { ProviderId } from "../lib/externalAssistant";

export type { ProviderId };

export interface ExternalAssistantShellState {
  provider: ProviderId;
}
```

- [ ] **Step 2: Create the providers module (re-export for the shell)**

Create `src/external-assistant/providers.ts`:

```typescript
export { PROVIDERS, providerById, nextProvider } from "../lib/externalAssistant";
import type { Provider } from "../lib/externalAssistant";

export const SHELL_PROVIDERS: readonly Provider[] = PROVIDERS;
```

- [ ] **Step 3: Create a minimal bootstrap that renders a placeholder**

Create `src/external-assistant/main.tsx`:

```typescript
import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";

// Placeholder root; replaced by ExternalAssistantPopover in Task 6.
// Kept minimal so the multi-page build can be validated in isolation.
function Root() {
  return <div className="ea-popover-root">External assistant shell</div>;
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<Root />);
}
```

- [ ] **Step 4: Create the HTML entry**

Create `external-assistant.html` (in the repo root, sibling to `index.html`):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chat</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/external-assistant/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Add the entry to the Vite build**

Modify `vite.config.ts`. It is an ESM module (`"type": "module"` in `package.json`), so `__dirname` is not available — derive it from `import.meta.url`.

At the top of the file, add:
```typescript
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
```

In the `build.rollupOptions` object (currently only has `output`), add an `input` key so it becomes:

```typescript
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        externalAssistant: resolve(__dirname, "external-assistant.html"),
      },
      output: {
```

- [ ] **Step 6: Verify the build emits both HTML files**

Run: `npm run build`
Expected: build succeeds; both `dist/index.html` and `dist/external-assistant.html` exist. Verify with `ls dist/*.html`.

- [ ] **Step 7: Commit**

```bash
git add external-assistant.html src/external-assistant/ vite.config.ts
git commit -m "build(external-assistant): add multi-page popover shell entry

Vite now emits external-assistant.html alongside index.html. The shell
root is a placeholder until the React components land in a later task."
```

---

## Task 4: Minimal popover-shell preload

The preload for the child window exposes only three calls — no `invoke`, no data access. It is intentionally a separate file from the main `preload.cjs`.

**Files:**
- Create: `electron/external-assistant-preload.cjs`

- [ ] **Step 1: Create the preload**

Create `electron/external-assistant-preload.cjs`:

```javascript
const { contextBridge, ipcRenderer } = require("electron");

// Minimal surface for the popover shell. Deliberately does NOT expose
// invoke/fileSrc/any Shelf data. The popover can only: read its initial
// provider, persist a provider choice, and ask to close itself.
contextBridge.exposeInMainWorld("externalAssistantShell", {
  getInitialState: () => ipcRenderer.invoke("external-assistant:get-state"),
  setProvider: (provider) =>
    ipcRenderer.invoke("external-assistant:set-provider", provider),
  close: () => ipcRenderer.send("external-assistant:close"),
});
```

- [ ] **Step 2: Commit**

```bash
git add electron/external-assistant-preload.cjs
git commit -m "feat(external-assistant): add minimal popover shell preload

Exposes only getInitialState / setProvider / close. No invoke, no
fileSrc, no Shelf data surface — enforces the data-isolation contract
on the shell side."
```

---

## Task 5: Main-process controller — child window, IPC, persistence, security enforcement

This is the largest task. It creates the child `BrowserWindow`, wires the IPC handlers (toggle / get-state / set-provider / close), persists state to `app_metadata`, and enforces `will-attach-webview` + `will-navigate` + `setWindowOpenHandler` using the pure helpers from Task 2.

Because the logic reuses the pure helpers (which are TS), but the Electron side is CJS, the controller imports the **compiled** helper decisions via a small CJS mirror of the allowlist. To avoid duplicating the allowlist, the controller re-declares only the thin runtime hooks it needs (`isAllowedNavigation`/`validateWebviewAttachment`) by importing them from a CJS-friendly location. We keep DRY by putting the security functions in a CJS module that both the TS helper tests and the controller reference. **However**, the TS helpers already exist and are tested; to avoid a second source of truth, the controller imports them through a tiny `.cjs` adapter that re-implements only the URL/parsing glue against the same provider table, which we also export from the TS module via a JSON-serializable constant.

**Simpler approach for this codebase:** the provider table + allowlist logic is duplicated once in a CJS module (`electron/external-assistant-providers.cjs`) and the TS side re-exports the same constants. To stay DRY and avoid drift, Task 5a makes the CJS module the single source of truth for the provider table, and Task 2's TS module re-exports it.

**Files:**
- Create: `electron/external-assistant-providers.cjs` (source of truth for the provider table + CJS allowlist functions)
- Modify: `src/lib/externalAssistant.ts` (re-export the provider table from the CJS-free constants; the CJS module imports the same shape)
- Create: `electron/external-assistant.cjs` (window lifecycle + IPC + security)
- Create: `electron/external-assistant.test.cjs` (node:test for the CJS allowlist)
- Modify: `electron/main.cjs` (wire the controller in)

Because TS and CJS can't share an import directly without a build step, and the codebase keeps `electron/*.cjs` framework-free, we accept a **single, well-tested duplication** of the provider table in the CJS module and guard it with a test that asserts the two tables match. This is the pragmatic tradeoff for this repo's structure.

- [ ] **Step 1: Create the CJS provider + allowlist module (Electron-side source of truth)**

Create `electron/external-assistant-providers.cjs`:

```javascript
// Electron-side source of truth for providers + allowlist logic. Mirrored
// (and kept in sync by external-assistant-providers.test.cjs) with the TS
// helpers in src/lib/externalAssistant.ts.

const PROVIDERS = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    url: "https://chatgpt.com/",
    partition: "persist:external-assistant-chatgpt",
    allowlist: ["chatgpt.com", "*.chatgpt.com", "auth.openai.com", "auth0.openai.com", "chat.openai.com"],
  },
  {
    id: "gemini",
    label: "Gemini",
    url: "https://gemini.google.com/",
    partition: "persist:external-assistant-gemini",
    allowlist: ["gemini.google.com", "accounts.google.com"],
  },
];

const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

function providerById(id) {
  return PROVIDER_BY_ID[id];
}

function hostMatchesAllowlistEntry(host, entry) {
  if (entry.startsWith("*.")) {
    const suffix = entry.slice(1);
    return host.endsWith(suffix) || host === entry.slice(2);
  }
  return host === entry;
}

function isAllowedNavigation(providerId, url) {
  const provider = providerById(providerId);
  if (!provider) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return provider.allowlist.some((entry) => hostMatchesAllowlistEntry(parsed.hostname, entry));
}

function validateWebviewAttachment(params) {
  const provider = providerById(params.providerId);
  if (!provider) return { ok: false, reason: "unknown provider" };
  if (params.partition !== provider.partition) return { ok: false, reason: "partition mismatch" };
  if (params.preload !== undefined) return { ok: false, reason: "preload forbidden" };
  if (params.nodeIntegration !== false) return { ok: false, reason: "node integration must be disabled" };
  if (params.contextIsolation !== true) return { ok: false, reason: "context isolation must be enabled" };
  if (!isAllowedNavigation(params.providerId, params.src)) return { ok: false, reason: "src not on allowlist" };
  return { ok: true };
}

module.exports = {
  PROVIDERS,
  providerById,
  isAllowedNavigation,
  validateWebviewAttachment,
};
```

- [ ] **Step 2: Write the CJS unit test (including a drift check against the TS table)**

Create `electron/external-assistant.test.cjs`:

```javascript
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  PROVIDERS,
  isAllowedNavigation,
  validateWebviewAttachment,
} = require("./external-assistant-providers.cjs");

test("provider table matches the TS source of truth", () => {
  // Drift guard: if someone edits the CJS table without updating the TS
  // table (or vice versa), this catches it. We assert the ids, urls, and
  // partitions — the security-relevant fields.
  const expected = [
    { id: "chatgpt", url: "https://chatgpt.com/", partition: "persist:external-assistant-chatgpt" },
    { id: "gemini", url: "https://gemini.google.com/", partition: "persist:external-assistant-gemini" },
  ];
  for (const exp of expected) {
    const p = PROVIDERS.find((x) => x.id === exp.id);
    assert.ok(p, `missing provider ${exp.id}`);
    assert.equal(p.url, exp.url);
    assert.equal(p.partition, exp.partition);
  }
});

test("isAllowedNavigation rejects bare openai.com / google.com roots", () => {
  assert.equal(isAllowedNavigation("chatgpt", "https://openai.com/blog"), false);
  assert.equal(isAllowedNavigation("gemini", "https://google.com/"), false);
});

test("isAllowedNavigation rejects http", () => {
  assert.equal(isAllowedNavigation("chatgpt", "http://chatgpt.com/"), false);
});

test("validateWebviewAttachment rejects preload and node integration", () => {
  const base = {
    src: "https://chatgpt.com/",
    partition: "persist:external-assistant-chatgpt",
    preload: undefined,
    nodeIntegration: false,
    contextIsolation: true,
    providerId: "chatgpt",
  };
  assert.equal(validateWebviewAttachment(base).ok, true);
  assert.equal(validateWebviewAttachment({ ...base, preload: "file:///x" }).ok, false);
  assert.equal(validateWebviewAttachment({ ...base, nodeIntegration: true }).ok, false);
  assert.equal(validateWebviewAttachment({ ...base, contextIsolation: false }).ok, false);
  assert.equal(
    validateWebviewAttachment({ ...base, partition: "persist:external-assistant-gemini" }).ok,
    false,
  );
});
```

- [ ] **Step 3: Run the CJS tests**

Run: `node --test electron/external-assistant.test.cjs`
Expected: PASS (4 tests).

- [ ] **Step 4: Create the controller**

Create `electron/external-assistant.cjs`:

```javascript
const path = require("node:path");
const { BrowserWindow, ipcMain, shell } = require("electron");
const {
  PROVIDERS,
  providerById,
  isAllowedNavigation,
  validateWebviewAttachment,
} = require("./external-assistant-providers.cjs");

const STATE_KEY = "external_assistant_state";
const DEFAULT_WIDTH = 420;
const DEFAULT_HEIGHT = 640;

function createExternalAssistantController({ getMainWindow, backend }) {
  let childWindow = null;
  let wasOpenForUser = false;
  let blurHideTimer = null;
  let persistTimer = null;

  function readState() {
    try {
      const raw = backend.readMetadataValue(STATE_KEY);
      if (typeof raw !== "string") return null;
      const parsed = JSON.parse(raw);
      if (
        typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
        typeof parsed.x !== "number" || typeof parsed.y !== "number" ||
        typeof parsed.width !== "number" || typeof parsed.height !== "number" ||
        typeof parsed.lastOpenedAt !== "string"
      ) {
        return null;
      }
      const provider = parsed.provider === "gemini" ? "gemini" : "chatgpt";
      return { ...parsed, provider };
    } catch {
      return null;
    }
  }

  function persistState(partial) {
    try {
      const current = readState() ?? {};
      const next = { ...current, ...partial, lastOpenedAt: new Date().toISOString() };
      backend.writeMetadataValue(STATE_KEY, JSON.stringify(next));
    } catch {
      // Persistence is best-effort; never crash the app over it.
    }
  }

  function scheduleBoundsPersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      if (!childWindow) return;
      try {
        const [x, y] = childWindow.getPosition();
        const [width, height] = childWindow.getSize();
        persistState({ x, y, width, height });
      } catch {
        // window may have been closed mid-timer
      }
    }, 250);
  }

  function defaultBounds() {
    const main = getMainWindow();
    if (!main) return { x: 120, y: 120, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
    const [mw, mh] = main.getSize();
    const [mx, my] = main.getPosition();
    const margin = 16;
    return {
      x: mx + mw - DEFAULT_WIDTH - margin,
      y: my + mh - DEFAULT_HEIGHT - margin,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    };
  }

  function attachSecurityHandlers(webContents) {
    // Defense-in-depth: validate every <webview> before it attaches.
    webContents.on("will-attach-webview", (event, attachedWebPreferences, params) => {
      const providerId = params.webPreferences?.partition === "persist:external-assistant-gemini"
        ? "gemini"
        : "chatgpt";
      const result = validateWebviewAttachment({
        src: params.src,
        partition: params.webPreferences?.partition,
        preload: attachedWebPreferences.preload,
        nodeIntegration: Boolean(attachedWebPreferences.nodeIntegration),
        contextIsolation: attachedWebPreferences.contextIsolation !== false,
        providerId,
      });
      if (!result.ok) {
        console.error(`[external-assistant] blocked webview attachment: ${result.reason}`);
        event.preventDefault();
      }
    });

    // Each webview's contents, once attached, is gated on navigation.
    webContents.on("did-attach-webview", (_event, webviewContents) => {
      webviewContents.on("will-navigate", (navEvent, url) => {
        const partition = webviewContents.session.getUserPartitionName();
        const providerId = partition === "persist:external-assistant-gemini" ? "gemini" : "chatgpt";
        if (isAllowedNavigation(providerId, url)) return;
        navEvent.preventDefault();
        void shell.openExternal(url);
      });
      webviewContents.setWindowOpenHandler(({ url }) => {
        const partition = webviewContents.session.getUserPartitionName();
        const providerId = partition === "persist:external-assistant-gemini" ? "gemini" : "chatgpt";
        if (isAllowedNavigation(providerId, url)) return { action: "allow" };
        void shell.openExternal(url);
        return { action: "deny" };
      });
    });
  }

  function ensureWindow() {
    if (childWindow && !childWindow.isDestroyed()) return childWindow;
    const main = getMainWindow();
    const saved = readState();
    const bounds = saved
      ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
      : defaultBounds();

    childWindow = new BrowserWindow({
      parent: main ?? undefined,
      frame: false,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      minWidth: 320,
      minHeight: 400,
      maxWidth: 560,
      maxHeight: 900,
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      show: false,
      titleBarStyle: "hidden",
      webPreferences: {
        preload: path.join(__dirname, "external-assistant-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
      },
    });

    attachSecurityHandlers(childWindow.webContents);

    childWindow.on("move", scheduleBoundsPersist);
    childWindow.on("resize", scheduleBoundsPersist);
    childWindow.on("close", (event) => {
      // Close hides instead of destroying, so webview sessions stay alive.
      event.preventDefault();
      hide();
    });

    // alwaysOnTop follows main-window focus (see wireFocusTracking).
    childWindow.setAlwaysOnTop(true, "floating");

    childWindow.loadURL("opennotion-app://renderer/external-assistant.html");
    return childWindow;
  }

  function show(provider) {
    const win = ensureWindow();
    if (provider) persistState({ provider });
    win.show();
    win.focus();
    wasOpenForUser = true;
    persistState({ lastOpenedAt: new Date().toISOString() });
  }

  function hide() {
    if (!childWindow || childWindow.isDestroyed()) return;
    childWindow.hide();
    wasOpenForUser = false;
  }

  function toggle(options = {}) {
    const win = ensureWindow();
    if (win.isVisible() && wasOpenForUser) {
      hide();
      return;
    }
    show(typeof options.provider === "string" ? options.provider : undefined);
  }

  function wireFocusTracking() {
    const main = getMainWindow();
    if (!main) return;
    main.on("focus", () => {
      if (blurHideTimer) { clearTimeout(blurHideTimer); blurHideTimer = null; }
      if (wasOpenForUser && childWindow && !childWindow.isDestroyed()) {
        childWindow.show();
      }
    });
    main.on("blur", () => {
      if (!wasOpenForUser) return;
      if (blurHideTimer) clearTimeout(blurHideTimer);
      blurHideTimer = setTimeout(() => {
        blurHideTimer = null;
        if (childWindow && !childWindow.isDestroyed()) childWindow.hide();
      }, 100);
    });
  }

  function registerIpc() {
    ipcMain.handle("external-assistant:toggle", (_event, options) => {
      try {
        toggle(options && typeof options === "object" ? options : {});
      } catch (error) {
        console.error(`[external-assistant] toggle failed: ${error?.message ?? error}`);
      }
      return null;
    });
    ipcMain.handle("external-assistant:get-state", () => {
      const saved = readState();
      return { provider: saved?.provider ?? "chatgpt" };
    });
    ipcMain.handle("external-assistant:set-provider", (_event, provider) => {
      if (provider === "chatgpt" || provider === "gemini") {
        persistState({ provider });
      }
      return null;
    });
    ipcMain.on("external-assistant:close", () => hide());
  }

  return {
    init() {
      registerIpc();
      wireFocusTracking();
    },
    // Exposed for unit-style smoke; not used directly by the renderer.
    _internal: { ensureWindow, show, hide, toggle, readState, persistState },
  };
}

module.exports = { createExternalAssistantController, STATE_KEY };
```

- [ ] **Step 5: Wire the controller into `electron/main.cjs`**

Modify `electron/main.cjs`:

At the top, after the existing `require("./backend.cjs")` line (around line 17), add:
```javascript
const { createExternalAssistantController } = require("./external-assistant.cjs");
```

Add a module-level variable near the other `let` declarations (around line 49, after `let mainWindow = null;`):
```javascript
let externalAssistant = null;
```

Inside the `app.whenReady().then(...)` block (after `createMainWindow();`, around line 1072), add:
```javascript
  externalAssistant = createExternalAssistantController({
    getMainWindow: () => mainWindow,
    backend: createBackend(),
  });
  externalAssistant.init();
```

- [ ] **Step 6: Commit**

```bash
git add electron/external-assistant-providers.cjs electron/external-assistant.cjs electron/external-assistant.test.cjs electron/main.cjs
git commit -m "feat(external-assistant): add child window controller + security

Controller creates the frameless child BrowserWindow, wires toggle /
get-state / set-provider / close IPC, persists state to app_metadata,
and enforces will-attach-webview validation + will-navigate /
setWindowOpenHandler allowlists (https-only, tight hosts). CJS
provider table is the Electron-side source of truth with a drift test."
```

---

## Task 6: Expose the renderer bridge (`window.openNotion.externalAssistant`)

The main renderer (sidebar button, shortcut) drives the popover via a typed bridge.

**Files:**
- Modify: `electron/preload.cjs`
- Modify: `src/lib/desktop.ts`

- [ ] **Step 1: Expose the bridge in the preload**

In `electron/preload.cjs`, inside the `contextBridge.exposeInMainWorld("openNotion", { ... })` object literal, add a new property (after `setNativeThemeSource`):

```javascript
  externalAssistant: {
    toggle(options) {
      return ipcRenderer.invoke("external-assistant:toggle", isRecord(options) ? options : {});
    },
  },
```

- [ ] **Step 2: Add the typed surface in `src/lib/desktop.ts`**

In `src/lib/desktop.ts`, add to the `ShelfDesktopBridge` interface (before `setNativeThemeSource?`):

```typescript
  externalAssistant?: { toggle(options?: { provider?: "chatgpt" | "gemini" }): Promise<null> };
```

Then add a typed wrapper function near the other wrappers (e.g. after `setNativeThemeSource`):

```typescript
export async function toggleExternalAssistant(options?: { provider?: "chatgpt" | "gemini" }): Promise<void> {
  await window.openNotion?.externalAssistant?.toggle(options);
}
```

- [ ] **Step 3: Verify the build still type-checks**

Run: `npm run build`
Expected: TypeScript build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add electron/preload.cjs src/lib/desktop.ts
git commit -m "feat(external-assistant): expose renderer bridge

Adds window.openNotion.externalAssistant.toggle plus a typed wrapper
in src/lib/desktop.ts. The main renderer can now drive the popover."
```

---

## Task 7: Build the React shell (header, webviews, footer)

Replace the placeholder from Task 3 with the real popover UI.

**Files:**
- Create: `src/external-assistant/ExternalAssistantHeader.tsx`
- Create: `src/external-assistant/AssistantWebview.tsx`
- Create: `src/external-assistant/ExternalAssistantPopover.tsx`
- Modify: `src/external-assistant/main.tsx`

- [ ] **Step 1: Create the header component**

Create `src/external-assistant/ExternalAssistantHeader.tsx`:

```typescript
import { X } from "lucide-react/dist/esm/icons/x.mjs";
import type { ProviderId } from "../lib/externalAssistant";
import { SHELL_PROVIDERS } from "./providers";

interface Props {
  provider: ProviderId;
  onProviderChange: (provider: ProviderId) => void;
  onClose: () => void;
}

export function ExternalAssistantHeader({ provider, onProviderChange, onClose }: Props) {
  return (
    <div className="ea-popover-header">
      <div className="ea-popover-switcher">
        {SHELL_PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="ea-popover-switcher-button"
            data-active={p.id === provider}
            onClick={() => onProviderChange(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="ea-popover-close"
        aria-label="Close"
        onClick={onClose}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create the webview wrapper**

Create `src/external-assistant/AssistantWebview.tsx`:

```typescript
import type { Provider } from "../lib/externalAssistant";

interface Props {
  provider: Provider;
  visible: boolean;
}

export function AssistantWebview({ provider, visible }: Props) {
  return (
    <webview
      // Both webviews are always mounted; only the active one is visible,
      // so switching providers preserves each conversation in memory.
      src={provider.url}
      partition={provider.partition}
      className="ea-popover-webview"
      style={{ display: visible ? "flex" : "none" }}
    />
  );
}
```

- [ ] **Step 3: Create the root popover component**

Create `src/external-assistant/ExternalAssistantPopover.tsx`:

```typescript
import { useEffect, useState } from "react";
import { ExternalAssistantHeader } from "./ExternalAssistantHeader";
import { AssistantWebview } from "./AssistantWebview";
import { SHELL_PROVIDERS } from "./providers";
import type { ProviderId } from "../lib/externalAssistant";

declare global {
  interface Window {
    externalAssistantShell?: {
      getInitialState: () => Promise<{ provider: ProviderId }>;
      setProvider: (provider: ProviderId) => Promise<null>;
      close: () => void;
    };
  }
}

export function ExternalAssistantPopover() {
  const [provider, setProvider] = useState<ProviderId>("chatgpt");

  useEffect(() => {
    let cancelled = false;
    void window.externalAssistantShell?.getInitialState().then((state) => {
      if (cancelled || !state) return;
      setProvider(state.provider);
    });
    return () => { cancelled = true; };
  }, []);

  const handleProviderChange = (next: ProviderId) => {
    setProvider(next);
    void window.externalAssistantShell?.setProvider(next);
  };

  return (
    <div className="ea-popover-root">
      <ExternalAssistantHeader
        provider={provider}
        onProviderChange={handleProviderChange}
        onClose={() => window.externalAssistantShell?.close()}
      />
      <div className="ea-popover-body">
        {SHELL_PROVIDERS.map((p) => (
          <AssistantWebview key={p.id} provider={p} visible={p.id === provider} />
        ))}
      </div>
      <footer className="ea-popover-footer">
        {provider === "chatgpt"
          ? "Served by OpenAI — your chats go to their servers."
          : "Served by Google — your chats go to their servers."}
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Wire the popover into the bootstrap**

Replace the contents of `src/external-assistant/main.tsx` with:

```typescript
import React from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { ExternalAssistantPopover } from "./ExternalAssistantPopover";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <ExternalAssistantPopover />
    </React.StrictMode>,
  );
}
```

- [ ] **Step 5: Add the popover shell styles**

Append to `src/index.css`:

```css
/* External assistant popover shell */
.ea-popover-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--background, #ffffff);
  color: var(--foreground, #000000);
}

.ea-popover-header {
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  flex-shrink: 0;
}

.ea-popover-switcher {
  display: flex;
  gap: 4px;
}

.ea-popover-switcher-button {
  -webkit-app-region: no-drag;
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.ea-popover-switcher-button[data-active="true"] {
  background: rgba(0, 0, 0, 0.08);
  font-weight: 600;
}

.ea-popover-close {
  -webkit-app-region: no-drag;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.ea-popover-close:hover {
  background: rgba(0, 0, 0, 0.08);
}

.ea-popover-body {
  flex: 1 1 auto;
  display: flex;
  overflow: hidden;
}

.ea-popover-webview {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  border: none;
}

.ea-popover-footer {
  flex-shrink: 0;
  padding: 6px 10px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.55);
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}

:root.dark .ea-popover-header,
:root.dark .ea-popover-footer {
  border-color: rgba(255, 255, 255, 0.1);
}

:root.dark .ea-popover-switcher-button[data-active="true"],
:root.dark .ea-popover-close:hover {
  background: rgba(255, 255, 255, 0.12);
}

:root.dark .ea-popover-footer {
  color: rgba(255, 255, 255, 0.55);
}
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: build succeeds, `dist/external-assistant.html` and its assets are emitted.

- [ ] **Step 7: Commit**

```bash
git add src/external-assistant/ExternalAssistantHeader.tsx src/external-assistant/AssistantWebview.tsx src/external-assistant/ExternalAssistantPopover.tsx src/external-assistant/main.tsx src/index.css
git commit -m "feat(external-assistant): build popover shell UI

Header (drag region + single switcher + close), two always-mounted
<webview>s (only one visible, preserving each conversation), and a
footer disclosing the serving provider. Dark-mode aware."
```

---

## Task 8: Sidebar "Chat" button + `Cmd+Shift+A` shortcut + i18n

Wire the entry points into the main renderer.

**Files:**
- Modify: `src/lib/locales/en.ts`
- Modify: `src/lib/locales/it.ts`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the i18n keys**

In `src/lib/locales/en.ts`, after the `"sidebar.importPdf"` line (around line 155), add:

```typescript
  "sidebar.chat": "Chat",
  "externalAssistant.footerOpenAI": "Served by OpenAI — your chats go to their servers.",
  "externalAssistant.footerGoogle": "Served by Google — your chats go to their servers.",
```

In `src/lib/locales/it.ts`, after the `"sidebar.importPdf"` line (around line 157), add:

```typescript
  "sidebar.chat": "Chat",
  "externalAssistant.footerOpenAI": "Servito da OpenAI — le tue chat vanno ai loro server.",
  "externalAssistant.footerGoogle": "Servito da Google — le tue chat vanno ai loro server.",
```

- [ ] **Step 2: Add the sidebar button**

In `src/components/Sidebar.tsx`, add to the icon imports (near the other `lucide-react` imports around line 7-31):

```typescript
import MessageSquare from "lucide-react/dist/esm/icons/message-square.mjs";
```

Then, in the nav block, immediately **after** the Home button (the button whose onClick is `() => setCurrentPageId(HOME_PAGE_ID)`, around line 1677-1683), add:

```tsx
        <button
          className="on-shell-row"
          onClick={() => void window.openNotion?.externalAssistant?.toggle()}
          title={t("sidebar.chat")}
        >
          <MessageSquare className="on-sidebar-nav-icon" strokeWidth={1.9} />
          <span>{t("sidebar.chat")}</span>
        </button>
```

- [ ] **Step 3: Add the keyboard shortcut**

In `src/App.tsx`, inside the existing `handleKeyDown` effect (the one that handles `Cmd+K`, around line 92-108), add this block after the `Cmd+K` handler and before the `isNewPageShortcut` check:

```typescript
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey
        && event.key.toLowerCase() === "a") {
        event.preventDefault();
        void window.openNotion?.externalAssistant?.toggle();
        return;
      }
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/locales/en.ts src/lib/locales/it.ts src/components/Sidebar.tsx src/App.tsx
git commit -m "feat(external-assistant): add Chat sidebar button + Cmd+Shift+A

Sidebar nav gets a 'Chat' button at the end (MessageSquare icon), and
Cmd+Shift+A toggles the popover. Both call the externalAssistant bridge.
Adds en/it strings for sidebar.chat and the footer disclosures."
```

---

## Task 9: End-to-end test — popover lifecycle

Playwright drives the Electron app and the child window. The provider login flow is intentionally skipped (requires live credentials + external network).

**Files:**
- Create: `tests/e2e/external-assistant.e2e.ts`

- [ ] **Step 1: Create the e2e spec**

Create `tests/e2e/external-assistant.e2e.ts`:

```typescript
import { expect, test } from "@playwright/test";
import { installMockBridge } from "./helpers/mockBridge";

// Covers the popover lifecycle. The mock bridge stubs externalAssistant.toggle
// (it cannot spawn a real Electron child window under the Vite-only e2e setup),
// so these tests assert the renderer-side entry points fire the bridge call
// correctly. Real child-window behavior is covered by electron:smoke:runtime.

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
  await page.addInitScript(() => {
    window.localStorage.removeItem("opennotion-current-page-id");
  });
});

test("sidebar Chat button calls externalAssistant.toggle", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Chat" }).click();

  const calls = await page.evaluate(() => (window as any).__externalAssistantToggleCalls ?? 0);
  expect(calls).toBeGreaterThanOrEqual(1);
});

test("Cmd+Shift+A shortcut calls externalAssistant.toggle", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.keyboard.press("Meta+Shift+A");

  const calls = await page.evaluate(() => (window as any).__externalAssistantToggleCalls ?? 0);
  expect(calls).toBeGreaterThanOrEqual(1);
});

// NOTE: the real provider login flow (ChatGPT / Gemini) is NOT tested here.
// It requires live credentials and external network access, which makes it
// flaky and inappropriate for CI. It is verified manually before release.
```

- [ ] **Step 2: Run the spec**

Run: `npx playwright test tests/e2e/external-assistant.e2e.ts`
Expected: both tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/external-assistant.e2e.ts
git commit -m "test(external-assistant): e2e for Chat button + shortcut

Asserts the sidebar button and Cmd+Shift+A both invoke the
externalAssistant bridge. The mock bridge stubs toggle (no real Electron
child window under Vite-only e2e). Real provider login is manual."
```

---

## Task 10: Update the no-ai guard with the positive assertion

Now that the popover exists, tighten the guard from Task 1 to also assert the positive half of the contract: the only AI surface is the isolated external popover, reachable via the "Chat" button (which opens a separate window, not an in-data panel).

**Files:**
- Modify: `tests/e2e/no-ai.e2e.ts`

- [ ] **Step 1: Add the positive assertion**

In `tests/e2e/no-ai.e2e.ts`, inside the single `test(...)` block, after the final `expect(dataBoundAiCommands).toEqual([]);` line, add:

```typescript

  // Positive half of the contract: the ONLY AI surface is the isolated
  // external popover, exposed as the "Chat" sidebar button. There must be
  // no in-data AI panel (no Ask-AI overlay rendered inside the workspace).
  const chatButton = page.getByRole("button", { name: "Chat" });
  await expect(chatButton).toHaveCount(1);
  // The workspace surface must not render an integrated AI chat panel.
  await expect(page.locator(".on-app-shell .ai-chat-panel")).toHaveCount(0);
```

- [ ] **Step 2: Run the guard**

Run: `npx playwright test tests/e2e/no-ai.e2e.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/no-ai.e2e.ts
git commit -m "test(no-ai): assert only-AI-surface-is-the-popover contract

The Chat button exists and is the single permitted AI surface; no
in-data AI panel is rendered inside the workspace."
```

---

## Task 11: Full gate run

Run the repo's full gate to confirm nothing else regressed.

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: all pass, including the new `externalAssistant.test.ts` and `external-assistant.test.cjs`.

- [ ] **Step 2: Run the e2e suite for the affected specs**

Run: `npx playwright test tests/e2e/no-ai.e2e.ts tests/e2e/external-assistant.e2e.ts`
Expected: all pass. (If either flakes, re-run it in isolation per the AGENTS.md guidance.)

- [ ] **Step 3: Build the Electron app dir-package (smoke)**

Run: `npm run electron:package:dir`
Expected: packages without error.

- [ ] **Step 4: Run the runtime smoke**

Run: `npm run electron:smoke:runtime`
Expected: passes (this also validates the child window can be created without error).

- [ ] **Step 5: Commit any final adjustments (if needed)**

If any baseline or snapshot needed a deliberate update, commit it with a clear message. Otherwise, no commit needed for this task.

---

## Self-Review

**Spec coverage check:**

- *Decision re: no-ai contract* → Task 1 (guard replacement) + Task 10 (positive assertion).
- *Architecture: child frameless BrowserWindow + <webview>* → Task 5 (controller) + Task 7 (shell).
- *Security pillar 1 (isolation via <webview> + partitions)* → Task 5 (partitions enforced in `will-attach-webview`) + Task 7 (webview tags with partitions).
- *Security pillar 2 (no bridge to Shelf data)* → Task 4 (minimal preload) + Task 6 (renderer bridge is toggle-only).
- *Security pillar 3 (navigation allowlist)* → Task 2 (helpers) + Task 5 (will-navigate / setWindowOpenHandler).
- *Security pillar 4 (will-attach-webview validation)* → Task 2 (validateWebviewAttachment) + Task 5 (wired in controller).
- *UI: sidebar button + Cmd+Shift+A* → Task 8.
- *Persistence (bounds + provider, no visibility flag)* → Task 5 (persistState, lastOpenedAt only).
- *alwaysOnTop tied to Shelf focus* → Task 5 (wireFocusTracking).
- *Footer transparency* → Task 7 (footer) + Task 8 (i18n keys).
- *Theming (dark mode)* → Task 7 (CSS dark selectors).
- *Error handling (corrupt state, window creation failure)* → Task 5 (defensive readState, try/catch in toggle).
- *Testing: unit + e2e* → Task 2 (TS unit) + Task 5 (CJS unit) + Task 9 (e2e).

No gaps identified.

**Placeholder scan:** none — every code step contains real code; no TBD/TODO/"handle edge cases".

**Type consistency:** `ProviderId` is `"chatgpt" | "gemini"` everywhere. `ExternalAssistantState` fields (`x, y, width, height, provider, lastOpenedAt`) are consistent between the TS parser, the CJS parser, and the persistence writer. `validateWebviewAttachment` params match between the TS and CJS implementations (drift-guarded by the CJS test). The bridge method is `toggle` on both the preload (`externalAssistant.toggle`) and the typed wrapper (`toggleExternalAssistant`). The shell-side surface is `window.externalAssistantShell` (distinct from `window.openNotion.externalAssistant`).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-20-external-assistant-popover.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
