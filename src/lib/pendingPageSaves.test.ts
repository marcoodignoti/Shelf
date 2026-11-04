// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingPageUpdates,
  pendingPageSaveStorageKey,
  readPendingPageUpdates,
  writePendingPageUpdates,
} from "./pendingPageSaves";

describe("pending page save storage", () => {
  afterEach(() => window.localStorage.clear());

  it("round-trips a queued update under a page-scoped key", () => {
    const updates = { title: "Offline title", content: "[]" };

    writePendingPageUpdates("page-1", updates);

    expect(window.localStorage.getItem(pendingPageSaveStorageKey("page-1"))).toContain("Offline title");
    expect(readPendingPageUpdates("page-1")).toEqual(updates);
    expect(readPendingPageUpdates("page-2")).toBeNull();
  });

  it("clears an empty queue", () => {
    writePendingPageUpdates("page-1", { title: "queued" });
    writePendingPageUpdates("page-1", {});

    expect(readPendingPageUpdates("page-1")).toBeNull();
  });

  it("ignores malformed records", () => {
    window.localStorage.setItem(pendingPageSaveStorageKey("page-1"), "not-json");

    expect(readPendingPageUpdates("page-1")).toBeNull();
    expect(window.localStorage.getItem(pendingPageSaveStorageKey("page-1"))).toBeNull();
  });

  it("supports explicit cleanup", () => {
    writePendingPageUpdates("page-1", { icon: "📌" });
    clearPendingPageUpdates("page-1");

    expect(readPendingPageUpdates("page-1")).toBeNull();
  });
});
