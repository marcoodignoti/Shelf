import { describe, expect, it } from "vitest";
import {
  DESKTOP_COMMAND_NAMES,
  isDesktopCommandName,
  type DesktopCommandName,
} from "./desktopCommands";

describe("desktop command contract", () => {
  it("lists renderer invoke commands once", () => {
    expect(new Set(DESKTOP_COMMAND_NAMES).size).toBe(DESKTOP_COMMAND_NAMES.length);
    expect(DESKTOP_COMMAND_NAMES).toContain("list_pages" satisfies DesktopCommandName);
    expect(DESKTOP_COMMAND_NAMES).toContain("list_studio_documents" satisfies DesktopCommandName);
    expect(DESKTOP_COMMAND_NAMES).toContain("fetch_update_manifest" satisfies DesktopCommandName);
  });

  it("recognizes only declared desktop commands", () => {
    expect(isDesktopCommandName("create_page")).toBe(true);
    expect(isDesktopCommandName("missing_command")).toBe(false);
  });
});
