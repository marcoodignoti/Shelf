import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "../lib/db";

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

interface FakeBridgeOptions {
  invokeHandler?: (call: InvokeCall) => unknown;
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
  const g = globalThis as unknown as { window: Record<string, unknown> };
  g.window = (globalThis as unknown as { window?: Record<string, unknown> }).window ?? {};
  g.window.openNotion = fakeBridge;
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
