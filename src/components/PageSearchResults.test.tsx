// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Page } from "../lib/db";
import { PageSearchResults } from "./PageSearchResults";

vi.mock("../lib/i18n", () => ({
  useT: () => (key: string) => key,
  useLocale: () => "en",
}));

const samplePages: Page[] = [
  { id: "p1", title: "Appunti", icon: null, is_favorite: 0, is_template: 0, is_database: 0, is_deleted: 0, parent_id: null, content: null, search_text: null, cover_url: null, sort_order: 0, page_kind: "note", created_at: "", updated_at: "" },
  { id: "p2", title: "Roadmap", icon: null, is_favorite: 0, is_template: 0, is_database: 0, is_deleted: 0, parent_id: null, content: null, search_text: null, cover_url: null, sort_order: 1, page_kind: "note", created_at: "", updated_at: "" },
];

describe("PageSearchResults", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("renders all pages when query is empty", () => {
    render(
      <PageSearchResults
        query=""
        pages={samplePages}
        searchResults={[]}
        onSelectPage={() => {}}
        isSearching={false}
        searchError={null}
        emptyKey="commandPalette.noPagesYet"
        noResultsKey="commandPalette.noResults"
        searchingKey="commandPalette.searching"
      />
    );
    expect(screen.getByText("Appunti")).toBeInTheDocument();
    expect(screen.getByText("Roadmap")).toBeInTheDocument();
  });

  it("disables the page whose id equals disabledPageId and shows already-open hint", () => {
    render(
      <PageSearchResults
        query=""
        pages={samplePages}
        searchResults={[]}
        onSelectPage={() => {}}
        isSearching={false}
        searchError={null}
        disabledPageId="p1"
        alreadyOpenKey="editor.alreadyOpen"
        emptyKey="commandPalette.noPagesYet"
        noResultsKey="commandPalette.noResults"
        searchingKey="commandPalette.searching"
      />
    );
    const appuntiBtn = screen.getByText("Appunti").closest("button")!;
    expect(appuntiBtn).toBeDisabled();
    expect(screen.getByText("editor.alreadyOpen")).toBeInTheDocument();
  });

  it("calls onSelectPage when an enabled page is clicked", () => {
    const onSelect = vi.fn();
    render(
      <PageSearchResults
        query=""
        pages={samplePages}
        searchResults={[]}
        onSelectPage={onSelect}
        isSearching={false}
        searchError={null}
        emptyKey="commandPalette.noPagesYet"
        noResultsKey="commandPalette.noResults"
        searchingKey="commandPalette.searching"
      />
    );
    fireEvent.click(screen.getByText("Roadmap"));
    expect(onSelect).toHaveBeenCalledWith("p2");
  });
});
