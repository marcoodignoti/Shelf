// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ShortcutsSection } from "./ShortcutsSection";

vi.mock("../../store/useUIStore", () => ({
  useUIStore: vi.fn((selector) =>
    selector({
      localePreference: "en",
    })
  ),
}));

describe("ShortcutsSection Component", () => {
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalPlatform = Object.getOwnPropertyDescriptor(navigator, "platform");
  });

  afterEach(() => {
    cleanup();
    if (originalPlatform) {
      Object.defineProperty(navigator, "platform", originalPlatform);
    }
  });

  it("renders keyboard shortcuts headings and keys", () => {
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });

    render(<ShortcutsSection />);

    expect(screen.getByRole("heading", { name: /Shortcuts/i })).toBeInTheDocument();
    // Mac key display check
    expect(screen.getAllByText("⌘")[0]).toBeInTheDocument();
  });

  it("converts Apple symbols to Windows equivalents on non-mac platforms", () => {
    Object.defineProperty(navigator, "platform", {
      value: "Win32",
      configurable: true,
    });

    render(<ShortcutsSection />);

    // Ctrl check for Windows
    expect(screen.getAllByText("Ctrl")[0]).toBeInTheDocument();
    expect(screen.queryByText("⌘")).toBeNull();
  });
});
