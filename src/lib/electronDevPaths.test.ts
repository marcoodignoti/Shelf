import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { defaultDevUserDataDir, electronDevEnv } = require("../../scripts/electron-dev-paths.cjs");

describe("electron dev paths", () => {
  it("uses a project-local user data directory by default", () => {
    const root = path.resolve("/tmp/shelf-checkout");

    expect(defaultDevUserDataDir(root)).toBe(path.join(root, ".shelf-dev", "user-data"));
  });

  it("keeps explicit user data overrides for one-off debugging", () => {
    const root = path.resolve("/tmp/shelf-checkout");
    const override = path.resolve("/tmp/custom-shelf-data");

    expect(electronDevEnv({ SHELF_USER_DATA_DIR: override }, root, "http://127.0.0.1:1420")).toMatchObject({
      ELECTRON_RENDERER_URL: "http://127.0.0.1:1420",
      SHELF_USER_DATA_DIR: override,
    });
  });
});
