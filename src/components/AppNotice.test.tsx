// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AppNotice } from "./AppNotice";

const mockClearNotice = vi.fn();
let currentNotice: any = null;

vi.mock("../store/useAppStore", () => ({
  useAppStore: vi.fn(() => ({
    notice: currentNotice,
    clearNotice: mockClearNotice,
  })),
}));

vi.mock("../store/useUIStore", () => ({
  useUIStore: vi.fn((selector) =>
    selector({
      localePreference: "en",
    })
  ),
}));

describe("AppNotice Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    currentNotice = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("renders nothing when notice is null", () => {
    const { container } = render(<AppNotice />);
    expect(container.firstChild).toBeNull();
  });

  it("renders success notice with translated messageKey", () => {
    currentNotice = {
      kind: "success",
      messageKey: "settings.about.copied",
    };

    render(<AppNotice />);

    expect(screen.getByText("Database path copied to clipboard.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveClass("on-notice-success");
  });

  it("renders error notice with rawMessage", () => {
    currentNotice = {
      kind: "error",
      rawMessage: "Something bad happened",
    };

    render(<AppNotice />);

    expect(screen.getByText("Something bad happened")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveClass("on-notice-error");
  });

  it("calls clearNotice when close button is clicked", () => {
    currentNotice = {
      kind: "success",
      rawMessage: "A notice",
    };

    render(<AppNotice />);

    const closeBtn = screen.getByRole("button", { name: "Dismiss notification" });
    fireEvent.click(closeBtn);

    expect(mockClearNotice).toHaveBeenCalledTimes(1);
  });

  it("automatically dismisses success notice after 4200ms", () => {
    currentNotice = {
      kind: "success",
      rawMessage: "Success message",
    };

    render(<AppNotice />);

    // Fast-forward time
    act(() => {
      vi.advanceTimersByTime(4200);
    });

    expect(mockClearNotice).toHaveBeenCalledTimes(1);
  });

  it("automatically dismisses error notice after 6500ms", () => {
    currentNotice = {
      kind: "error",
      rawMessage: "Error message",
    };

    render(<AppNotice />);

    // Success notice timer should not dismiss it yet
    act(() => {
      vi.advanceTimersByTime(4200);
    });
    expect(mockClearNotice).not.toHaveBeenCalled();

    // Advancing to 6500ms should trigger it
    act(() => {
      vi.advanceTimersByTime(2300);
    });
    expect(mockClearNotice).toHaveBeenCalledTimes(1);
  });
});
