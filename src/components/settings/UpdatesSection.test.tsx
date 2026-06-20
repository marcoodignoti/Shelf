// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { UpdatesSection } from "./UpdatesSection";
import { checkForBetaUpdate, startVerifiedUpdateDownload } from "../../lib/betaUpdates";

const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();
const mockShowErrorKey = vi.fn();

vi.mock("../../store/useAppStore", () => ({
  useAppStore: vi.fn(() => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
    showErrorKey: mockShowErrorKey,
  })),
}));

vi.mock("../../store/useUIStore", () => ({
  useUIStore: vi.fn((selector) =>
    selector({
      localePreference: "en",
    })
  ),
}));

vi.mock("../../lib/betaUpdates", () => ({
  checkForBetaUpdate: vi.fn(),
  startVerifiedUpdateDownload: vi.fn(),
  CURRENT_APP_VERSION: "0.4.1",
}));

describe("UpdatesSection Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders updates info with default versions and check button", () => {
    render(<UpdatesSection />);

    expect(screen.getByRole("heading", { name: /Updates/i })).toBeInTheDocument();
    expect(screen.getByText("0.4.1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check" })).toBeInTheDocument();
  });

  it("updates state to up-to-date and shows success", async () => {
    vi.mocked(checkForBetaUpdate).mockResolvedValue({ status: "current" });

    render(<UpdatesSection />);

    const checkButton = screen.getByRole("button", { name: "Check" });
    fireEvent.click(checkButton);

    await waitFor(() => {
      expect(checkForBetaUpdate).toHaveBeenCalled();
      expect(mockShowSuccess).toHaveBeenCalledWith("settings.updates.upToDate");
      expect(screen.getByText("Shelf is up to date.")).toBeInTheDocument();
    });
  });

  it("updates state to available and displays manifest, letting user trigger download", async () => {
    const mockDownload = {
      label: "macOS DMG",
      platform: "darwin",
      arch: "x64",
      url: "http://example.com/update.dmg",
      signature: "signature",
      sha256: "sha256",
      size: 12345,
    };
    vi.mocked(checkForBetaUpdate).mockResolvedValue({
      status: "available",
      manifest: {
        version: "0.5.0",
        title: "Shelf Beta 0.5.0",
        summary: "Important new release",
        changes: ["Added formulas", "Added PDFs"],
        signatures: {},
      },
      download: mockDownload,
    });
    vi.mocked(startVerifiedUpdateDownload).mockReturnValue({
      promise: Promise.resolve({ path: "/tmp/Shelf.dmg", bytes: 1, sha256: "sha256" }),
      cancel: vi.fn(),
    });

    render(<UpdatesSection />);

    const checkButton = screen.getByRole("button", { name: "Check" });
    fireEvent.click(checkButton);

    // Verify update info is rendered
    await waitFor(() => {
      expect(screen.getByText("Shelf Beta 0.5.0")).toBeInTheDocument();
      expect(screen.getByText("0.5.0")).toBeInTheDocument();
      expect(screen.getByText("Important new release")).toBeInTheDocument();
      expect(screen.getByText("Added formulas")).toBeInTheDocument();
    });

    // Click download button
    const downloadButton = screen.getByRole("button", { name: /Download macOS DMG/i });
    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(startVerifiedUpdateDownload).toHaveBeenCalledWith(mockDownload, expect.any(Function));
      expect(mockShowSuccess).toHaveBeenCalledWith("settings.updates.downloaded");
    });
  });

  it("handles update checking error state", async () => {
    vi.mocked(checkForBetaUpdate).mockResolvedValue({
      status: "error",
      message: "Network Timeout",
    });

    render(<UpdatesSection />);

    const checkButton = screen.getByRole("button", { name: "Check" });
    fireEvent.click(checkButton);

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith("Network Timeout");
      expect(screen.getByText(/Update check failed: Network Timeout/i)).toBeInTheDocument();
    });
  });
});
