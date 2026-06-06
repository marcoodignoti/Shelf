import { describe, expect, it } from "vitest";
import {
  editorMediaBlockProps,
  editorMediaKindForFile,
  editorMediaUserMessage,
} from "./editorMedia";

describe("editorMediaKindForFile", () => {
  it("detects supported image and video files", () => {
    expect(editorMediaKindForFile(new File([], "photo.png", { type: "image/png" }))).toBe("image");
    expect(editorMediaKindForFile(new File([], "clip.mp4", { type: "video/mp4" }))).toBe("video");
  });

  it("returns null for unsupported files", () => {
    expect(editorMediaKindForFile(new File([], "note.txt", { type: "text/plain" }))).toBeNull();
  });
});

describe("editorMediaUserMessage", () => {
  it("maps backend media errors to user messages", () => {
    expect(editorMediaUserMessage(new Error("image must be 10 MB or smaller"))).toBe(
      "Image must be 10 MB or smaller."
    );
    expect(editorMediaUserMessage(new Error("video must be 512 MB or smaller"))).toBe(
      "Video must be 512 MB or smaller."
    );
    expect(editorMediaUserMessage(new Error("video must be MP4, M4V, MOV, or WebM"))).toBe(
      "Video must be MP4, M4V, MOV, or WebM."
    );
    expect(editorMediaUserMessage(new Error("image must be PNG, JPG, WebP, or GIF"))).toBe(
      "Image must be PNG, JPG, WebP, or GIF."
    );
    expect(editorMediaUserMessage(new Error("unknown"))).toBe("Could not import that media file.");
  });
});

describe("editorMediaBlockProps", () => {
  it("builds image block props", () => {
    expect(editorMediaBlockProps("image", "photo.png", "/asset/photo.png")).toEqual({
      type: "image",
      props: { name: "photo.png", url: "/asset/photo.png" },
    });
  });

  it("defaults empty video names", () => {
    expect(editorMediaBlockProps("video", "", "/asset/video.mp4")).toEqual({
      type: "video",
      props: { name: "Video", url: "/asset/video.mp4" },
    });
  });
});
