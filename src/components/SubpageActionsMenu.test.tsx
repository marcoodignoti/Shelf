// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "../lib/db";
import { SubpageActionsMenu } from "./SubpageActionsMenu";

vi.mock("../store/useUIStore", () => ({
  useUIStore: vi.fn((selector) =>
    selector({
      localePreference: "en",
    })
  ),
}));

function page(overrides: Partial<Page> = {}): Page {
  return {
    id: "subpage-1",
    title: "Subpage",
    parent_id: "parent-1",
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
    ...overrides,
  };
}

describe("SubpageActionsMenu", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders page actions and calls handlers with the page", () => {
    const subpage = page();
    const onDuplicate = vi.fn();
    const onToggleFavorite = vi.fn();
    const onToggleTemplate = vi.fn();
    const onDelete = vi.fn();

    render(
      <SubpageActionsMenu
        page={subpage}
        onDuplicate={onDuplicate}
        onToggleFavorite={onToggleFavorite}
        onToggleTemplate={onToggleTemplate}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Favorites" }));
    fireEvent.click(screen.getByRole("button", { name: "Use as Template" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDuplicate).toHaveBeenCalledWith(subpage);
    expect(onToggleFavorite).toHaveBeenCalledWith(subpage);
    expect(onToggleTemplate).toHaveBeenCalledWith(subpage);
    expect(onDelete).toHaveBeenCalledWith(subpage);
  });

  it("uses removal labels for favorite template pages", () => {
    render(
      <SubpageActionsMenu
        page={page({ is_favorite: 1, is_template: 1 })}
        onDuplicate={vi.fn()}
        onToggleFavorite={vi.fn()}
        onToggleTemplate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Remove from Favorites" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove from Templates" })).toBeInTheDocument();
  });
});
