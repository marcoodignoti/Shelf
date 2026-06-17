// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DesktopUpdateRestartNotice } from "./DesktopUpdateRestartNotice";
import { installDesktopUpdateNow } from "../lib/desktop";

const mockShowError = vi.fn();

vi.mock("../store/useAppStore", () => ({
  useAppStore: vi.fn((selector) =>
    selector({
      showError: mockShowError,
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

vi.mock("../lib/desktop", () => ({
  installDesktopUpdateNow: vi.fn(),
}));

describe("DesktopUpdateRestartNotice Component", () => {
  const mockOnDismiss = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders restart notice with provided version", () => {
    render(<DesktopUpdateRestartNotice version="0.4.5" onDismiss={mockOnDismiss} />);

    expect(screen.getByText("Update ready")).toBeInTheDocument();
    expect(screen.getByText("Shelf 0.4.5 is ready to install")).toBeInTheDocument();
    expect(
      screen.getByText("Restart now to finish updating, or keep working and it installs when you quit.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart to update" })).toBeInTheDocument();
  });

  it("renders restart notice without version label gracefully", () => {
    render(<DesktopUpdateRestartNotice version={null} onDismiss={mockOnDismiss} />);

    expect(screen.getByText("Shelf is ready to install")).toBeInTheDocument();
  });

  it("triggers onDismiss when close button is clicked", () => {
    render(<DesktopUpdateRestartNotice version="0.4.5" onDismiss={mockOnDismiss} />);

    const closeBtn = screen.getByRole("button", { name: "Dismiss update notice" });
    fireEvent.click(closeBtn);

    expect(mockOnDismiss).toHaveBeenCalledTimes(1);
  });

  it("triggers installDesktopUpdateNow when restart button is clicked", async () => {
    vi.mocked(installDesktopUpdateNow).mockResolvedValue(undefined);

    render(<DesktopUpdateRestartNotice version="0.4.5" onDismiss={mockOnDismiss} />);

    const restartBtn = screen.getByRole("button", { name: "Restart to update" });
    fireEvent.click(restartBtn);

    expect(restartBtn).toBeDisabled();
    expect(screen.getByText("Restarting")).toBeInTheDocument();

    await waitFor(() => {
      expect(installDesktopUpdateNow).toHaveBeenCalledTimes(1);
    });
  });

  it("handles errors during update installation by showing error", async () => {
    const testError = new Error("Disk Full");
    vi.mocked(installDesktopUpdateNow).mockRejectedValue(testError);

    render(<DesktopUpdateRestartNotice version="0.4.5" onDismiss={mockOnDismiss} />);

    const restartBtn = screen.getByRole("button", { name: "Restart to update" });
    fireEvent.click(restartBtn);

    await waitFor(() => {
      expect(mockShowError).toHaveBeenCalledWith(testError);
      expect(restartBtn).not.toBeDisabled();
      expect(screen.getByText("Restart to update")).toBeInTheDocument();
    });
  });
});
