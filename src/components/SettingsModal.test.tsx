// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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

  it("renders side navigation, account card, and active section content when open", () => {
    const { container } = render(<SettingsModal isOpen={true} onClose={mockOnClose} />);

    // Account card info
    expect(screen.getByText("My Workspace")).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    
    // Avatar image is rendered (queried via selector as it has alt="" for presentation)
    const img = document.body.querySelector(".on-settings-avatar-img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "safe-file-protocol:///path/to/avatar.png");

    // Nav sections
    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.getByText("Preferences")).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Updates")).toBeInTheDocument();
    expect(screen.getByText("Import / Export")).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();

    // Default active section (Profile) content is shown
    expect(screen.getByText("Profile Section Content")).toBeInTheDocument();
  });

  it("renders workspace initials when avatar is missing", () => {
    mockProfileValue = { name: "", workspaceName: "A Workspace", avatarPath: null };

    render(<SettingsModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("navigates between sections when nav buttons are clicked", () => {
    render(<SettingsModal isOpen={true} onClose={mockOnClose} />);

    // Switch to Preferences
    const preferencesBtn = screen.getByRole("button", { name: "Preferences" });
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
