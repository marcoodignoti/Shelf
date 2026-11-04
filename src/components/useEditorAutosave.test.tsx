// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updatePage } from "../lib/db";
import { readPendingPageUpdates, writePendingPageUpdates } from "../lib/pendingPageSaves";
import { useEditorAutosave } from "./useEditorAutosave";

vi.mock("../lib/db", () => ({ updatePage: vi.fn() }));

type FakeEditor = { document: unknown[] };
type UseEditorAutosaveResult = ReturnType<typeof useEditorAutosave>;

let latest: UseEditorAutosaveResult | null = null;
let editor: FakeEditor;
const updatePageOptimistically = vi.fn();

function Harness() {
  latest = useEditorAutosave({
    pageId: "page-1",
    editor: editor as never,
    updatePageOptimistically,
  });
  return null;
}

async function settleAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("useEditorAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(updatePage).mockReset();
    vi.mocked(updatePage).mockResolvedValue(undefined);
    updatePageOptimistically.mockReset();
    editor = { document: [] };
    latest = null;
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("keeps failed updates and retries them with backoff", async () => {
    vi.mocked(updatePage)
      .mockRejectedValueOnce(new Error("database offline"))
      .mockResolvedValueOnce(undefined);
    render(<Harness />);

    await act(async () => {
      latest?.queueSave({ title: "Offline title" });
      vi.advanceTimersByTime(300);
      await settleAsyncWork();
    });

    expect(updatePage).toHaveBeenCalledTimes(1);
    expect(readPendingPageUpdates("page-1")).toEqual({ title: "Offline title" });
    expect(latest?.saveState.status).toBe("error");

    await act(async () => {
      vi.advanceTimersByTime(500);
      await settleAsyncWork();
    });

    expect(updatePage).toHaveBeenCalledTimes(2);
    expect(updatePage).toHaveBeenLastCalledWith("page-1", { title: "Offline title" });
    expect(readPendingPageUpdates("page-1")).toBeNull();
    expect(latest?.saveState.status).toBe("saved");
  });

  it("restores a persisted queue after reload and marks it optimistic", async () => {
    writePendingPageUpdates("page-1", { title: "Recovered title" });
    render(<Harness />);

    expect(updatePageOptimistically).toHaveBeenCalledWith("page-1", { title: "Recovered title" });

    await act(async () => {
      vi.advanceTimersByTime(300);
      await settleAsyncWork();
    });

    expect(updatePage).toHaveBeenCalledWith("page-1", { title: "Recovered title" });
    expect(readPendingPageUpdates("page-1")).toBeNull();
  });

  it("does not lose edits queued while an older write is in flight", async () => {
    let resolveFirstWrite!: () => void;
    vi.mocked(updatePage).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveFirstWrite = resolve; }),
    );
    render(<Harness />);

    await act(async () => {
      latest?.queueSave({ title: "First" });
      vi.advanceTimersByTime(300);
      await settleAsyncWork();
    });
    expect(updatePage).toHaveBeenCalledTimes(1);

    act(() => {
      latest?.queueSave({ icon: "📌" });
    });
    expect(readPendingPageUpdates("page-1")).toEqual({ title: "First", icon: "📌" });

    await act(async () => {
      resolveFirstWrite();
      await settleAsyncWork();
      vi.advanceTimersByTime(300);
      await settleAsyncWork();
    });

    expect(updatePage).toHaveBeenCalledTimes(2);
    expect(updatePage).toHaveBeenLastCalledWith("page-1", { icon: "📌" });
  });

  it("flushSaveNow waits for an in-flight write and reports a failed flush", async () => {
    let resolveWrite!: () => void;
    vi.mocked(updatePage).mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveWrite = resolve; }),
    );
    render(<Harness />);

    await act(async () => {
      latest?.queueSave({ title: "Pending" });
      vi.advanceTimersByTime(300);
      await settleAsyncWork();
    });
    const flush = latest?.flushSaveNow();
    expect(updatePage).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveWrite();
      await settleAsyncWork();
    });
    await expect(flush).resolves.toBe(true);

    vi.mocked(updatePage).mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      latest?.queueSave({ icon: "❌" });
    });
    await expect(latest?.flushSaveNow()).resolves.toBe(false);
    expect(readPendingPageUpdates("page-1")).toEqual({ icon: "❌" });
  });

  it("flushes pending edits to the backend on unmount and clears the local record", async () => {
    const { unmount } = render(<Harness />);

    act(() => {
      latest?.queueSave({ title: "Leaving page" });
    });
    expect(updatePage).not.toHaveBeenCalled();

    await act(async () => {
      unmount();
      await settleAsyncWork();
    });

    expect(updatePage).toHaveBeenCalledWith("page-1", { title: "Leaving page" });
    expect(readPendingPageUpdates("page-1")).toBeNull();
  });

  it("keeps the local record when the unmount flush fails", async () => {
    vi.mocked(updatePage).mockRejectedValueOnce(new Error("offline"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<Harness />);

    act(() => {
      latest?.queueSave({ title: "Unsent" });
    });
    await act(async () => {
      unmount();
      await settleAsyncWork();
    });

    expect(updatePage).toHaveBeenCalledTimes(1);
    expect(readPendingPageUpdates("page-1")).toEqual({ title: "Unsent" });
    errorSpy.mockRestore();
  });

  it("persists content and blocks reload while edits are pending", () => {
    editor.document = [{ type: "paragraph", content: [{ type: "text", text: "Draft" }] }];
    render(<Harness />);

    act(() => {
      latest?.queueContentSave();
    });

    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);

    const persisted = readPendingPageUpdates("page-1");
    expect(event.defaultPrevented).toBe(true);
    expect(persisted?.content).toContain("Draft");
    expect(typeof persisted?.search_text).toBe("string");
  });
});
