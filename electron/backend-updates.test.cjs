const assert = require("node:assert/strict");
const test = require("node:test");

test("update backend creates one-shot tokens for trusted manifest downloads", () => {
  const { createUpdateBackend } = require("./backend-updates.cjs");
  const updates = createUpdateBackend({
    verifiedUpdateDownloads: new Map(),
  });
  const sha256 = "a".repeat(64);

  const manifest = updates.rememberVerifiedUpdateDownloads({
    version: "9.9.9",
    downloads: {
      macosArm64: {
        url: "https://github.com/marcoodignoti/Shelf/releases/download/v9.9.9/Shelf_9.9.9.dmg",
        sha256,
        label: "macOS",
      },
      ignored: {
        url: "https://example.com/unsafe.dmg",
        sha256,
        label: "unsafe",
      },
    },
  });

  const download = manifest.downloads.macosArm64;
  assert.equal(typeof download.downloadToken, "string");
  assert.equal(manifest.downloads.ignored.downloadToken, undefined);

  assert.throws(
    () =>
      updates.verifiedUpdateDownload({
        downloadToken: download.downloadToken,
        url: download.url,
        sha256: "b".repeat(64),
      }),
    /does not match verified manifest/,
  );

  const verified = updates.verifiedUpdateDownload({
    downloadToken: download.downloadToken,
    url: download.url,
    sha256: download.sha256.toUpperCase(),
  });
  assert.deepEqual(verified, { url: download.url, sha256 });
  assert.throws(
    () =>
      updates.verifiedUpdateDownload({
        downloadToken: download.downloadToken,
        url: download.url,
        sha256,
      }),
    /not linked to a verified manifest/,
  );
});
