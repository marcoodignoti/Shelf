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
