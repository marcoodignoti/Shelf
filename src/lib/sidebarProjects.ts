import type { Page } from './db';

export type SidebarProjectGroup = {
  project: Page;
  children: Page[];
};

export type SidebarSections = {
  pinnedProjects: Page[];
  pinnedPages: Page[];
  projects: SidebarProjectGroup[];
  rootPages: Page[];
  contentPages: Page[];
};

export function isProjectPage(page: Page): boolean {
  return page.page_kind === 'project';
}

export function isContentPage(page: Page): boolean {
  return page.page_kind === 'note' || page.page_kind === 'studio_note';
}

export function sortSidebarPages(pages: Page[]): Page[] {
  return [...pages].sort((first, second) => {
    if (first.sort_order !== second.sort_order) {
      return first.sort_order - second.sort_order;
    }

    return second.created_at.localeCompare(first.created_at);
  });
}

export function buildSidebarSections(pages: Page[]): SidebarSections {
  const contentPages = sortSidebarPages(pages.filter(isContentPage));
  const projectPages = sortSidebarPages(pages.filter(isProjectPage));
  const pinnedProjects = projectPages.filter((page) => page.is_favorite === 1);
  const pinnedPages = contentPages.filter((page) => page.is_favorite === 1);
  const unpinnedContentPages = contentPages.filter((page) => page.is_favorite !== 1);
  const unpinnedChildrenByParentId = new Map<string | null, Page[]>();
  for (const page of unpinnedContentPages) {
    const children = unpinnedChildrenByParentId.get(page.parent_id);
    if (children) {
      children.push(page);
    } else {
      unpinnedChildrenByParentId.set(page.parent_id, [page]);
    }
  }
  const projects = projectPages
    .filter((project) => project.is_favorite !== 1)
    .map((project) => ({
      project,
      children: unpinnedChildrenByParentId.get(project.id) ?? [],
    }));
  const rootPages = unpinnedChildrenByParentId.get(null) ?? [];

  return {
    pinnedProjects,
    pinnedPages,
    projects,
    rootPages,
    contentPages,
  };
}
