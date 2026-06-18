// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AboutSection } from "./AboutSection";
import { openExternalUrl } from "../../lib/desktop";
import { afterEach } from "vitest";
import { CURRENT_APP_VERSION } from "../../lib/betaUpdates";

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();

vi.mock("../../store/useAppStore", () => ({
  useAppStore: vi.fn((selector) =>
    selector({
      showSuccess: mockShowSuccess,
      showError: mockShowError,
    })
  ),
}));

vi.mock("../../store/useUIStore", () => ({
  useUIStore: vi.fn((selector) =>
    selector({
      localePreference: "en",
    })
  ),
}));

vi.mock("../../lib/desktop", () => ({
  openExternalUrl: vi.fn(),
}));

describe("AboutSection Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard writeText
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders version and descriptive settings rows", () => {
    render(<AboutSection />);

    // Check titles/labels are present (keys or translated values depending on setup, but resolve to english translations here)
    expect(screen.getByRole("heading", { name: /About Shelf/i })).toBeInTheDocument();
    expect(screen.getByText(CURRENT_APP_VERSION)).toBeInTheDocument();
  });

  it("triggers external URL opening when buttons are clicked", async () => {
    render(<AboutSection />);

    const githubButton = screen.getByRole("button", { name: /Open repository/i });
    fireEvent.click(githubButton);

    expect(openExternalUrl).toHaveBeenCalledWith("https://github.com/marcoodignoti/Shelf");
  });

  it("copies database path to clipboard and triggers showSuccess", async () => {
    render(<AboutSection />);

    const copyButton = screen.getByRole("button", { name: /Copy/i });
    fireEvent.click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "~/Library/Application Support/org.opennotion.desktop/opennotion.db"
    );
    await waitFor(() => {
      expect(mockShowSuccess).toHaveBeenCalledWith("settings.about.copied");
    });
  });
});
