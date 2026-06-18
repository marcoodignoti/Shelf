import type { Page } from "./db";

export type ExportFileEntry = {
  relativePath: string;
  content: string;
};

export type PageTreeExport = {
  version: 1;
  type: "page_tree";
  exported_at: string;
  root_page_id: string;
  pages: Page[];
};

export function mergePagesForExport(hydratedPages: Page[], currentPages: Page[]): Page[] {
  const currentById = new Map(currentPages.map((page) => [page.id, page]));
  return hydratedPages.map((page) => {
    const current = currentById.get(page.id);
    if (!current || current.content_loaded === 0) return page;
    return {
      ...page,
      content: current.content,
      search_text: current.search_text,
      content_loaded: current.content_loaded,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPageLike(value: unknown): value is Page {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    (typeof value.parent_id === "string" || value.parent_id === null) &&
    (typeof value.content === "string" || value.content === null) &&
    (typeof value.search_text === "string" || value.search_text === null) &&
    (typeof value.icon === "string" || value.icon === null) &&
    (typeof value.cover_url === "string" || value.cover_url === null) &&
    typeof value.is_deleted === "number" &&
    typeof value.is_favorite === "number" &&
    (typeof value.is_template === "number" || value.is_template === undefined) &&
    (typeof value.is_database === "number" || value.is_database === undefined) &&
    (typeof value.database_schema === "string" || value.database_schema === null || value.database_schema === undefined) &&
    (typeof value.properties === "string" || value.properties === null || value.properties === undefined) &&
    typeof value.sort_order === "number" &&
    (value.page_kind === "note" || value.page_kind === "studio_note" || value.page_kind === "project") &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}

export function isPageTreeExport(value: unknown): value is PageTreeExport {
  return (
    isRecord(value) &&
    value.version === 1 &&
    value.type === "page_tree" &&
    typeof value.exported_at === "string" &&
    typeof value.root_page_id === "string" &&
    Array.isArray(value.pages) &&
    value.pages.every(isPageLike)
  );
}

export function parsePageTreeExport(raw: string): PageTreeExport {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON file");
  }

  if (!isPageTreeExport(parsed)) {
    throw new Error("Unsupported JSON export format");
  }

  return parsed;
}

export function sanitizeExportFilename(title: string): string {
  // eslint-disable-next-line no-control-regex
  const sanitized = title.replace(/[/\\?%*:|"<>. \u0000-\u001f]/g, "_");
  return sanitized || "Untitled";
}

export function collectDescendantPageIds(pages: Page[], rootIds: Iterable<string>): Set<string> {
  const ids = new Set(rootIds);
  const childrenByParentId = new Map<string, Page[]>();
  for (const page of pages) {
    if (!page.parent_id) continue;
    const children = childrenByParentId.get(page.parent_id);
    if (children) {
      children.push(page);
    } else {
      childrenByParentId.set(page.parent_id, [page]);
    }
  }

  const queue = [...ids];
  for (let index = 0; index < queue.length; index += 1) {
    const children = childrenByParentId.get(queue[index]) ?? [];
    for (const child of children) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

export function buildPageTreeExport(
  pages: Page[],
  rootIds: string[],
  exportedAt: string
): PageTreeExport {
  const exportedIds = collectDescendantPageIds(pages, rootIds);
  return {
    version: 1,
    type: "page_tree",
    exported_at: exportedAt,
    root_page_id: rootIds[0],
    pages: pages.filter((page) => exportedIds.has(page.id)),
  };
}

function uniqueName(base: string, usedNames: Set<string>): string {
  let candidate = base;
  for (let suffix = 2; usedNames.has(candidate.toLowerCase()); suffix += 1) {
    candidate = `${base} ${suffix}`;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

// Builds the flat file list for a Markdown tree export. Pages with children
// become a directory holding their own "<name>.md" plus their subtree; leaf
// pages become a single "<name>.md". Sibling name collisions get a numeric
// suffix so no file silently overwrites another. Paths use "/" separators;
// the backend re-joins them with the platform separator.
export async function buildMarkdownTreeFiles(
  pages: Page[],
  rootPages: Page[],
  renderPageMarkdown: (page: Page) => Promise<string>,
  options: { flattenSingleRoot?: boolean } = {}
): Promise<ExportFileEntry[]> {
  const entries: ExportFileEntry[] = [];
  const childrenByParentId = new Map<string, Page[]>();
  for (const page of pages) {
    if (!page.parent_id) continue;
    const children = childrenByParentId.get(page.parent_id);
    if (children) {
      children.push(page);
    } else {
      childrenByParentId.set(page.parent_id, [page]);
    }
  }

  const walk = async (parentPath: string, currentPage: Page, usedNames: Set<string>) => {
    const markdown = await renderPageMarkdown(currentPage);
    const content = `# ${currentPage.title || "Untitled"}\n\n${markdown}`;
    const baseName = uniqueName(sanitizeExportFilename(currentPage.title || "Untitled"), usedNames);
    const children = childrenByParentId.get(currentPage.id) ?? [];

    if (children.length > 0) {
      const directory = parentPath ? `${parentPath}/${baseName}` : baseName;
      entries.push({ relativePath: `${directory}/${baseName}.md`, content });
      const childNames = new Set<string>([baseName.toLowerCase()]);
      for (const child of children) {
        await walk(directory, child, childNames);
      }
    } else {
      const filePath = parentPath ? `${parentPath}/${baseName}.md` : `${baseName}.md`;
      entries.push({ relativePath: filePath, content });
    }
  };

  const rootNames = new Set<string>();
  for (const rootPage of rootPages) {
    await walk("", rootPage, rootNames);
  }

  // A single exported root would otherwise nest everything inside its own
  // directory, doubling up with the export root the backend derives from the
  // chosen file name ("Name/Name/Name.md"). Lift its contents to the top.
  if (options.flattenSingleRoot && rootPages.length === 1 && entries.length > 1) {
    const prefixEnd = entries[0].relativePath.indexOf("/");
    if (prefixEnd > 0) {
      const prefix = entries[0].relativePath.slice(0, prefixEnd + 1);
      if (entries.every((entry) => entry.relativePath.startsWith(prefix))) {
        return entries.map((entry) => ({ ...entry, relativePath: entry.relativePath.slice(prefix.length) }));
      }
    }
  }
  return entries;
}
