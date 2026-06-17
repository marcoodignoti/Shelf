// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DataSection } from "./DataSection";
import { exportWorkspaceBackupWithDialog, importWorkspaceBackupWithDialog } from "../../lib/backup";

const mockFetchPages = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();

vi.mock("../../store/useAppStore", () => ({
  useAppStore: vi.fn(() => ({
    fetchPages: mockFetchPages,
    showSuccess: mockShowSuccess,
    showError: mockShowError,
  })),
}));

vi.mock("../../store/useUIStore", () => ({
  useUIStore: vi.fn((selector) =>
    selector({
      localePreference: "en",
    })
  ),
}));

vi.mock("../../lib/backup", () => ({
  exportWorkspaceBackupWithDialog: vi.fn(),
  importWorkspaceBackupWithDialog: vi.fn(),
}));

describe("DataSection Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders backup export and import controls", () => {
    render(<DataSection />);

    expect(screen.getByRole("heading", { name: /Import \/ Export/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import/i })).toBeInTheDocument();
  });

  it("triggers export with success feedback", async () => {
    vi.mocked(exportWorkspaceBackupWithDialog).mockResolvedValue(5); // mock exported 5 pages
    render(<DataSection />);

    const exportButton = screen.getByRole("button", { name: /Export/i });
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(exportWorkspaceBackupWithDialog).toHaveBeenCalled();
      expect(mockShowSuccess).toHaveBeenCalledWith("settings.data.exported", { count: "5" });
      expect(screen.getByText("Exported 5 pages.")).toBeInTheDocument();
    });
  });

  it("triggers import, fetches pages, and shows success feedback", async () => {
    vi.mocked(importWorkspaceBackupWithDialog).mockResolvedValue(10); // mock imported 10 pages
    render(<DataSection />);

    const importButton = screen.getByRole("button", { name: /Import/i });
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(importWorkspaceBackupWithDialog).toHaveBeenCalled();
      expect(mockFetchPages).toHaveBeenCalled();
      expect(mockShowSuccess).toHaveBeenCalledWith("settings.data.imported", { count: "10" });
      expect(screen.getByText("Imported 10 pages as duplicates.")).toBeInTheDocument();
    });
  });
});
