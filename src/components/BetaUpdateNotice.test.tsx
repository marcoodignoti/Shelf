// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BetaUpdateNotice } from "./BetaUpdateNotice";
import { checkForBetaUpdate, downloadVerifiedUpdate } from "../lib/betaUpdates";
import { desktopAutoUpdateActive } from "../lib/desktop";

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
const mockShowErrorKey = vi.fn();

vi.mock("../store/useAppStore", () => ({
  useAppStore: vi.fn((selector) =>
    selector({
      showSuccess: mockShowSuccess,
      showError: mockShowError,
      showErrorKey: mockShowErrorKey,
    })
  ),
}));

vi.mock("../store/useUIStore", () => ({
  useUIStore: vi.fn((selector) =>
    selector({
      localePreference: "en",
    })
  ),
}));

vi.mock("../lib/betaUpdates", () => ({
  checkForBetaUpdate: vi.fn(),
  downloadVerifiedUpdate: vi.fn(),
  dismissedUpdateKey: vi.fn((v) => `dismissed-update-${v}`),
}));

vi.mock("../lib/desktop", () => ({
  desktopAutoUpdateActive: vi.fn(),
}));

describe("BetaUpdateNotice Component", () => {
  const mockDownload = {
    label: "macOS DMG",
    platform: "darwin",
    arch: "x64",
    url: "http://example.com/update.dmg",
    signature: "signature",
    sha256: "sha256",
    size: 12345,
  };

  const mockManifest = {
    version: "0.5.0",
    title: "Shelf Beta 0.5.0",
    summary: "New stuff",
    changes: ["Change A", "Change B"],
    signatures: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(desktopAutoUpdateActive).mockReturnValue(false);
    
    // Clear localStorage
    window.localStorage.clear();

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
    vi.useRealTimers();
    cleanup();
  });

  it("renders nothing when auto-update is active", async () => {
    vi.mocked(desktopAutoUpdateActive).mockReturnValue(true);
    const { container } = render(<BetaUpdateNotice />);
    
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing initially, checks for update after delay, and renders notice", async () => {
    vi.mocked(checkForBetaUpdate).mockResolvedValue({
      status: "available",
      manifest: mockManifest,
      download: mockDownload,
    });

    const { container } = render(<BetaUpdateNotice />);
    expect(container.firstChild).toBeNull();

    // Fast-forward delay
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    // Flush microtasks for the checkForBetaUpdate promise
    await act(async () => {});

    expect(checkForBetaUpdate).toHaveBeenCalled();
    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(screen.getByText("Shelf Beta 0.5.0")).toBeInTheDocument();
    expect(screen.getByText("New stuff")).toBeInTheDocument();
    expect(screen.getByText("Change A")).toBeInTheDocument();
  });

  it("handles dismissal by updating state and saving to localStorage", async () => {
    vi.mocked(checkForBetaUpdate).mockResolvedValue({
      status: "available",
      manifest: mockManifest,
      download: mockDownload,
    });

    render(<BetaUpdateNotice />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {});

    expect(screen.getByText("Update available")).toBeInTheDocument();

    const dismissBtn = screen.getByRole("button", { name: "Dismiss update" });
    fireEvent.click(dismissBtn);

    expect(screen.queryByText("Update available")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("dismissed-update-0.5.0")).toBe("1");
  });

  it("triggers download and shows success when download button is clicked", async () => {
    vi.mocked(checkForBetaUpdate).mockResolvedValue({
      status: "available",
      manifest: mockManifest,
      download: mockDownload,
    });
    vi.mocked(downloadVerifiedUpdate).mockResolvedValue(undefined);

    render(<BetaUpdateNotice />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {});

    expect(screen.getByText("Update available")).toBeInTheDocument();

    const downloadBtn = screen.getByRole("button", { name: "Download 0.5.0" });
    
    // Trigger download
    await act(async () => {
      fireEvent.click(downloadBtn);
    });

    expect(downloadVerifiedUpdate).toHaveBeenCalledWith(mockDownload);
    expect(mockShowSuccess).toHaveBeenCalledWith("notice.updateDownloaded");
  });

  it("displays Homebrew options when on macOS", async () => {
    // Mock navigator.platform to return 'MacIntel'
    Object.defineProperty(navigator, "platform", {
      value: "MacIntel",
      writable: true,
      configurable: true,
    });

    vi.mocked(checkForBetaUpdate).mockResolvedValue({
      status: "available",
      manifest: mockManifest,
      download: mockDownload,
    });

    render(<BetaUpdateNotice />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {});

    expect(screen.getByText("macOS users can use Homebrew instead.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Homebrew command" })).toBeInTheDocument();

    const copyBtn = screen.getByRole("button", { name: "Copy Homebrew command" });
    
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "brew tap marcoodignoti/shelf\nbrew upgrade --cask shelf-beta || brew install --cask shelf-beta"
    );
    expect(screen.getByText("Copied Homebrew command")).toBeInTheDocument();
  });
});
