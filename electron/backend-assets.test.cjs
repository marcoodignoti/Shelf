const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const MP4_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
]);

test("asset backend imports profile, cover, editor image, and editor video files", () => {
  const { createAssetBackend } = require("./backend-assets.cjs");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-assets-"));
  const sourcePath = path.join(dataDir, "source.png");
  fs.writeFileSync(sourcePath, PNG_BYTES);
  const metadata = new Map();
  const assets = createAssetBackend({
    appConfigDir: dataDir,
    readMetadataValue: (key) => metadata.get(key) ?? null,
    writeMetadataValue: (key, value) => metadata.set(key, value),
  });

  try {
    const avatarPath = assets.importProfileAvatar({ sourcePath });
    assert.equal(path.dirname(avatarPath), path.join(dataDir, "avatars"));
    assert.equal(fs.readFileSync(avatarPath).subarray(0, 8).equals(PNG_BYTES.subarray(0, 8)), true);

    const coverPath = assets.importCoverImage({
      sourcePath,
      pageId: "page/with spaces",
    });
    assert.equal(path.dirname(coverPath), path.join(dataDir, "covers"));
    assert.match(path.basename(coverPath), /^pagewithspaces-\d+\.png$/);

    const imagePath = assets.importEditorImage({
      pageId: "page/1",
      fileName: "diagram!.png",
      bytes: Array.from(PNG_BYTES),
    });
    assert.equal(
      path.dirname(imagePath),
      path.join(dataDir, "editor-images", "page1"),
    );
    assert.match(path.basename(imagePath), /^\d+-diagram\.png$/);

    const videoPath = assets.importEditorVideo({
      pageId: "page/1",
      fileName: "clip!.mp4",
      bytes: Array.from(MP4_BYTES),
    });
    assert.equal(
      path.dirname(videoPath),
      path.join(dataDir, "editor-videos", "page1"),
    );
    assert.match(path.basename(videoPath), /^\d+-clip\.mp4$/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
