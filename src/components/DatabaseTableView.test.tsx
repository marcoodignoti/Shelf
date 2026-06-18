// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DatabaseTableView } from "./DatabaseTableView";
import { defaultDatabaseSchema, parseDatabaseSchema } from "../lib/database";
import type { Page } from "../lib/db";

const mocks = vi.hoisted(() => ({
  addPage: vi.fn(),
  showError: vi.fn(),
  addPageFromTemplate: vi.fn(),
  duplicatePageAction: vi.fn(),
  renamePageAction: vi.fn(),
  removePage: vi.fn(),
  reorderPagesAction: vi.fn(),
  toggleFavoriteAction: vi.fn(),
  toggleTemplateAction: vi.fn(),
  updatePageOptimistically: vi.fn(),
  updatePage: vi.fn(),
}));

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: "page-1",
    title: "Page 1",
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
    page_kind: "note",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function emptyDatabaseSchema(): string {
  return JSON.stringify({
    ...defaultDatabaseSchema(),
    properties: [],
    sort: null,
    filter: null,
    boardPropertyId: null,
  });
}

vi.mock("../store/useAppStore", () => ({
  useAppStore: vi.fn((selector) =>
    selector({
      addPage: mocks.addPage,
      showError: mocks.showError,
      addPageFromTemplate: mocks.addPageFromTemplate,
      duplicatePageAction: mocks.duplicatePageAction,
      renamePageAction: mocks.renamePageAction,
      removePage: mocks.removePage,
      reorderPagesAction: mocks.reorderPagesAction,
      toggleFavoriteAction: mocks.toggleFavoriteAction,
      toggleTemplateAction: mocks.toggleTemplateAction,
      updatePageOptimistically: mocks.updatePageOptimistically,
    })
  ),
}));

vi.mock("../store/useUIStore", () => ({
  useUIStore: vi.fn((selector) => selector({ localePreference: "en" })),
}));

vi.mock("../lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/db")>();
  return {
    ...actual,
    updatePage: mocks.updatePage,
  };
});

describe("DatabaseTableView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updatePage.mockResolvedValue(undefined);
    mocks.addPage.mockResolvedValue(makePage({ id: "new-row", parent_id: "database" }));
    mocks.addPageFromTemplate.mockResolvedValue(makePage({ id: "templated-row", parent_id: "database" }));
    mocks.reorderPagesAction.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("adds a database property through the optimistic persistence path", async () => {
    const databasePage = makePage({
      id: "database",
      title: "Tasks",
      is_database: 1,
      database_schema: emptyDatabaseSchema(),
    });

    render(<DatabaseTableView databasePage={databasePage} rows={[]} onSelectPage={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("Add property"));

    await waitFor(() => expect(mocks.updatePageOptimistically).toHaveBeenCalled());
    const [, optimisticUpdate] = mocks.updatePageOptimistically.mock.calls[0];
    const nextSchema = parseDatabaseSchema(optimisticUpdate.database_schema);

    expect(nextSchema.properties).toHaveLength(1);
    expect(nextSchema.properties[0]).toMatchObject({ name: "Property", type: "text" });
    expect(mocks.updatePage).toHaveBeenCalledWith("database", optimisticUpdate);
  });

  it("rolls schema changes back and surfaces an error when persistence fails", async () => {
    const databasePage = makePage({
      id: "database",
      title: "Tasks",
      is_database: 1,
      database_schema: emptyDatabaseSchema(),
    });
    const error = new Error("write failed");
    mocks.updatePage.mockRejectedValueOnce(error);

    render(<DatabaseTableView databasePage={databasePage} rows={[]} onSelectPage={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("Add property"));

    await waitFor(() => expect(mocks.showError).toHaveBeenCalledWith(error));
    expect(mocks.updatePageOptimistically).toHaveBeenCalledTimes(2);
    expect(mocks.updatePageOptimistically.mock.calls[1]).toEqual([
      "database",
      { database_schema: databasePage.database_schema },
    ]);
  });

  it("creates a row without selecting it and appends it to the visible row order", async () => {
    const databasePage = makePage({
      id: "database",
      title: "Tasks",
      is_database: 1,
      database_schema: emptyDatabaseSchema(),
    });
    const existingRow = makePage({ id: "existing", title: "Existing", parent_id: "database" });

    render(<DatabaseTableView databasePage={databasePage} rows={[existingRow]} onSelectPage={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /^New$/ }));

    await waitFor(() => expect(mocks.addPage).toHaveBeenCalledWith("Untitled", "database", { select: false }));
    expect(mocks.reorderPagesAction).toHaveBeenCalledWith("database", ["existing", "new-row"]);
  });
});
