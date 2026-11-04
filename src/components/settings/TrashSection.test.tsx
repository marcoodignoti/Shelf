// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { emptyTrash, listTrashPages, restorePage } from "../../lib/db";
import { TrashSection } from "./TrashSection";

const mockFetchPages = vi.fn();
const mockFetchStudioDocuments = vi.fn();
const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();
const mockUpdatePageOptimistically = vi.fn();

vi.mock("../../lib/db", () => ({
  emptyTrash: vi.fn(),
  listTrashPages: vi.fn(),
  restorePage: vi.fn(),
}));

vi.mock("../../store/useAppStore", () => ({
  useAppStore: vi.fn(() => ({
    fetchPages: mockFetchPages,
    fetchStudioDocuments: mockFetchStudioDocuments,
    showError: mockShowError,
    showSuccess: mockShowSuccess,
    updatePageOptimistically: mockUpdatePageOptimistically,
  })),
}));

vi.mock("../../store/useUIStore", () => ({
  useUIStore: vi.fn((selector) => selector({ localePreference: "en" })),
}));

const trashedPage = {
  id: "trashed-page",
  title: "Recover me",
  parent_id: null,
  content: null,
  search_text: null,
  icon: null,
  cover_url: null,
  is_deleted: 1,
  is_favorite: 0,
  is_template: 0,
  is_database: 0,
  database_schema: null,
  properties: null,
  sort_order: 0,
  page_kind: "note" as const,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  deleted_at: new Date().toISOString(),
  trash_root_id: "trashed-page",
  trashed_descendant_count: 2,
};

describe("TrashSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listTrashPages).mockResolvedValue([trashedPage]);
    vi.mocked(restorePage).mockResolvedValue({ ...trashedPage, is_deleted: 0, deleted_at: null, trash_root_id: null });
    vi.mocked(emptyTrash).mockResolvedValue(2);
  });

  afterEach(() => cleanup());

  it("lists and restores a trashed page", async () => {
    render(<TrashSection />);

    expect(await screen.findByText("Recover me")).toBeInTheDocument();
    expect(screen.getByText(/Includes 2 pages/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(restorePage).toHaveBeenCalledWith("trashed-page");
      expect(mockUpdatePageOptimistically).toHaveBeenCalledWith("trashed-page", expect.objectContaining({ is_deleted: 0 }));
      expect(mockFetchPages).toHaveBeenCalled();
      expect(mockFetchStudioDocuments).toHaveBeenCalled();
      expect(mockShowSuccess).toHaveBeenCalledWith("trash.restored", { title: "Recover me" });
    });
  });

  it("requires confirmation before emptying Trash", async () => {
    render(<TrashSection />);
    await screen.findByText("Recover me");

    fireEvent.click(screen.getByRole("button", { name: "Empty Trash" }));
    expect(emptyTrash).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));

    await waitFor(() => {
      expect(emptyTrash).toHaveBeenCalledOnce();
      expect(mockShowSuccess).toHaveBeenCalledWith("trash.emptied", { count: "2" });
    });
  });
});
