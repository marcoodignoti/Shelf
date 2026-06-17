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
    const orphanedChild = { ...child, parent_id: null };
    let deleted = false;
    installFakeBridge({
      invokeHandler: (call) => {
        if (call.command === "list_pages") return deleted ? [orphanedChild] : [project, child];
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

  it("profile slice: fetchProfile, updateProfileAction, and importProfileAvatarAction work as expected", async () => {
    let mockProfile = { name: "Test User", workspaceName: "Test Workspace", avatarPath: "/path/to/avatar.png" };
    let importAvatarResult = "/path/to/new-avatar.png";

    const { fakeBridge } = installFakeBridge({
      invokeHandler: (call) => {
        if (call.command === "get_workspace_profile") {
          return mockProfile;
        }
        if (call.command === "update_workspace_profile") {
          mockProfile = { ...mockProfile, ...call.args };
          return mockProfile;
        }
        return undefined;
      },
    });

    fakeBridge.importProfileAvatar.mockImplementation(async () => importAvatarResult);

    const useAppStore = await loadStore();

    // 1. Initial profile should be null
    expect(useAppStore.getState().profile).toBeNull();

    // 2. fetchProfile should populate profile
    await useAppStore.getState().fetchProfile();
    expect(useAppStore.getState().profile).toEqual({
      name: "Test User",
      workspaceName: "Test Workspace",
      avatarPath: "/path/to/avatar.png",
    });

    // 3. updateProfileAction should update profile and call update_workspace_profile
    await useAppStore.getState().updateProfileAction({ name: "Updated User" });
    expect(useAppStore.getState().profile).toEqual({
      name: "Updated User",
      workspaceName: "Test Workspace",
      avatarPath: "/path/to/avatar.png",
    });
    expect(mockProfile.name).toBe("Updated User");

    // 4. importProfileAvatarAction should update the avatar path
    await useAppStore.getState().importProfileAvatarAction();
    expect(useAppStore.getState().profile?.avatarPath).toBe("/path/to/new-avatar.png");
  });
});
