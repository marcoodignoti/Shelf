// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SettingsModal } from "./SettingsModal";

// Mock sub-sections to isolate SettingsModal testing
vi.mock("./settings/ProfileSection", () => ({ ProfileSection: () => <div>Profile Section Content</div> }));
vi.mock("./settings/PreferencesSection", () => ({ PreferencesSection: () => <div>Preferences Section Content</div> }));
vi.mock("./settings/AppearanceSection", () => ({ AppearanceSection: () => <div>Appearance Section Content</div> }));
vi.mock("./settings/ShortcutsSection", () => ({ ShortcutsSection: () => <div>Shortcuts Section Content</div> }));
vi.mock("./settings/UpdatesSection", () => ({ UpdatesSection: () => <div>Updates Section Content</div> }));
vi.mock("./settings/DataSection", () => ({ DataSection: () => <div>Data Section Content</div> }));
vi.mock("./settings/AboutSection", () => ({ AboutSection: () => <div>About Section Content</div> }));

let mockProfileValue: any = {
  name: "John Doe",
  workspaceName: "My Workspace",
  avatarPath: "/path/to/avatar.png",
};

vi.mock("../store/useAppStore", () => {
  return {
    useAppStore: vi.fn((selector) => {
      const storeState = {
        profile: mockProfileValue,
      };
      if (selector) return selector(storeState);
      return storeState;
    }),
  };
});

vi.mock("../store/useUIStore", () => ({
  useUIStore: vi.fn((selector) =>
    selector({
      localePreference: "en",
    })
  ),
}));

vi.mock("../lib/desktop", () => ({
  fileSrc: vi.fn((path) => `safe-file-protocol://${path}`),
}));

describe("SettingsModal Component", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileValue = {
      name: "John Doe",
      workspaceName: "My Workspace",
      avatarPath: "/path/to/avatar.png",
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(<SettingsModal isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders settings navigation, search, back action, and active section content when open", () => {
    render(<SettingsModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByRole("button", { name: "Back to app" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search settings...")).toBeInTheDocument();
    const navigation = within(screen.getByRole("navigation", { name: "Settings sections" }));

    // Nav sections
    expect(navigation.getByText("Profile")).toBeInTheDocument();
    expect(navigation.getByText("General")).toBeInTheDocument();
    expect(navigation.getByText("Appearance")).toBeInTheDocument();
    expect(navigation.getByText("Shortcuts")).toBeInTheDocument();
    expect(navigation.getByText("Updates")).toBeInTheDocument();
    expect(navigation.getByText("Import / Export")).toBeInTheDocument();
    expect(navigation.getByText("About")).toBeInTheDocument();

    // Default active section (Profile) content is shown
    expect(screen.getByText("Profile Section Content")).toBeInTheDocument();
  });

  it("filters navigation from the settings search", () => {
    render(<SettingsModal isOpen={true} onClose={mockOnClose} />);

    fireEvent.change(screen.getByLabelText("Search settings..."), { target: { value: "Appearance" } });
    const navigation = within(screen.getByRole("navigation", { name: "Settings sections" }));

    expect(navigation.getByText("Appearance")).toBeInTheDocument();
    expect(navigation.queryByText("Profile")).not.toBeInTheDocument();
  });

  it("navigates between sections when nav buttons are clicked", () => {
    render(<SettingsModal isOpen={true} onClose={mockOnClose} />);

    // Switch to General / Preferences
    const preferencesBtn = screen.getByRole("button", { name: "General" });
    fireEvent.click(preferencesBtn);

    expect(screen.getByText("Preferences Section Content")).toBeInTheDocument();
    expect(screen.queryByText("Profile Section Content")).not.toBeInTheDocument();

    // Switch to About
    const aboutBtn = screen.getByRole("button", { name: "About" });
    fireEvent.click(aboutBtn);

    expect(screen.getByText("About Section Content")).toBeInTheDocument();
  });

  it("triggers onClose when close button is clicked", () => {
    render(<SettingsModal isOpen={true} onClose={mockOnClose} />);

    const closeBtn = screen.getByRole("button", { name: "Close settings" });
    fireEvent.click(closeBtn);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
