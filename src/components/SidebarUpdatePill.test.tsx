// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SidebarUpdatePill } from "./SidebarUpdatePill";
import { checkForBetaUpdate, startVerifiedUpdateDownload } from "../lib/betaUpdates";
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
  startVerifiedUpdateDownload: vi.fn(),
}));

vi.mock("../lib/desktop", () => ({
  desktopAutoUpdateActive: vi.fn(),
}));

describe("SidebarUpdatePill Component", () => {
  const mockDownload = {
    label: "macOS DMG",
    platform: "darwin",
    arch: "arm64",
    url: "https://example.com/update.dmg",
    sha256: "sha256",
    size: "12 MB",
    downloadToken: "token",
  };

  const mockManifest = {
    version: "0.5.0",
    channel: "beta" as const,
    publishedAt: "2024-01-01",
    title: "Shelf Beta 0.5.0",
    summary: "New stuff",
    changes: ["Change A", "Change B"],
    downloads: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(desktopAutoUpdateActive).mockReturnValue(false);

    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("renders nothing when auto-update is active", async () => {
    vi.mocked(desktopAutoUpdateActive).mockReturnValue(true);
    const { container } = render(<SidebarUpdatePill />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(container.firstChild).toBeNull();
  });

  it("renders the update pill after the check delay when an update is available", async () => {
    vi.mocked(checkForBetaUpdate).mockResolvedValue({
      status: "available",
      manifest: mockManifest,
      download: mockDownload,
    });

    const { container } = render(<SidebarUpdatePill />);
    expect(container.firstChild).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    await act(async () => {});

    expect(checkForBetaUpdate).toHaveBeenCalled();
    // The available pill accessible name is the inner "Update" text.
    const pill = screen.getByRole("button", { name: "Update" });
    expect(within(pill).getByText("Update")).toBeInTheDocument();
  });

  it("starts the download and shows the ready pill on success", async () => {
    vi.mocked(checkForBetaUpdate).mockResolvedValue({
      status: "available",
      manifest: mockManifest,
      download: mockDownload,
    });
    vi.mocked(startVerifiedUpdateDownload).mockReturnValue({
      promise: Promise.resolve({ path: "/tmp/Shelf.dmg", bytes: 1, sha256: "sha256" }),
      cancel: vi.fn(),
    });

    render(<SidebarUpdatePill />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {});

    const updateBtn = screen.getByRole("button", { name: "Update" });

    await act(async () => {
      fireEvent.click(updateBtn);
    });

    expect(startVerifiedUpdateDownload).toHaveBeenCalledWith(mockDownload, expect.any(Function));
    expect(mockShowSuccess).toHaveBeenCalledWith("notice.updateDownloaded");
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("clicking the progress bar cancels the active download", async () => {
    const cancelSpy = vi.fn();
    let resolveDownload: (value: { path: string; bytes: number; sha256: string }) => void = () => {};
    vi.mocked(checkForBetaUpdate).mockResolvedValue({
      status: "available",
      manifest: mockManifest,
      download: mockDownload,
    });
    vi.mocked(startVerifiedUpdateDownload).mockReturnValue({
      promise: new Promise((resolve) => {
        resolveDownload = resolve;
      }),
      cancel: cancelSpy,
    });

    render(<SidebarUpdatePill />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update" }));
    });

    // While downloading, the progress bar is clickable with the cancel label.
    const bar = screen.getByRole("progressbar", { name: "Cancel download" });
    fireEvent.click(bar);

    expect(cancelSpy).toHaveBeenCalled();

    // Resolve the pending download promise so the test can clean up.
    await act(async () => {
      resolveDownload({ path: "/tmp/Shelf.dmg", bytes: 1, sha256: "sha256" });
    });
  });

  it("download error falls back to the available pill and shows the error", async () => {
    let rejectDownload: (error: Error) => void = () => {};
    vi.mocked(checkForBetaUpdate).mockResolvedValue({
      status: "available",
      manifest: mockManifest,
      download: mockDownload,
    });
    vi.mocked(startVerifiedUpdateDownload).mockReturnValue({
      promise: new Promise((_, reject) => {
        rejectDownload = reject;
      }),
      cancel: vi.fn(),
    });

    render(<SidebarUpdatePill />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {});

    const updateBtn = screen.getByRole("button", { name: "Update" });

    await act(async () => {
      fireEvent.click(updateBtn);
    });

    await act(async () => {
      rejectDownload(new Error("network failure"));
    });

    expect(mockShowError).toHaveBeenCalledWith(expect.any(Error));
    // Pill reverts to the available phase.
    expect(screen.getByRole("button", { name: "Update" })).toBeInTheDocument();
  });

  it("expired download token re-fetches and retries the download", async () => {
    let rejectDownload: (error: Error) => void = () => {};
    vi.mocked(checkForBetaUpdate)
      .mockResolvedValueOnce({
        status: "available",
        manifest: mockManifest,
        download: mockDownload,
      })
      .mockResolvedValueOnce({
        status: "available",
        manifest: mockManifest,
        download: mockDownload,
      });
    vi.mocked(startVerifiedUpdateDownload)
      .mockReturnValueOnce({
        promise: new Promise((_, reject) => {
          rejectDownload = reject;
        }),
        cancel: vi.fn(),
      })
      .mockReturnValueOnce({
        promise: Promise.resolve({ path: "/tmp/Shelf.dmg", bytes: 1, sha256: "sha256" }),
        cancel: vi.fn(),
      });

    render(<SidebarUpdatePill />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {});

    const updateBtn = screen.getByRole("button", { name: "Update" });

    await act(async () => {
      fireEvent.click(updateBtn);
    });

    // Reject the first download with an expired-token error; the component
    // re-fetches and retries automatically.
    await act(async () => {
      rejectDownload(
        new Error("update download is not linked to a verified manifest")
      );
    });

    expect(startVerifiedUpdateDownload).toHaveBeenCalledTimes(2);
    expect(mockShowSuccess).toHaveBeenCalledWith("notice.updateDownloaded");
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });


  it("clicking the done pill toggles the install hint", async () => {
    vi.mocked(checkForBetaUpdate).mockResolvedValue({
      status: "available",
      manifest: mockManifest,
      download: mockDownload,
    });
    vi.mocked(startVerifiedUpdateDownload).mockReturnValue({
      promise: Promise.resolve({ path: "/tmp/Shelf.dmg", bytes: 1, sha256: "sha256" }),
      cancel: vi.fn(),
    });

    render(<SidebarUpdatePill />);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update" }));
    });

    const doneBtn = screen.getByRole("button", { name: "Ready" });

    // No hint visible initially after download completes.
    expect(screen.queryByText("Close Shelf, install the downloaded build, then reopen it.")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(doneBtn);
    });

    expect(screen.getByText("Close Shelf, install the downloaded build, then reopen it.")).toBeInTheDocument();
  });
});
