// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProfileSection } from "./ProfileSection";

const mockUpdateProfileAction = vi.fn();
const mockImportProfileAvatarAction = vi.fn();

vi.mock("../../store/useAppStore", () => ({
  useAppStore: vi.fn((selector) =>
    selector({
      profile: {
        name: "John Doe",
        workspaceName: "My Workspace",
        avatarPath: "/path/to/avatar.png",
      },
      updateProfileAction: mockUpdateProfileAction,
      importProfileAvatarAction: mockImportProfileAvatarAction,
    })
  ),
}));

describe("ProfileSection Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders profile fields with default values", () => {
    render(<ProfileSection />);

    expect(screen.getByRole("heading", { name: /Profile/i })).toBeInTheDocument();

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(nameInput.value).toBe("John Doe");

    const workspaceInput = screen.getByLabelText("Workspace name") as HTMLInputElement;
    expect(workspaceInput).toBeInTheDocument();
    expect(workspaceInput.value).toBe("My Workspace");
  });

  it("triggers updateProfileAction when input blur occurs", () => {
    render(<ProfileSection />);

    const nameInput = screen.getByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "Jane Doe" } });
    fireEvent.blur(nameInput);
    expect(mockUpdateProfileAction).toHaveBeenCalledWith({ name: "Jane Doe" });

    const workspaceInput = screen.getByLabelText("Workspace name");
    fireEvent.change(workspaceInput, { target: { value: "New Workspace" } });
    fireEvent.blur(workspaceInput);
    expect(mockUpdateProfileAction).toHaveBeenCalledWith({ workspaceName: "New Workspace" });
  });

  it("triggers upload and remove avatar actions", () => {
    render(<ProfileSection />);

    const uploadButton = screen.getByRole("button", { name: /Upload/i });
    fireEvent.click(uploadButton);
    expect(mockImportProfileAvatarAction).toHaveBeenCalled();

    const removeButton = screen.getByRole("button", { name: /Remove/i });
    fireEvent.click(removeButton);
    expect(mockUpdateProfileAction).toHaveBeenCalledWith({ avatarPath: null });
  });
});
