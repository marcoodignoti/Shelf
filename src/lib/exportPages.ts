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

export function sanitizeExportFilename(title: string): string {
  // eslint-disable-next-line no-control-regex
  const sanitized = title.replace(/[/\\?%*:|"<>. \u0000-\u001f]/g, "_");
  return sanitized || "Untitled";
}

export function collectDescendantPageIds(pages: Page[], rootIds: Iterable<string>): Set<string> {
  const ids = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const page of pages) {
      if (page.parent_id && ids.has(page.parent_id) && !ids.has(page.id)) {
        ids.add(page.id);
        changed = true;
      }
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

  const walk = async (parentPath: string, currentPage: Page, usedNames: Set<string>) => {
    const markdown = await renderPageMarkdown(currentPage);
    const content = `# ${currentPage.title || "Untitled"}\n\n${markdown}`;
    const baseName = uniqueName(sanitizeExportFilename(currentPage.title || "Untitled"), usedNames);
    const children = pages.filter((page) => page.parent_id === currentPage.id);

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
