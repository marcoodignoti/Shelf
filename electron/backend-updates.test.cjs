const assert = require("node:assert/strict");
const test = require("node:test");

test("update backend creates verified tokens for trusted manifest downloads", () => {
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
  assert.deepEqual(
    updates.verifiedUpdateDownload({
      downloadToken: download.downloadToken,
      url: download.url,
      sha256,
    }),
    { url: download.url, sha256 },
  );
});

test("re-fetching the manifest keeps previously issued download tokens valid", () => {
  const { createUpdateBackend } = require("./backend-updates.cjs");
  const updates = createUpdateBackend({
    verifiedUpdateDownloads: new Map(),
  });
  const sha256 = "a".repeat(64);
  const downloadUrl =
    "https://github.com/marcoodignoti/Shelf/releases/download/v9.9.9/Shelf_9.9.9.dmg";

  const first = updates.rememberVerifiedUpdateDownloads({
    version: "9.9.9",
    downloads: { macosArm64: { url: downloadUrl, sha256, label: "macOS" } },
  });
  const firstToken = first.downloads.macosArm64.downloadToken;
  assert.equal(typeof firstToken, "string");

  // A concurrent update check (e.g. auto-notice + manual settings check) re-fetches
  // the same manifest. The previously issued token must stay valid.
  updates.rememberVerifiedUpdateDownloads({
    version: "9.9.9",
    downloads: { macosArm64: { url: downloadUrl, sha256, label: "macOS" } },
  });

  assert.deepEqual(
    updates.verifiedUpdateDownload({
      downloadToken: firstToken,
      url: downloadUrl,
      sha256,
    }),
    { url: downloadUrl, sha256 },
  );
});

test("cancelled update downloads restore the verified token for retry", async () => {
  const { createUpdateBackend } = require("./backend-updates.cjs");
  const sha256 = "a".repeat(64);
  const downloadUrl =
    "https://github.com/marcoodignoti/Shelf/releases/download/v9.9.9/Shelf_9.9.9.dmg";
  let abortSignal = null;

  const updates = createUpdateBackend({
    activeUpdateDownloads: new Map(),
    downloadsDir: "/tmp",
    verifiedUpdateDownloads: new Map(),
    openPath: async () => "",
  });

  const manifest = updates.rememberVerifiedUpdateDownloads({
    version: "9.9.9",
    downloads: {
      macosArm64: { url: downloadUrl, sha256, label: "macOS" },
    },
  });
  const download = manifest.downloads.macosArm64;
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    abortSignal = options.signal;
    return await new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        reject(new Error("aborted"));
      });
    });
  };

  try {
    const promise = updates.downloadUpdateArtifact({
      url: download.url,
      sha256: download.sha256,
      downloadToken: download.downloadToken,
      downloadId: "download-1",
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(abortSignal.aborted, false);
    assert.deepEqual(updates.cancelUpdateDownload({ downloadId: "download-1" }), {
      cancelled: true,
    });
    await assert.deepEqual(await promise, {
      cancelled: true,
      bytes: 0,
      sha256,
    });

    const verified = updates.verifiedUpdateDownload({
      downloadToken: download.downloadToken,
      url: download.url,
      sha256: download.sha256,
    });
    assert.deepEqual(verified, { url: download.url, sha256 });
  } finally {
    global.fetch = originalFetch;
  }
});
