import { describe, expect, it } from 'vitest';
import type { Page } from './db';
import { buildSidebarRows, type SidebarProjectGroup } from './sidebarRows';

function page(overrides: Partial<Page> & Pick<Page, 'id' | 'title'>): Page {
  return {
    id: overrides.id,
    title: overrides.title,
    parent_id: null,
    content: null,
    search_text: null,
    icon: null,
    cover_url: null,
    is_deleted: 0,
    is_favorite: 0,
    is_template: 0,
    sort_order: 0,
    page_kind: 'note',
    created_at: '2026-06-14T00:00:00.000Z',
    updated_at: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}

function rowsFor({
  pinnedProjectGroups = [],
  pinnedPages = [],
  projects = [],
  rootRegularPages = [],
  childrenByParentId = new Map<string | null, Page[]>(),
  expandedPageIds = new Set<string>(),
  hasStudioContent = false,
}: Partial<Parameters<typeof buildSidebarRows>[0]> = {}) {
  return buildSidebarRows({
    isLoading: false,
    pinnedProjectGroups,
    pinnedPages,
    projects,
    rootRegularPages,
    childrenByParentId,
    expandedPageIds,
    hasStudioContent,
  });
}

describe('buildSidebarRows', () => {
  it('flattens expanded projects and pages in sidebar preorder', () => {
    const project = page({ id: 'project', title: 'Project', page_kind: 'project' });
    const child = page({ id: 'child', title: 'Child', parent_id: project.id });
    const grandchild = page({ id: 'grandchild', title: 'Grandchild', parent_id: child.id });
    const root = page({ id: 'root', title: 'Root' });
    const projectGroups: SidebarProjectGroup[] = [{ project, children: [child] }];

    const rows = rowsFor({
      projects: projectGroups,
      rootRegularPages: [root],
      childrenByParentId: new Map([[project.id, [child]], [child.id, [grandchild]]]),
      expandedPageIds: new Set([project.id, child.id]),
    });

    expect(rows.map((row) => row.id)).toEqual([
      'section:pinned',
      'empty:pinned',
      'section:projects',
      'project:project',
      'page:child',
      'page:grandchild',
      'section:pages',
      'page:root',
    ]);
    expect(rows.filter((row) => row.kind === 'page').map((row) => ({ id: row.id, depth: row.depth }))).toEqual([
      { id: 'page:child', depth: 1 },
      { id: 'page:grandchild', depth: 2 },
      { id: 'page:root', depth: 0 },
    ]);
  });

  it('excludes collapsed descendants and keeps section rows stable', () => {
    const parent = page({ id: 'parent', title: 'Parent' });
    const child = page({ id: 'child', title: 'Child', parent_id: parent.id });

    const rows = rowsFor({
      rootRegularPages: [parent],
      childrenByParentId: new Map([[parent.id, [child]]]),
    });

    expect(rows.map((row) => row.id)).toEqual([
      'section:pinned',
      'empty:pinned',
      'section:projects',
      'empty:projects',
      'section:pages',
      'page:parent',
    ]);
  });

  it('preserves pinned content and exposes a single Studio content row', () => {
    const pinned = page({ id: 'pinned', title: 'Pinned', is_favorite: 1 });

    const rows = rowsFor({ pinnedPages: [pinned], hasStudioContent: true });

    expect(rows.map((row) => row.id)).toEqual([
      'section:pinned',
      'page:pinned',
      'section:projects',
      'empty:projects',
      'section:pages',
      'studio-content',
    ]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });
});
