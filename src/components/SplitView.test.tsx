// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Page } from "../lib/db";
import { SplitView } from "./SplitView";

vi.mock("./PageEditor", () => ({
  Editor: (props: any) => (
    <div
      data-testid={`editor-${props.page.id}`}
      onClick={props.onSelectPage ? () => props.onSelectPage("newid") : undefined}
    >
      {props.page.title}
    </div>
  ),
}));

const setSplitViewRatio = vi.fn();
const setActivePane = vi.fn();

vi.mock("../store/useAppStore", () => ({
  useAppStore: (selector: any) =>
    selector({
      setSplitViewRatio,
      setActivePane,
      splitViewRatio: 0.5,
      activePane: "primary",
    }),
}));

const primary = { id: "p1", title: "Primary" } as unknown as Page;
const secondary = { id: "p2", title: "Secondary" } as unknown as Page;

describe("SplitView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
  afterEach(() => cleanup());

  it("renders both editors", () => {
    render(
      <SplitView
        primary={primary}
        secondary={secondary}
        pages={[]}
        onSelectPrimaryPage={() => {}}
        onSelectSecondaryPage={() => {}}
      />
    );
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Secondary")).toBeInTheDocument();
  });

  it("clicking a pane sets it active", () => {
    render(
      <SplitView
        primary={primary}
        secondary={secondary}
        pages={[]}
        onSelectPrimaryPage={() => {}}
        onSelectSecondaryPage={() => {}}
      />
    );
    // A real click is pointerdown → focus → click; the pane listens on pointerdown.
    fireEvent.pointerDown(screen.getByTestId("editor-p2"));
    expect(setActivePane).toHaveBeenCalledWith("secondary");
  });

  it("divider drag updates split ratio", () => {
    render(
      <SplitView
        primary={primary}
        secondary={secondary}
        pages={[]}
        onSelectPrimaryPage={() => {}}
        onSelectSecondaryPage={() => {}}
      />
    );
    const container = screen.getByTestId("split-container");
    Object.defineProperty(container, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 1000, top: 0, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON() {} }),
    });
    const divider = screen.getByTestId("split-divider");
    fireEvent.pointerDown(divider, { clientX: 500, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 700, clientY: 0 });
    fireEvent.pointerUp(window);
    expect(setSplitViewRatio).toHaveBeenCalled();
    const lastCall = setSplitViewRatio.mock.calls.at(-1)?.[0];
    expect(lastCall).toBeGreaterThanOrEqual(0.2);
    expect(lastCall).toBeLessThanOrEqual(0.8);
  });
});
