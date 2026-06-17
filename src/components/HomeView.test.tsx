// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HomeView } from "./HomeView";
import { Page } from "../lib/db";

vi.mock("../store/useUIStore", () => ({
  useUIStore: vi.fn((selector) =>
    selector({
      localePreference: "en",
    })
  ),
}));

describe("HomeView Component", () => {
  const mockOnSelectPage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders empty states when there are no pages", () => {
    render(<HomeView pages={[]} onSelectPage={mockOnSelectPage} />);

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Recent workspace activity.")).toBeInTheDocument();
    expect(screen.getByText("No pages yet.")).toBeInTheDocument();
    expect(screen.getByText("No favorites yet.")).toBeInTheDocument();
  });

  it("renders lists of recent and favorite pages correctly", () => {
    const pages: Page[] = [
      {
        id: "p1",
        title: "Favorite Page",
        parent_id: null,
        content: null,
        search_text: null,
        icon: "🌟",
        cover_url: null,
        is_deleted: 0,
        is_favorite: 1,
        is_template: 0,
        sort_order: 0,
        page_kind: "note",
        created_at: "2026-06-17T10:00:00.000Z",
        updated_at: "2026-06-17T10:00:00.000Z",
      },
      {
        id: "p2",
        title: "Recent Page",
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
        created_at: "2026-06-17T10:30:00.000Z",
        updated_at: "2026-06-17T10:30:00.000Z",
      },
      {
        id: "p3",
        title: "Deleted Page",
        parent_id: null,
        content: null,
        search_text: null,
        icon: null,
        cover_url: null,
        is_deleted: 1,
        is_favorite: 1,
        is_template: 0,
        sort_order: 0,
        page_kind: "project", // not a note or studio_note, should be filtered out from home view
        created_at: "2026-06-17T10:40:00.000Z",
        updated_at: "2026-06-17T10:40:00.000Z",
      },
    ];

    render(<HomeView pages={pages} onSelectPage={mockOnSelectPage} />);

    // Favorite Page has icon "🌟", and is_favorite: 1. It is shown in both Recent and Favorites sections.
    expect(screen.getAllByText("Favorite Page")).toHaveLength(2);
    expect(screen.getAllByText("🌟")).toHaveLength(2);
    expect(screen.getByText("Recent Page")).toBeInTheDocument();

    // Deleted Page / project should not be in the list of notes
    expect(screen.queryByText("Deleted Page")).not.toBeInTheDocument();
  });

  it("calls onSelectPage when a page link is clicked", () => {
    const pages: Page[] = [
      {
        id: "p1",
        title: "Test Page",
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
        created_at: "2026-06-17T10:00:00.000Z",
        updated_at: "2026-06-17T10:00:00.000Z",
      },
    ];

    render(<HomeView pages={pages} onSelectPage={mockOnSelectPage} />);

    const pageButton = screen.getByRole("button", { name: "Test Page" });
    fireEvent.click(pageButton);

    expect(mockOnSelectPage).toHaveBeenCalledWith("p1");
  });

  it("displays 'Untitled' when a page has no title", () => {
    const pages: Page[] = [
      {
        id: "p1",
        title: "",
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
        created_at: "2026-06-17T10:00:00.000Z",
        updated_at: "2026-06-17T10:00:00.000Z",
      },
    ];

    render(<HomeView pages={pages} onSelectPage={mockOnSelectPage} />);

    expect(screen.getByRole("button", { name: "Untitled" })).toBeInTheDocument();
  });
});
