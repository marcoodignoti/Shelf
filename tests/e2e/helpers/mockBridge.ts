import type { Page } from "@playwright/test";

export interface MockPage {
  id: string;
  title: string;
  parent_id: string | null;
  content: string | null;
  search_text: string | null;
  icon: string | null;
  cover_url: string | null;
  is_deleted: number;
  is_favorite: number;
  is_template: number;
  is_database: number;
  database_schema: string | null;
  properties: string | null;
  sort_order: number;
  page_kind: "note" | "studio_note" | "project";
  created_at: string;
  updated_at: string;
}

export interface MockStudioDocument {
  id: string;
  title: string;
  original_filename: string;
  stored_file_path: string;
  note_page_id: string;
  project_id: string | null;
  last_opened_at: string;
  viewer_zoom: number;
  viewer_page: number;
  panel_layout: string;
  created_at: string;
  updated_at: string;
}

export interface MockStudioDocumentPageLink {
  id: string;
  document_id: string;
  page_id: string;
  pdf_page: number | null;
  label: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface MockProfile {
  name: string;
  workspaceName: string;
  avatarPath: string | null;
}

export interface MockBridgeOptions {
  storageKey?: string;
  profile?: MockProfile;
  initialPages?: MockPage[];
  initialStudioDocuments?: MockStudioDocument[];
  initialStudioProjects?: any[];
  initialStudioLinks?: MockStudioDocumentPageLink[];
  unlinkedPrimaryLinks?: string[];
  triggerDesktopUpdate?: boolean;
}

export async function installMockBridge(page: Page, options: MockBridgeOptions = {}) {
  await page.addInitScript((opts) => {
    const pagesKey = opts.storageKey || "opennotion-e2e-pages";
    const documentsKey = "opennotion-e2e-studio-documents";
    const linksKey = "opennotion-e2e-studio-page-links";
    const unlinkedPrimaryLinksKey = "opennotion-e2e-unlinked-primary-links";
    const projectsKey = "opennotion-e2e-studio-projects";
    const profileKey = "opennotion-e2e-profile";

    // Setup helper to load / save lists in localStorage
    const load = <T,>(key: string): T[] => JSON.parse(window.localStorage.getItem(key) ?? "[]");
    const save = <T,>(key: string, value: T[]) => window.localStorage.setItem(key, JSON.stringify(value));

    // Reset if it's the first run
    const resetKey = "opennotion-e2e-reset-v4";
    if (window.sessionStorage.getItem(resetKey) !== "done") {
      window.localStorage.removeItem(pagesKey);
      window.localStorage.removeItem(documentsKey);
      window.localStorage.removeItem(linksKey);
      window.localStorage.removeItem(unlinkedPrimaryLinksKey);
      window.localStorage.removeItem(projectsKey);
      window.localStorage.removeItem(profileKey);
      window.localStorage.removeItem("opennotion-current-page-id");
      window.sessionStorage.setItem(resetKey, "done");

      // Seed initial values
      if (opts.initialPages) save(pagesKey, opts.initialPages);
      if (opts.initialStudioDocuments) save(documentsKey, opts.initialStudioDocuments);
      if (opts.initialStudioLinks) save(linksKey, opts.initialStudioLinks);
      if (opts.unlinkedPrimaryLinks) save(unlinkedPrimaryLinksKey, opts.unlinkedPrimaryLinks);
      if (opts.initialStudioProjects) save(projectsKey, opts.initialStudioProjects);
      
      const defaultProfile = opts.profile || { name: "", workspaceName: "Shelf", avatarPath: null };
      window.localStorage.setItem(profileKey, JSON.stringify(defaultProfile));
    }

    const sortPages = (items: any[]) =>
      [...items].filter((p) => p.is_deleted === 0).sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return b.created_at.localeCompare(a.created_at);
      });

    const invokedCommands: string[] = [];
    (window as any).__opennotionE2eInvokedCommands = invokedCommands;

    window.openNotion = {
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        invokedCommands.push(cmd);
        const pages = load<any>(pagesKey);
        const docs = load<any>(documentsKey);
        const links = load<any>(linksKey);
        const unlinkedPrimaryLinks = load<string>(unlinkedPrimaryLinksKey);
        const projects = load<any>(projectsKey);

        if (cmd === "list_pages") {
          return sortPages(pages).filter((p) => p.page_kind === "note" || p.page_kind === "studio_note");
        }
        if (cmd === "list_all_pages") {
          return pages;
        }
        if (cmd === "get_page") {
          return pages.find((p) => p.id === args.id) ?? null;
        }
        if (cmd === "create_page") {
          const parentId = (args.parentId ?? args.parent_id ?? null) as string | null;
          const pageKind = (args.pageKind ?? args.page_kind ?? "note") as "note" | "studio_note" | "project";
          const p = {
            id: args.id as string,
            title: (args.title as string) || "Untitled",
            parent_id: parentId,
            content: null,
            search_text: null,
            icon: null,
            cover_url: null,
            is_deleted: 0,
            is_favorite: 0,
            is_template: 0,
            is_database: 0,
            database_schema: null,
            properties: null,
            sort_order: -1,
            page_kind: pageKind,
            created_at: args.createdAt as string || new Date().toISOString(),
            updated_at: args.createdAt as string || new Date().toISOString(),
          };
          save(pagesKey, [p, ...pages]);
          return p;
        }
        if (cmd === "create_project") {
          const minSort = pages
            .filter((p) => p.page_kind === "project")
            .reduce((min, p) => Math.min(min, p.sort_order), 0);
          const p = {
            id: args.id as string,
            title: (args.title as string) || "Untitled project",
            parent_id: null,
            content: null,
            search_text: null,
            icon: null,
            cover_url: null,
            is_deleted: 0,
            is_favorite: 0,
            is_template: 0,
            is_database: 0,
            database_schema: null,
            properties: null,
            sort_order: minSort - 1,
            page_kind: "project",
            created_at: args.createdAt as string || new Date().toISOString(),
            updated_at: args.createdAt as string || new Date().toISOString(),
          };
          save(pagesKey, [p, ...pages]);
          return p;
        }
        if (cmd === "update_page") {
          const id = args.id as string;
          const updates = args.updates as any;
          save(pagesKey, pages.map((p) => p.id === id ? { ...p, ...updates, updated_at: args.updatedAt as string || new Date().toISOString() } : p));
          return null;
        }
        if (cmd === "delete_page") {
          const id = args.id as string;
          const target = pages.find((p) => p.id === id);
          if (target) {
            // Reparent children if it's a project
            const updated = pages.map((p) => {
              if (p.id === id) {
                return { ...p, is_deleted: 1 };
              }
              if (p.parent_id === id) {
                return { ...p, parent_id: null };
              }
              return p;
            });
            save(pagesKey, updated);
          }
          return null;
        }
        if (cmd === "reorder_pages") {
          const orderedIds = args.orderedIds as string[];
          const parentId = (args.parentId ?? null) as string | null;
          save(pagesKey, pages.map((p) => {
            if (p.parent_id !== parentId) return p;
            const sortOrder = orderedIds.indexOf(p.id);
            return sortOrder !== -1 ? { ...p, sort_order: sortOrder } : p;
          }));
          return null;
        }
        if (cmd === "search_pages") {
          const q = ((args.query as string) || "").toLowerCase().trim();
          if (!q) return [];
          return pages.filter(p => p.is_deleted === 0 && (
            (p.title || "").toLowerCase().includes(q) || 
            (p.content || "").toLowerCase().includes(q)
          ));
        }

        // Studio Documents / Projects
        if (cmd === "list_studio_documents") {
          return docs;
        }
        if (cmd === "list_studio_projects") {
          return projects;
        }
        if (cmd === "list_studio_document_page_links") {
          const document = docs.find((d) => d.id === args.documentId);
          if (!document) return [];
          const storedLinks = links.filter((l) => l.document_id === document.id);
          const primaryLink = {
            id: `link-${document.id}-${document.note_page_id}`,
            document_id: document.id,
            page_id: document.note_page_id,
            pdf_page: null,
            label: "Primary note",
            sort_order: 0,
            created_at: document.created_at,
            updated_at: document.updated_at,
          };
          return [primaryLink, ...storedLinks]
            .filter((l) => l.page_id !== document.note_page_id || !unlinkedPrimaryLinks.includes(l.page_id))
            .filter((l, index, self) => self.findIndex((cand) => cand.page_id === l.page_id) === index)
            .map((l) => ({ ...l, page: pages.find((item) => item.id === l.page_id) }))
            .filter((l) => Boolean(l.page));
        }
        if (cmd === "list_all_studio_document_page_links") {
          const allLinks = docs.flatMap((document) => {
            const storedLinks = links.filter((l) => l.document_id === document.id);
            const primaryLink = {
              id: `link-${document.id}-${document.note_page_id}`,
              document_id: document.id,
              page_id: document.note_page_id,
              pdf_page: null,
              label: "Primary note",
              sort_order: 0,
              created_at: document.created_at,
              updated_at: document.updated_at,
            };
            return [primaryLink, ...storedLinks]
              .filter((l) => l.page_id !== document.note_page_id || !unlinkedPrimaryLinks.includes(l.page_id))
              .filter((l, index, self) => self.findIndex((cand) => cand.page_id === l.page_id) === index)
              .map((l) => ({ ...l, page: pages.find((item) => item.id === l.page_id) }))
              .filter((l) => Boolean(l.page));
          });
          return allLinks;
        }
        if (cmd === "import_studio_document") {
          const documentId = args.documentId as string;
          const notePageId = args.notePageId as string;
          const importedAt = args.importedAt as string || new Date().toISOString();
          const linkedNoteId = `${documentId}-linked-note`;
          const document = {
            id: documentId,
            title: args.title || "civil-law",
            original_filename: args.originalFilename || "civil-law.pdf",
            stored_file_path: args.storedFilePath || "/tmp/civil-law.pdf",
            note_page_id: notePageId,
            project_id: null,
            last_opened_at: importedAt,
            viewer_zoom: 100,
            viewer_page: 1,
            panel_layout: "pdf-left",
            created_at: importedAt,
            updated_at: importedAt,
          };
          const shouldSkipNote = window.localStorage.getItem("opennotion-e2e-missing-studio-note") === "1";
          const documentPage = {
            id: notePageId,
            title: args.title || "civil-law",
            parent_id: null,
            content: null,
            search_text: null,
            icon: null,
            cover_url: null,
            is_deleted: 0,
            is_favorite: 0,
            is_template: 0,
            is_database: 0,
            database_schema: null,
            properties: null,
            sort_order: 0,
            page_kind: documentId === notePageId ? "note" : "studio_note",
            created_at: importedAt,
            updated_at: importedAt,
          };
          const linkedNote = {
            id: linkedNoteId,
            title: (args.title || "civil-law") + " Notes",
            parent_id: notePageId,
            content: null,
            search_text: null,
            icon: null,
            cover_url: null,
            is_deleted: 0,
            is_favorite: 0,
            is_template: 0,
            is_database: 0,
            database_schema: null,
            properties: null,
            sort_order: -1,
            page_kind: "note",
            created_at: importedAt,
            updated_at: importedAt,
          };
          const linkedNoteLink = {
            id: `link-${documentId}-${linkedNoteId}`,
            document_id: documentId,
            page_id: linkedNoteId,
            pdf_page: null,
            label: "Linked note",
            sort_order: 1,
            created_at: importedAt,
            updated_at: importedAt,
          };
          save(documentsKey, [document, ...docs]);
          if (!shouldSkipNote) {
            save(pagesKey, [linkedNote, documentPage, ...pages]);
            save(linksKey, [linkedNoteLink, ...links]);
          } else {
            save(pagesKey, [documentPage, ...pages]);
          }
          return null;
        }
        if (cmd === "replace_studio_document_file") {
          const id = args.id as string;
          const updatedAt = args.updatedAt as string || new Date().toISOString();
          save(documentsKey, docs.map((d) => d.id === id ? { ...d, original_filename: "new-civil-law.pdf", stored_file_path: "/tmp/new-civil-law.pdf", updated_at: updatedAt } : d));
          return null;
        }
        if (cmd === "link_studio_document_page") {
          const link = {
            id: args.id as string,
            document_id: args.documentId as string,
            page_id: args.pageId as string,
            pdf_page: args.pdfPage as number | null,
            label: args.label as string | null,
            sort_order: args.sortOrder as number,
            created_at: args.createdAt as string || new Date().toISOString(),
            updated_at: args.createdAt as string || new Date().toISOString(),
          };
          // Remove from unlinked primary if it matches document primary note page
          const doc = docs.find(d => d.id === args.documentId);
          if (doc && doc.note_page_id === args.pageId) {
            save(unlinkedPrimaryLinksKey, unlinkedPrimaryLinks.filter(pid => pid !== args.pageId));
          }
          save(linksKey, [link, ...links]);
          return null;
        }
        if (cmd === "unlink_studio_document_page") {
          const documentId = args.documentId as string;
          const pageId = args.pageId as string;
          const doc = docs.find(d => d.id === documentId);
          if (doc && doc.note_page_id === pageId) {
            save(unlinkedPrimaryLinksKey, [...unlinkedPrimaryLinks, pageId]);
          }
          save(linksKey, links.filter(l => !(l.document_id === documentId && l.page_id === pageId)));
          return null;
        }
        if (cmd === "update_studio_document_viewer_state") {
          const id = args.id as string;
          save(documentsKey, docs.map((d) => d.id === id ? { ...d, ...args } : d));
          return null;
        }
        if (cmd === "delete_studio_document") {
          const id = args.id as string;
          save(documentsKey, docs.filter(d => d.id !== id));
          save(linksKey, links.filter(l => l.document_id !== id));
          // Delete note pages too
          const notePageIds = pages.filter(p => p.parent_id === id || p.id === id).map(p => p.id);
          save(pagesKey, pages.filter(p => !notePageIds.includes(p.id)));
          return null;
        }

        // Profile
        if (cmd === "get_workspace_profile") {
          return JSON.parse(window.localStorage.getItem(profileKey) ?? "{}");
        }
        if (cmd === "update_workspace_profile") {
          const currentProfile = JSON.parse(window.localStorage.getItem(profileKey) ?? "{}");
          const nextProfile = { ...currentProfile, ...args };
          window.localStorage.setItem(profileKey, JSON.stringify(nextProfile));
          return nextProfile;
        }

        // Character palette & media imports
        if (cmd === "show_character_palette") return null;
        if (cmd === "import_editor_image" || cmd === "import_editor_video") {
          return "/tmp/imported-file.png";
        }

        throw new Error(`Unhandled E2E mock command: ${cmd}`);
      },
      open: async () => null,
      save: async () => null,
      fileSrc: (filePath: string) => filePath,
      autoUpdateActive: () => true,
      installUpdateNow: async () => {
        const host = window as Window & { __installUpdateCalls?: number };
        host.__installUpdateCalls = (host.__installUpdateCalls ?? 0) + 1;
        return null;
      },
      onDesktopUpdate: (callback: (eventName: string, payload: unknown) => void) => {
        if (opts.triggerDesktopUpdate) {
          window.setTimeout(() => {
            callback("desktop-update-downloaded", { version: "9.9.9" });
          }, 50);
        }
        return () => {};
      },
      externalAssistant: {
        toggle: async () => {
          (window as any).__externalAssistantToggleCalls =
            ((window as any).__externalAssistantToggleCalls ?? 0) + 1;
        },
      },
    };
  }, options);
}
