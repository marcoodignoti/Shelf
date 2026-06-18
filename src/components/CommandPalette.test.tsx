// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CommandPalette } from "./CommandPalette";
import type { Page, SearchResult } from "../lib/db";

const mocks = vi.hoisted(() => ({
  setCurrentPageId: vi.fn(),
  closeCommandPalette: vi.fn(),
  addPage: vi.fn(),
  searchPages: vi.fn(),
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
    sort_order: 0,
    page_kind: "note",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

vi.mock("../store/useAppStore", () => ({
  useAppStore: vi.fn((selector) =>
    selector({
      pages: [
        makePage({ id: "favorite", title: "Favorite", is_favorite: 1, updated_at: "2026-01-03T00:00:00.000Z" }),
        makePage({ id: "recent", title: "Recent", updated_at: "2026-01-02T00:00:00.000Z" }),
      ],
      setCurrentPageId: mocks.setCurrentPageId,
      isCommandPaletteOpen: true,
      closeCommandPalette: mocks.closeCommandPalette,
      addPage: mocks.addPage,
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
    searchPages: mocks.searchPages,
  };
});

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addPage.mockResolvedValue(makePage({ id: "new-page", title: "Untitled" }));
    mocks.searchPages.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("runs the suggested new-page command from the keyboard", async () => {
    render(<CommandPalette />);

    fireEvent.keyDown(screen.getByPlaceholderText("Search pages..."), { key: "Enter" });

    await waitFor(() => expect(mocks.addPage).toHaveBeenCalled());
    expect(mocks.setCurrentPageId).toHaveBeenCalledWith("new-page");
    expect(mocks.closeCommandPalette).toHaveBeenCalled();
  });

  it("selects a page result with arrow navigation and enter", () => {
    render(<CommandPalette />);

    const input = screen.getByPlaceholderText("Search pages...");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.setCurrentPageId).toHaveBeenCalledWith("recent");
    expect(mocks.closeCommandPalette).toHaveBeenCalled();
  });

  it("debounces search and renders async search results", async () => {
    const result: SearchResult = {
      ...makePage({ id: "physics", title: "Physics" }),
      matched_content: "A matched physics note",
    };
    mocks.searchPages.mockResolvedValue([result]);

    render(<CommandPalette />);

    fireEvent.change(screen.getByPlaceholderText("Search pages..."), { target: { value: "physics" } });

    await waitFor(() => expect(mocks.searchPages).toHaveBeenCalledWith("physics"));
    expect(await screen.findByText("Search results")).toBeInTheDocument();
    expect(screen.getByText("Physics")).toBeInTheDocument();
    expect(
      screen.getByText((_content, element) =>
        element?.textContent === "A matched physics note"
      )
    ).toBeInTheDocument();
  });

  it("shows a search failure state", async () => {
    mocks.searchPages.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<CommandPalette />);

    fireEvent.change(screen.getByPlaceholderText("Search pages..."), { target: { value: "missing" } });

    expect(await screen.findByText("Search failed.")).toBeInTheDocument();
    expect(console.error).toHaveBeenCalled();
  });
});
