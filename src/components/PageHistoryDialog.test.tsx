// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { getPage, listPageVersions, restorePageVersion } from "../lib/db";
import { PageHistoryDialog } from "./PageHistoryDialog";

const mockFetchPages = vi.fn();
const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();
const mockUpdatePageOptimistically = vi.fn();

vi.mock("../lib/db", () => ({
  getPage: vi.fn(),
  listPageVersions: vi.fn(),
  restorePageVersion: vi.fn(),
}));

vi.mock("../store/useAppStore", () => ({
  useAppStore: vi.fn(() => ({
    fetchPages: mockFetchPages,
    showError: mockShowError,
    showSuccess: mockShowSuccess,
    updatePageOptimistically: mockUpdatePageOptimistically,
  })),
}));

vi.mock("../store/useUIStore", () => ({
  useUIStore: vi.fn((selector) => selector({ localePreference: "en" })),
}));

const version = {
  id: "version-1",
  page_id: "page-1",
  reason: "update",
  created_at: "2026-01-01T00:00:00.000Z",
  snapshot: {
    title: "Earlier title",
    content: JSON.stringify([{ type: "paragraph", content: "Readable draft" }]),
  },
};

const restoredPage = {
  id: "page-1",
  title: "Earlier title",
  parent_id: null,
  content: version.snapshot.content,
  search_text: "Readable draft",
  icon: null,
  cover_url: null,
  is_deleted: 0,
  is_favorite: 0,
  is_template: 0,
  is_database: 0,
  database_schema: null,
  properties: null,
  sort_order: 0,
  page_kind: "note" as const,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};

describe("PageHistoryDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listPageVersions).mockResolvedValue([version]);
    vi.mocked(restorePageVersion).mockResolvedValue(restoredPage);
    vi.mocked(getPage).mockResolvedValue(restoredPage);
  });

  afterEach(() => cleanup());

  it("shows a readable checkpoint preview and restores only after pending edits flush", async () => {
    const onBeforeRestore = vi.fn().mockResolvedValue(true);
    render(<PageHistoryDialog pageId="page-1" open onClose={vi.fn()} onBeforeRestore={onBeforeRestore} />);

    expect(await screen.findByText("Earlier title")).toBeInTheDocument();
    expect(screen.getByText("Readable draft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore version" }));

    await waitFor(() => {
      expect(onBeforeRestore).toHaveBeenCalledOnce();
      expect(restorePageVersion).toHaveBeenCalledWith("version-1");
      expect(mockUpdatePageOptimistically).toHaveBeenCalledWith("page-1", restoredPage);
      expect(mockFetchPages).toHaveBeenCalledOnce();
      expect(mockShowSuccess).toHaveBeenCalledWith("history.restored");
    });
  });

  it("does not restore a version when queued edits failed to flush", async () => {
    render(<PageHistoryDialog pageId="page-1" open onClose={vi.fn()} onBeforeRestore={() => false} />);
    await screen.findByText("Earlier title");
    fireEvent.click(screen.getByRole("button", { name: "Restore version" }));

    await waitFor(() => expect(restorePageVersion).not.toHaveBeenCalled());
  });
});
