import { describe, expect, it } from 'vitest';
import type { Page } from './db';
import { buildSidebarSections } from './sidebarProjects';

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

describe('buildSidebarSections', () => {
  it('partitions pinned projects, project children, and root pages without duplicates', () => {
    const pages = [
      page({ id: 'project-a', title: 'Project A', page_kind: 'project', sort_order: 1 }),
      page({ id: 'project-b', title: 'Project B', page_kind: 'project', is_favorite: 1, sort_order: 2 }),
      page({ id: 'root', title: 'Root page', sort_order: 1 }),
      page({ id: 'project-child', title: 'Project child', parent_id: 'project-a', sort_order: 1 }),
      page({ id: 'project-pdf', title: 'Project PDF', parent_id: 'project-a', page_kind: 'studio_note', sort_order: 2 }),
      page({ id: 'pinned-child', title: 'Pinned child', parent_id: 'project-a', is_favorite: 1, sort_order: 3 }),
      page({ id: 'pinned-root', title: 'Pinned root', is_favorite: 1, sort_order: 4 }),
    ];

    const sections = buildSidebarSections(pages);

    expect(sections.pinnedProjects.map((project) => project.id)).toEqual(['project-b']);
    expect(sections.projects.map(({ project }) => project.id)).toEqual(['project-a']);
    expect(sections.projects[0].children.map((child) => child.id)).toEqual(['project-child', 'project-pdf']);
    expect(sections.pinnedPages.map((pinnedPage) => pinnedPage.id)).toEqual(['pinned-child', 'pinned-root']);
    expect(sections.rootPages.map((rootPage) => rootPage.id)).toEqual(['root']);
  });
});
