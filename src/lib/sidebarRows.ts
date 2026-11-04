import type { Page } from './db';

export type SidebarRowSection = 'pinned' | 'projects' | 'pages';

export type SidebarProjectGroup = {
  project: Page;
  children: Page[];
};

export type SidebarRow =
  | {
    id: 'loading';
    kind: 'loading';
  }
  | {
    id: `section:${SidebarRowSection}`;
    kind: 'section';
    section: SidebarRowSection;
    isFirst: boolean;
  }
  | {
    id: `empty:${SidebarRowSection}`;
    kind: 'empty';
    section: SidebarRowSection;
  }
  | {
    id: `project:${string}`;
    kind: 'project';
    section: SidebarRowSection;
    page: Page;
    depth: number;
    hasChildren: boolean;
    isExpanded: boolean;
  }
  | {
    id: `page:${string}`;
    kind: 'page';
    section: SidebarRowSection;
    page: Page;
    depth: number;
    hasChildren: boolean;
    isExpanded: boolean;
  }
  | {
    id: 'studio-content';
    kind: 'studio-content';
  };

type BuildSidebarRowsOptions = {
  isLoading: boolean;
  pinnedProjectGroups: SidebarProjectGroup[];
  pinnedPages: Page[];
  projects: SidebarProjectGroup[];
  rootRegularPages: Page[];
  childrenByParentId: Map<string | null, Page[]>;
  expandedPageIds: ReadonlySet<string>;
  hasStudioContent: boolean;
};

/**
 * Produces the visible sidebar tree in preorder. Collapsed descendants never
 * enter the result, which keeps them out of the virtualized DOM entirely.
 */
export function buildSidebarRows({
  isLoading,
  pinnedProjectGroups,
  pinnedPages,
  projects,
  rootRegularPages,
  childrenByParentId,
  expandedPageIds,
  hasStudioContent,
}: BuildSidebarRowsOptions): SidebarRow[] {
  const rows: SidebarRow[] = [];

  const appendPage = (
    page: Page,
    depth: number,
    section: SidebarRowSection,
    ancestors: ReadonlySet<string> = new Set(),
  ) => {
    if (ancestors.has(page.id)) return;

    const children = childrenByParentId.get(page.id) ?? [];
    const isExpanded = expandedPageIds.has(page.id);
    rows.push({
      id: `page:${page.id}`,
      kind: 'page',
      section,
      page,
      depth,
      hasChildren: children.length > 0,
      isExpanded,
    });

    if (!isExpanded || children.length === 0) return;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(page.id);
    for (const child of children) {
      appendPage(child, depth + 1, section, nextAncestors);
    }
  };

  const appendProject = (group: SidebarProjectGroup, section: SidebarRowSection) => {
    const isExpanded = expandedPageIds.has(group.project.id);
    rows.push({
      id: `project:${group.project.id}`,
      kind: 'project',
      section,
      page: group.project,
      depth: 0,
      hasChildren: group.children.length > 0,
      isExpanded,
    });

    if (!isExpanded) return;
    for (const child of group.children) {
      appendPage(child, 1, section);
    }
  };

  if (isLoading) rows.push({ id: 'loading', kind: 'loading' });

  rows.push({ id: 'section:pinned', kind: 'section', section: 'pinned', isFirst: true });
  for (const group of pinnedProjectGroups) appendProject(group, 'pinned');
  for (const page of pinnedPages) appendPage(page, 0, 'pinned');
  if (!isLoading && pinnedProjectGroups.length === 0 && pinnedPages.length === 0) {
    rows.push({ id: 'empty:pinned', kind: 'empty', section: 'pinned' });
  }

  rows.push({ id: 'section:projects', kind: 'section', section: 'projects', isFirst: false });
  for (const group of projects) appendProject(group, 'projects');
  if (!isLoading && projects.length === 0) rows.push({ id: 'empty:projects', kind: 'empty', section: 'projects' });

  rows.push({ id: 'section:pages', kind: 'section', section: 'pages', isFirst: false });
  for (const page of rootRegularPages) appendPage(page, 0, 'pages');
  if (!isLoading && rootRegularPages.length === 0 && !hasStudioContent) {
    rows.push({ id: 'empty:pages', kind: 'empty', section: 'pages' });
  }
  if (hasStudioContent) rows.push({ id: 'studio-content', kind: 'studio-content' });

  return rows;
}
