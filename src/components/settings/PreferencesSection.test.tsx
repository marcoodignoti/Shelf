// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PreferencesSection } from "./PreferencesSection";

const mockSetLocalePreference = vi.fn();
const mockSetTitleEnterBehavior = vi.fn();
const mockSetPageWidth = vi.fn();

vi.mock("../../store/useUIStore", () => ({
  useUIStore: vi.fn((selector) =>
    selector({
      localePreference: "en",
      setLocalePreference: mockSetLocalePreference,
      titleEnterBehavior: "body",
      setTitleEnterBehavior: mockSetTitleEnterBehavior,
      pageWidth: "centered",
      setPageWidth: mockSetPageWidth,
    })
  ),
}));

describe("PreferencesSection Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders preference selection controls with default values", () => {
    render(<PreferencesSection />);

    expect(screen.getByRole("heading", { name: /Preferences/i })).toBeInTheDocument();

    const languageSelect = screen.getByLabelText("Language") as HTMLSelectElement;
    expect(languageSelect).toBeInTheDocument();
    expect(languageSelect.value).toBe("en");

    const titleEnterSelect = screen.getByLabelText("Enter in page titles") as HTMLSelectElement;
    expect(titleEnterSelect).toBeInTheDocument();
    expect(titleEnterSelect.value).toBe("body");

    const pageWidthSelect = screen.getByLabelText("Page width") as HTMLSelectElement;
    expect(pageWidthSelect).toBeInTheDocument();
    expect(pageWidthSelect.value).toBe("centered");
  });

  it("triggers store setters when option changes are selected", () => {
    render(<PreferencesSection />);

    const languageSelect = screen.getByLabelText("Language");
    fireEvent.change(languageSelect, { target: { value: "it" } });
    expect(mockSetLocalePreference).toHaveBeenCalledWith("it");

    const titleEnterSelect = screen.getByLabelText("Enter in page titles");
    fireEvent.change(titleEnterSelect, { target: { value: "newline" } });
    expect(mockSetTitleEnterBehavior).toHaveBeenCalledWith("newline");

    const pageWidthSelect = screen.getByLabelText("Page width");
    fireEvent.change(pageWidthSelect, { target: { value: "full" } });
    expect(mockSetPageWidth).toHaveBeenCalledWith("full");
  });
});
