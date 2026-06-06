# Editor Media Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make editor image/video insertion feel reliable: clear errors, drag-and-drop insertion, visible import progress, and cleaner media block presentation.

**Architecture:** Keep backend validation unchanged and add a small renderer-side media helper module that normalizes file kind detection, block creation, and user-facing media errors. `PageEditor` remains the integration point for slash menu, paste, upload, and drag/drop, while store notices provide feedback. CSS-only polish stays in `src/index.css`.

**Tech Stack:** React 19, TypeScript, BlockNote 0.51, Zustand app store notices, Playwright e2e, Vitest.

---

## File Structure

- Create `src/lib/editorMedia.ts`: shared editor-media helper functions and constants.
- Create `src/lib/editorMedia.test.ts`: unit tests for kind detection, block props, and error messages.
- Modify `src/components/PageEditor.tsx`: use shared helpers, call notices, add drag/drop/import state, and attach editor drag handlers.
- Modify `src/index.css`: media drop target, importing state, and compact media block styling.
- Modify `tests/e2e/persistence.e2e.ts`: mock media import commands and add coverage for error notice, drag/drop, and import state.

---

### Task 1: Media Error Toasts

**Files:**
- Create: `src/lib/editorMedia.ts`
- Create: `src/lib/editorMedia.test.ts`
- Modify: `src/components/PageEditor.tsx`
- Modify: `tests/e2e/persistence.e2e.ts`

- [ ] **Step 1: Write failing helper tests**

Add `src/lib/editorMedia.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  editorMediaKindForFile,
  editorMediaUserMessage,
  editorMediaBlockProps,
} from "./editorMedia";

describe("editor media helpers", () => {
  it("detects supported image and video files", () => {
    expect(editorMediaKindForFile(new File(["x"], "photo.png", { type: "image/png" }))).toBe("image");
    expect(editorMediaKindForFile(new File(["x"], "clip.mp4", { type: "video/mp4" }))).toBe("video");
  });

  it("rejects unsupported media files", () => {
    expect(editorMediaKindForFile(new File(["x"], "notes.txt", { type: "text/plain" }))).toBeNull();
  });

  it("maps backend media errors to direct user messages", () => {
    expect(editorMediaUserMessage(new Error("image must be 10 MB or smaller"))).toBe("Image must be 10 MB or smaller.");
    expect(editorMediaUserMessage(new Error("video must be 512 MB or smaller"))).toBe("Video must be 512 MB or smaller.");
    expect(editorMediaUserMessage(new Error("video must be MP4, M4V, MOV, or WebM"))).toBe("Video must be MP4, M4V, MOV, or WebM.");
    expect(editorMediaUserMessage(new Error("image must be PNG, JPG, WebP, or GIF"))).toBe("Image must be PNG, JPG, WebP, or GIF.");
    expect(editorMediaUserMessage(new Error("anything else"))).toBe("Could not import that media file.");
  });

  it("creates stable media block props", () => {
    expect(editorMediaBlockProps("image", "photo.png", "/asset/photo.png")).toEqual({
      type: "image",
      props: { name: "photo.png", url: "/asset/photo.png" },
    });
    expect(editorMediaBlockProps("video", "", "/asset/video.mp4")).toEqual({
      type: "video",
      props: { name: "Video", url: "/asset/video.mp4" },
    });
  });
});
```

- [ ] **Step 2: Run helper tests and verify fail**

Run:

```bash
npx vitest run src/lib/editorMedia.test.ts
```

Expected: fail because `src/lib/editorMedia.ts` does not exist.

- [ ] **Step 3: Add shared media helper**

Create `src/lib/editorMedia.ts`:

```ts
export type EditorMediaKind = "image" | "video";

export type EditorMediaBlock = {
  type: EditorMediaKind;
  props: {
    name: string;
    url: string;
  };
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm"]);

function extensionFromName(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function fileNameFromPath(filePath: string, fallback: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || fallback;
}

export function editorMediaKindForFile(file: File): EditorMediaKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";

  const extension = extensionFromName(file.name);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

export function editorMediaBlockProps(kind: EditorMediaKind, name: string, url: string): EditorMediaBlock {
  return {
    type: kind,
    props: {
      name: name || (kind === "video" ? "Video" : "Image"),
      url,
    },
  };
}

export function editorMediaUserMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (message.includes("image must be 10 MB or smaller")) return "Image must be 10 MB or smaller.";
  if (message.includes("video must be 512 MB or smaller")) return "Video must be 512 MB or smaller.";
  if (message.includes("video must be MP4, M4V, MOV, or WebM")) return "Video must be MP4, M4V, MOV, or WebM.";
  if (message.includes("image must be PNG, JPG, WebP, or GIF")) return "Image must be PNG, JPG, WebP, or GIF.";
  if (message.includes("content is not a supported image")) return "Image content is not supported.";
  if (message.includes("content is not a supported video")) return "Video content is not supported.";
  return "Could not import that media file.";
}
```

- [ ] **Step 4: Run helper tests and verify pass**

Run:

```bash
npx vitest run src/lib/editorMedia.test.ts
```

Expected: pass.

- [ ] **Step 5: Wire PageEditor error notices**

Modify imports in `src/components/PageEditor.tsx`:

```ts
import { editorMediaBlockProps, editorMediaKindForFile, editorMediaUserMessage, fileNameFromPath, type EditorMediaBlock, type EditorMediaKind } from "../lib/editorMedia";
```

Remove local `fileNameFromPath`. Add store selectors inside `PageEditor`:

```ts
const showError = useAppStore((state) => state.showError);
const showSuccess = useAppStore((state) => state.showSuccess);
```

Add shared insertion helper near `editorMediaSlashMenuItem`:

```ts
function insertEditorMediaBlocks(editor: BlockNoteEditor<any, any, any>, media: EditorMediaBlock[]) {
  const cursorBlock = editor.getTextCursorPosition().block;
  if (isEmptyEditorBlock(cursorBlock)) {
    editor.replaceBlocks([cursorBlock], media as never);
  } else {
    editor.insertBlocks(media as never, cursorBlock, "after");
  }
}
```

In slash menu `onItemClick`, wrap import:

```ts
try {
  const media = await Promise.all(
    paths.map(async (sourcePath) => {
      const importedPath = isVideo
        ? await importEditorVideoPath(sourcePath, pageId)
        : await importEditorImagePath(sourcePath, pageId);
      return editorMediaBlockProps(kind, fileNameFromPath(sourcePath, isVideo ? "Video" : "Image"), coverImageSrc(importedPath));
    })
  );
  insertEditorMediaBlocks(editor, media);
  showSuccess(`${media.length} media file${media.length === 1 ? "" : "s"} imported.`);
} catch (error) {
  showError(editorMediaUserMessage(error));
}
```

In `uploadFile`, replace unsupported error:

```ts
const kind = editorMediaKindForFile(file);
if (!kind) {
  throw new Error("Only image and video uploads are supported");
}
```

In paste import `.then`, add `.catch`:

```ts
}).catch((error) => {
  showError(editorMediaUserMessage(error));
});
```

- [ ] **Step 6: Add e2e mock support and notice test**

In `tests/e2e/persistence.e2e.ts`, inside mock `invoke`, add:

```ts
if (cmd === "import_editor_image") {
  if (args.fileName === "too-large.png") throw new Error("image must be 10 MB or smaller");
  return `/mock/editor-images/${String(args.fileName ?? "image.png")}`;
}

if (cmd === "import_editor_video") {
  if (args.fileName === "too-large.mp4") throw new Error("video must be 512 MB or smaller");
  return `/mock/editor-videos/${String(args.fileName ?? "video.mp4")}`;
}
```

Add test:

```ts
test("shows a clear media import error notice", async ({ page }) => {
  await createPageAndFocusEditor(page, "Media Error Smoke");
  const editor = page.locator('[contenteditable="true"]').first();

  await editor.dispatchEvent("paste", {
    clipboardData: {
      files: [new File(["x"], "too-large.png", { type: "image/png" })],
      getData: () => "",
    },
  });

  await expect(page.locator(".on-notice").filter({ hasText: "Image must be 10 MB or smaller." })).toBeVisible();
});
```

- [ ] **Step 7: Run targeted tests**

Run:

```bash
npx vitest run src/lib/editorMedia.test.ts
npx playwright test tests/e2e/persistence.e2e.ts -g "media import error" --project=chromium
```

Expected: pass.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/lib/editorMedia.ts src/lib/editorMedia.test.ts src/components/PageEditor.tsx tests/e2e/persistence.e2e.ts
git commit -m "Show editor media import errors"
```

---

### Task 2: Drag And Drop Image/Video Into Editor

**Files:**
- Modify: `src/components/PageEditor.tsx`
- Modify: `src/index.css`
- Modify: `tests/e2e/persistence.e2e.ts`

- [ ] **Step 1: Write failing e2e test**

Add:

```ts
test("imports dropped image and video files into the editor", async ({ page }) => {
  const title = "Media Drop Smoke";
  await createPageAndFocusEditor(page, title);
  const dropTarget = page.locator(".on-page-editor-blocks");

  await dropTarget.dispatchEvent("dragenter", {
    dataTransfer: { files: [new File(["image"], "drop.png", { type: "image/png" })] },
  });
  await expect(dropTarget).toHaveAttribute("data-editor-media-drop", "active");

  await dropTarget.dispatchEvent("drop", {
    dataTransfer: {
      files: [
        new File(["image"], "drop.png", { type: "image/png" }),
        new File(["video"], "drop.mp4", { type: "video/mp4" }),
      ],
    },
  });

  await expect.poll(async () => storedEditorBlocks(page, title)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "image" }),
      expect.objectContaining({ type: "video" }),
    ])
  );
});
```

- [ ] **Step 2: Run test and verify fail**

Run:

```bash
npx playwright test tests/e2e/persistence.e2e.ts -g "imports dropped image" --project=chromium
```

Expected: fail because no editor media drop handlers exist.

- [ ] **Step 3: Add drop state and import helper in PageEditor**

In `PageEditor`, add state:

```ts
const [isMediaDropActive, setIsMediaDropActive] = useState(false);
```

Add helper:

```ts
const importDroppedMediaFiles = useCallback(async (files: File[]) => {
  const mediaFiles = files
    .map((file) => ({ file, kind: editorMediaKindForFile(file) }))
    .filter((item): item is { file: File; kind: EditorMediaKind } => Boolean(item.kind));

  if (mediaFiles.length === 0) {
    showError("Drop PNG, JPG, WebP, GIF, MP4, M4V, MOV, or WebM files.");
    return;
  }

  try {
    const media = await Promise.all(
      mediaFiles.map(async ({ file, kind }) => {
        const importedPath = await importEditorMedia(file, page.id);
        return editorMediaBlockProps(kind, file.name || (kind === "video" ? "Dropped video" : "Dropped image"), coverImageSrc(importedPath));
      })
    );
    insertEditorMediaBlocks(editor, media);
    showSuccess(`${media.length} media file${media.length === 1 ? "" : "s"} imported.`);
  } catch (error) {
    showError(editorMediaUserMessage(error));
  }
}, [editor, page.id, showError, showSuccess]);
```

Add event handlers:

```ts
const handleMediaDragOver = (event: React.DragEvent<HTMLDivElement>) => {
  const files = Array.from(event.dataTransfer.files ?? []);
  if (files.some((file) => editorMediaKindForFile(file))) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsMediaDropActive(true);
  }
};

const handleMediaDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
    setIsMediaDropActive(false);
  }
};

const handleMediaDrop = (event: React.DragEvent<HTMLDivElement>) => {
  const files = Array.from(event.dataTransfer.files ?? []);
  if (files.length === 0) return;
  event.preventDefault();
  setIsMediaDropActive(false);
  void importDroppedMediaFiles(files);
};
```

- [ ] **Step 4: Attach handlers and drop styling hook**

Modify editor wrapper:

```tsx
<div
  className="on-page-editor-blocks relative -ml-10 flex-1 overflow-visible bg-transparent pl-10"
  data-editor-media-drop={isMediaDropActive ? "active" : undefined}
  onDragOver={handleMediaDragOver}
  onDragLeave={handleMediaDragLeave}
  onDrop={handleMediaDrop}
>
```

- [ ] **Step 5: Add CSS drop affordance**

Add to `src/index.css`:

```css
.on-page-editor-blocks[data-editor-media-drop="active"]::after {
  content: "";
  position: absolute;
  inset: 8px 0 8px 40px;
  pointer-events: none;
  border: 1px dashed color-mix(in srgb, var(--primary) 62%, transparent);
  background: color-mix(in srgb, var(--primary) 8%, transparent);
  border-radius: 8px;
}
```

- [ ] **Step 6: Run targeted drag/drop test**

Run:

```bash
npx playwright test tests/e2e/persistence.e2e.ts -g "imports dropped image" --project=chromium
```

Expected: pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/components/PageEditor.tsx src/index.css tests/e2e/persistence.e2e.ts
git commit -m "Support editor media drag and drop"
```

---

### Task 3: Visible Import State

**Files:**
- Modify: `src/components/PageEditor.tsx`
- Modify: `src/index.css`
- Modify: `tests/e2e/persistence.e2e.ts`

- [ ] **Step 1: Write failing e2e test for import state**

Add mock delay in `import_editor_video`:

```ts
if (cmd === "import_editor_video") {
  if (args.fileName === "slow.mp4") {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  if (args.fileName === "too-large.mp4") throw new Error("video must be 512 MB or smaller");
  return `/mock/editor-videos/${String(args.fileName ?? "video.mp4")}`;
}
```

Add test:

```ts
test("shows media import progress while a video imports", async ({ page }) => {
  await createPageAndFocusEditor(page, "Media Progress Smoke");
  const dropTarget = page.locator(".on-page-editor-blocks");

  await dropTarget.dispatchEvent("drop", {
    dataTransfer: { files: [new File(["video"], "slow.mp4", { type: "video/mp4" })] },
  });

  await expect(page.getByText("Importing media...")).toBeVisible();
  await expect(page.getByText("Importing media...")).toBeHidden({ timeout: 3_000 });
});
```

- [ ] **Step 2: Run test and verify fail**

Run:

```bash
npx playwright test tests/e2e/persistence.e2e.ts -g "media import progress" --project=chromium
```

Expected: fail because no progress UI exists.

- [ ] **Step 3: Add import state counter**

In `PageEditor`:

```ts
const [mediaImportCount, setMediaImportCount] = useState(0);
const isImportingMedia = mediaImportCount > 0;

const withMediaImportState = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
  setMediaImportCount((count) => count + 1);
  try {
    return await operation();
  } finally {
    setMediaImportCount((count) => Math.max(0, count - 1));
  }
}, []);
```

Wrap slash menu, paste, and drop imports:

```ts
const media = await withMediaImportState(() =>
  Promise.all(
    mediaFiles.map(async ({ file, kind }) => {
      const importedPath = await importEditorMedia(file, page.id);
      return editorMediaBlockProps(kind, file.name || (kind === "video" ? "Video" : "Image"), coverImageSrc(importedPath));
    })
  )
);
```

- [ ] **Step 4: Render import status**

Inside `.on-page-editor-blocks`, before `BlockNoteView`:

```tsx
{isImportingMedia ? (
  <div className="on-editor-media-importing" role="status" aria-live="polite">
    Importing media...
  </div>
) : null}
```

- [ ] **Step 5: Add CSS for import state**

Add:

```css
.on-editor-media-importing {
  position: sticky;
  top: 12px;
  z-index: 30;
  width: fit-content;
  margin: 0 0 8px auto;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--background);
  color: var(--muted-foreground);
  box-shadow: var(--shadow-sm);
  padding: 6px 10px;
  font-size: 12px;
}
```

- [ ] **Step 6: Run targeted progress test**

Run:

```bash
npx playwright test tests/e2e/persistence.e2e.ts -g "media import progress" --project=chromium
```

Expected: pass.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/components/PageEditor.tsx src/index.css tests/e2e/persistence.e2e.ts
git commit -m "Show editor media import progress"
```

---

### Task 4: Compact Media Block Presentation

**Files:**
- Modify: `src/index.css`
- Modify: `tests/e2e/persistence.e2e.ts`

- [ ] **Step 1: Write failing e2e style test**

Seed an image and video block:

```ts
test("renders editor media blocks compactly", async ({ page }) => {
  await seedPage(page, "Compact Media Smoke", [
    { type: "image", props: { name: "photo.png", url: "/mock/editor-images/photo.png" }, children: [] },
    { type: "video", props: { name: "clip.mp4", url: "/mock/editor-videos/clip.mp4" }, children: [] },
  ]);

  const mediaBlocks = page.locator(".bn-block-content").filter({ hasText: /photo.png|clip.mp4/ });
  await expect(mediaBlocks.first()).toBeVisible();

  const metrics = await page.locator(".on-page-editor-blocks").evaluate((element) => {
    const visualMedia = Array.from(element.querySelectorAll(".bn-visual-media"));
    const video = element.querySelector("video.bn-visual-media");
    return {
      count: visualMedia.length,
      maxWidth: Math.max(...visualMedia.map((node) => (node as HTMLElement).getBoundingClientRect().width)),
      firstRadius: visualMedia[0] ? getComputedStyle(visualMedia[0] as HTMLElement).borderRadius : "",
      videoMaxHeight: video ? getComputedStyle(video as HTMLElement).maxHeight : "",
    };
  });

  expect(metrics.count).toBeGreaterThan(0);
  expect(metrics.maxWidth).toBeLessThanOrEqual(760);
  expect(metrics.firstRadius).toBe("8px");
  expect(metrics.videoMaxHeight).toBe("420px");
});
```

- [ ] **Step 2: Run style test and verify fail**

Run:

```bash
npx playwright test tests/e2e/persistence.e2e.ts -g "compact media" --project=chromium
```

Expected before CSS: fail because `.bn-visual-media` has no enforced `8px` radius and video has no `420px` max height.

- [ ] **Step 3: Add compact media CSS**

Add CSS rules:

```css
.on-page-editor-blocks [data-file-block] .bn-visual-media-wrapper,
.on-page-editor-blocks [data-file-block] .bn-file-block-content-wrapper {
  max-width: min(760px, 100%);
}

.on-page-editor-blocks [data-file-block] .bn-visual-media,
.on-page-editor-blocks img.bn-visual-media,
.on-page-editor-blocks video.bn-visual-media {
  max-width: min(760px, 100%);
  border-radius: 8px;
}

.on-page-editor-blocks [data-file-block] .bn-file-name-with-icon {
  min-height: 32px;
  font-size: 13px;
}

.on-page-editor-blocks video.bn-visual-media {
  max-height: 420px;
  background: #000;
}
```

- [ ] **Step 4: Run style test and screenshot check**

Run:

```bash
npx playwright test tests/e2e/persistence.e2e.ts -g "compact media" --project=chromium
```

Expected: pass.

- [ ] **Step 5: Run full verification**

Run:

```bash
npx tsc --noEmit --pretty false
npm run test
npx playwright test tests/e2e/persistence.e2e.ts --project=chromium
npm run electron:smoke
```

Expected:
- TypeScript: no output, exit 0.
- Vitest: all tests pass.
- Persistence e2e: all tests pass.
- Electron smoke: exit 0.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/index.css tests/e2e/persistence.e2e.ts
git commit -m "Polish editor media blocks"
```

---

## Final Verification

- [ ] Run complete gate:

```bash
npm run check:electron
```

Expected: build, tests, Electron smoke/runtime, audit, package dir, visual/parity/stability smoke all pass.

- [ ] Push branch:

```bash
git push origin main
```

Expected: GitHub CI green.

---

## Self-Review

- Spec coverage: tasks cover error toasts, drag/drop, import state, and visual polish.
- Red-flag scan: no unresolved markers; Task 4 uses BlockNote's concrete `.bn-visual-media`, `.bn-visual-media-wrapper`, and `[data-file-block]` selectors from installed package source.
- Type consistency: media kind type is `EditorMediaKind`; helper names match the snippets used by `PageEditor`.
