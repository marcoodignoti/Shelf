// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AppearanceSection } from "./AppearanceSection";

const mockSetTheme = vi.fn();
const mockSetEditorFont = vi.fn();
const mockSetEditorFontSize = vi.fn();

vi.mock("../../store/useUIStore", () => ({
  useUIStore: vi.fn((selector) =>
    selector({
      theme: "system",
      setTheme: mockSetTheme,
      editorFont: "sans",
      setEditorFont: mockSetEditorFont,
      editorFontSize: "default",
      setEditorFontSize: mockSetEditorFontSize,
    })
  ),
}));

describe("AppearanceSection Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders appearance selects with default values", () => {
    render(<AppearanceSection />);

    expect(screen.getByRole("heading", { name: /Appearance/i })).toBeInTheDocument();

    const themeSelect = screen.getByLabelText("Theme") as HTMLSelectElement;
    expect(themeSelect).toBeInTheDocument();
    expect(themeSelect.value).toBe("system");

    const fontSelect = screen.getByLabelText("Font") as HTMLSelectElement;
    expect(fontSelect).toBeInTheDocument();
    expect(fontSelect.value).toBe("sans");

    const fontSizeSelect = screen.getByLabelText("Text size") as HTMLSelectElement;
    expect(fontSizeSelect).toBeInTheDocument();
    expect(fontSizeSelect.value).toBe("default");
  });

  it("triggers store setters when option changes are selected", () => {
    render(<AppearanceSection />);

    const themeSelect = screen.getByLabelText("Theme");
    fireEvent.change(themeSelect, { target: { value: "dark" } });
    expect(mockSetTheme).toHaveBeenCalledWith("dark");

    const fontSelect = screen.getByLabelText("Font");
    fireEvent.change(fontSelect, { target: { value: "serif" } });
    expect(mockSetEditorFont).toHaveBeenCalledWith("serif");

    const fontSizeSelect = screen.getByLabelText("Text size");
    fireEvent.change(fontSizeSelect, { target: { value: "large" } });
    expect(mockSetEditorFontSize).toHaveBeenCalledWith("large");
  });
});
