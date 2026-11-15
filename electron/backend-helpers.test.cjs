const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const helpers = require("./backend-helpers.cjs");

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const GIF = Buffer.from("GIF89a\0\0\0\0\0\0");
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP"),
]);
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x20]),
  Buffer.from("ftypisom"),
  Buffer.alloc(8),
]);
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-helpers-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function minimalBackup(overrides = {}) {
  return {
    version: 1,
    exported_at: "2026-01-01T00:00:00.000Z",
    pages: [{ id: "p1", title: "Page" }],
    ...overrides,
  };
}

test("validateExportRelativePath rejects traversal, absolute and odd paths", () => {
  for (const ok of ["page.md", "folder/page.md", "a/b/c/assets/img.png"]) {
    assert.doesNotThrow(() => helpers.validateExportRelativePath(ok), ok);
  }
  for (const bad of [
    "",
    "../escape.md",
    "a/../../escape.md",
    "./page.md",
    "/absolute.md",
    "a//b.md",
    "trailing/",
    "win\\path.md",
    "line\nbreak.md",
    "nul\u0000.md",
  ]) {
    assert.throws(() => helpers.validateExportRelativePath(bad), Error, JSON.stringify(bad));
  }
});

test("isPathInside only accepts the root itself and its descendants", () => {
  const root = path.join(os.tmpdir(), "shelf-root");
  assert.equal(helpers.isPathInside(root, root), true);
  assert.equal(helpers.isPathInside(root, path.join(root, "a", "b.pdf")), true);
  assert.equal(helpers.isPathInside(root, path.join(root, "..foo")), true);
  assert.equal(helpers.isPathInside(root, path.join(root, "..")), false);
  assert.equal(helpers.isPathInside(root, path.join(root, "..", "x")), false);
  assert.equal(helpers.isPathInside(root, `${root}-sibling`), false);
  assert.equal(helpers.isPathInside(root, path.parse(root).root), false);
});

test("validateManagedAssetPath resolves symlinks before checking managed roots", (t) => {
  const appDir = tempDir(t);
  const outside = tempDir(t);
  fs.mkdirSync(path.join(appDir, "covers"));
  const inside = path.join(appDir, "covers", "cover.png");
  fs.writeFileSync(inside, PNG);
  const secret = path.join(outside, "secret.txt");
  fs.writeFileSync(secret, "secret");
  const link = path.join(appDir, "covers", "link.png");
  fs.symlinkSync(secret, link);
  fs.writeFileSync(path.join(appDir, "opennotion.db"), "");

  assert.equal(
    helpers.validateManagedAssetPath(inside, appDir),
    fs.realpathSync(inside),
  );
  assert.throws(() => helpers.validateManagedAssetPath(link, appDir), /outside app-managed storage/);
  assert.throws(() => helpers.validateManagedAssetPath(secret, appDir), /outside app-managed storage/);
  assert.throws(
    () => helpers.validateManagedAssetPath(path.join(appDir, "opennotion.db"), appDir),
    /outside app-managed storage/,
  );
});

test("validateManagedStudioDocumentPath requires source.pdf inside the documents root", (t) => {
  const root = tempDir(t);
  const docDir = path.join(root, "doc-1");
  fs.mkdirSync(docDir);
  const source = path.join(docDir, "source.pdf");
  fs.writeFileSync(source, "%PDF-1.7");
  const other = path.join(docDir, "other.pdf");
  fs.writeFileSync(other, "%PDF-1.7");

  assert.equal(
    helpers.validateManagedStudioDocumentPath(source, root),
    fs.realpathSync(source),
  );
  assert.throws(() => helpers.validateManagedStudioDocumentPath(other, root), /outside app storage/);

  const elsewhere = tempDir(t);
  const outsideSource = path.join(elsewhere, "source.pdf");
  fs.writeFileSync(outsideSource, "%PDF-1.7");
  assert.throws(
    () => helpers.validateManagedStudioDocumentPath(outsideSource, root),
    /outside app storage/,
  );
});

test("app asset tokens round-trip and reject malformed input", () => {
  const filePath = "/Users/someone/Library/Application Support/àccénted/cover.png";
  const token = helpers.encodeAppAssetPath(filePath);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.equal(helpers.decodeAppAssetPath(token), filePath);
  for (const bad of ["", "   ", "abc/def", "a+b", "x=", null, undefined]) {
    assert.throws(() => helpers.decodeAppAssetPath(bad), /token is invalid/, String(bad));
  }
});

test("coverExtensionFromMagic detects image types from content only", () => {
  assert.equal(helpers.coverExtensionFromMagic(PNG), "png");
  assert.equal(helpers.coverExtensionFromMagic(JPG), "jpg");
  assert.equal(helpers.coverExtensionFromMagic(GIF), "gif");
  assert.equal(helpers.coverExtensionFromMagic(Buffer.from("GIF87a")), "gif");
  assert.equal(helpers.coverExtensionFromMagic(WEBP), "webp");
  assert.equal(helpers.coverExtensionFromMagic(Buffer.from("<svg xmlns=")), null);
  assert.equal(helpers.coverExtensionFromMagic(Buffer.from("RIFF\0\0\0\0WAVE")), null);
  assert.equal(helpers.coverExtensionFromMagic(Buffer.alloc(0)), null);
});

test("validatedEditorImageExtension requires matching extension and content", () => {
  assert.equal(helpers.validatedEditorImageExtension("photo.PNG", PNG), "png");
  assert.equal(helpers.validatedEditorImageExtension("photo.jpeg", JPG), "jpg");
  assert.throws(() => helpers.validatedEditorImageExtension("photo.svg", PNG), /must be PNG/);
  assert.throws(() => helpers.validatedEditorImageExtension("photo.png", JPG), /does not match/);
  assert.throws(
    () => helpers.validatedEditorImageExtension("photo.png", Buffer.from("<html>")),
    /not a supported image/,
  );
  const tooLarge = Buffer.alloc(helpers.COVER_IMAGE_MAX_BYTES + 1);
  PNG.copy(tooLarge);
  assert.throws(() => helpers.validatedEditorImageExtension("big.png", tooLarge), /10 MB/);
});

test("validatedCoverExtension reads the file header from disk", (t) => {
  const dir = tempDir(t);
  const good = path.join(dir, "cover.webp");
  fs.writeFileSync(good, WEBP);
  assert.equal(helpers.validatedCoverExtension(good, helpers.COVER_IMAGE_MAX_BYTES), "webp");

  const disguised = path.join(dir, "cover.png");
  fs.writeFileSync(disguised, GIF);
  assert.throws(
    () => helpers.validatedCoverExtension(disguised, helpers.COVER_IMAGE_MAX_BYTES),
    /does not match/,
  );
  assert.throws(() => helpers.validatedCoverExtension(good, 4), /10 MB or smaller/);
});

test("video validation recognises ISO-BMFF and WebM containers", () => {
  assert.equal(helpers.isIsoBaseMediaVideo(MP4), true);
  assert.equal(helpers.isIsoBaseMediaVideo(Buffer.from("not a video at all")), false);
  assert.equal(helpers.isWebmVideo(WEBM), true);
  assert.equal(helpers.isWebmVideo(MP4), false);

  assert.equal(helpers.validatedEditorVideoExtension("clip.MP4", MP4), "mp4");
  assert.equal(helpers.validatedEditorVideoExtension("clip.mov", MP4), "mov");
  assert.equal(helpers.validatedEditorVideoExtension("clip.webm", WEBM), "webm");
  assert.throws(() => helpers.validatedEditorVideoExtension("clip.webm", MP4), /not a supported video/);
  assert.throws(() => helpers.validatedEditorVideoExtension("clip.mp4", WEBM), /not a supported video/);
  assert.throws(() => helpers.validatedEditorVideoExtension("clip.avi", MP4), /must be MP4/);
});

test("validatedPdfFile checks extension and %PDF- header", (t) => {
  const dir = tempDir(t);
  const pdf = path.join(dir, "doc.pdf");
  fs.writeFileSync(pdf, "%PDF-1.7\n...");
  assert.doesNotThrow(() => helpers.validatedPdfFile(pdf));

  const fake = path.join(dir, "fake.pdf");
  fs.writeFileSync(fake, "<html>");
  assert.throws(() => helpers.validatedPdfFile(fake), /not valid/);

  const short = path.join(dir, "short.pdf");
  fs.writeFileSync(short, "%PD");
  assert.throws(() => helpers.validatedPdfFile(short), /not valid/);

  const txt = path.join(dir, "doc.txt");
  fs.writeFileSync(txt, "%PDF-1.7");
  assert.throws(() => helpers.validatedPdfFile(txt), /must be a PDF/);
});

test("safeStorageId and safeFileStem strip path and shell characters", () => {
  assert.equal(helpers.safeStorageId("../../etc/passwd"), "etcpasswd");
  assert.equal(helpers.safeStorageId("abc-123"), "abc-123");
  assert.equal(helpers.safeStorageId(""), "document");
  assert.equal(helpers.safeStorageId(null), "document");
  assert.equal(helpers.safeFileStem("../My Photo (1).png"), "MyPhoto1");
  assert.equal(helpers.safeFileStem("..."), "image");
  assert.equal(helpers.safeFileStem(""), "image");
});

test("normalizeStoredCoverUrl allows local covers and blocks remote schemes", () => {
  assert.equal(helpers.normalizeStoredCoverUrl(null), null);
  assert.equal(helpers.normalizeStoredCoverUrl("   "), null);
  assert.equal(
    helpers.normalizeStoredCoverUrl("data:image/png;base64,AAAA"),
    "data:image/png;base64,AAAA",
  );
  assert.equal(helpers.normalizeStoredCoverUrl("blob:abc"), "blob:abc");
  assert.throws(() => helpers.normalizeStoredCoverUrl("opennotion-app://asset/abc"), /unsupported cover URL scheme/);
  assert.equal(
    helpers.normalizeStoredCoverUrl("opennotion-app://asset/abc", { rejectRemote: false }),
    null,
  );
  // Windows drive letters are not URL schemes.
  assert.equal(helpers.normalizeStoredCoverUrl("C:/covers/a.png"), "C:/covers/a.png");
  assert.equal(helpers.normalizeStoredCoverUrl("linear-gradient(red, blue)"), "linear-gradient(red, blue)");

  for (const remote of [
    "https://tracker.example/p.png",
    "http://tracker.example/p.png",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html;base64,AAAA",
  ]) {
    assert.throws(() => helpers.normalizeStoredCoverUrl(remote), Error, remote);
    assert.equal(helpers.normalizeImportedCoverUrl(remote), null, remote);
  }
  assert.throws(() => helpers.normalizeStoredCoverUrl(42), /must be a string/);
  assert.equal(helpers.normalizeImportedCoverUrl("blob:abc"), null, "blob URLs do not survive import");
});

test("validatePageUpdateInput whitelists fields and normalises values", () => {
  assert.deepEqual(
    helpers.validatePageUpdateInput({
      title: "T",
      is_favorite: true,
      is_template: 0,
      parent_id: undefined,
      page_kind: "",
      cover_url: "  ",
    }),
    {
      title: "T",
      is_favorite: 1,
      is_template: 0,
      parent_id: null,
      page_kind: "note",
      cover_url: null,
    },
  );
  assert.throws(() => helpers.validatePageUpdateInput(null), /must be an object/);
  assert.throws(() => helpers.validatePageUpdateInput([]), /must be an object/);
  assert.throws(() => helpers.validatePageUpdateInput({ is_deleted: 1 }), /use delete_page/);
  assert.throws(() => helpers.validatePageUpdateInput({ rowid: 1 }), /unsupported page update field/);
  assert.throws(() => helpers.validatePageUpdateInput({ is_favorite: 2 }), /must be 0 or 1/);
  assert.throws(() => helpers.validatePageUpdateInput({ page_kind: "admin" }), /page_kind is invalid/);
  assert.throws(() => helpers.validatePageUpdateInput({ title: 7 }), /must be a string/);
  assert.throws(
    () => helpers.validatePageUpdateInput({ title: "x".repeat(helpers.BACKUP_MAX_TITLE_LENGTH + 1) }),
    /too large/,
  );
  assert.throws(
    () => helpers.validatePageUpdateInput({ cover_url: "https://tracker.example/p.png" }),
    /remote cover/,
  );
});

test("breakImportedParentCycles detaches pages whose parent chain loops", () => {
  const ids = (pages) => Object.fromEntries(pages.map((page) => [page.id, page.parent_id ?? null]));
  assert.deepEqual(
    ids(helpers.breakImportedParentCycles([
      { id: "root" },
      { id: "child", parent_id: "root" },
      { id: "grandchild", parent_id: "child" },
      { id: "external", parent_id: "existing-page" },
    ])),
    { root: null, child: "root", grandchild: "child", external: "existing-page" },
  );
  assert.deepEqual(ids(helpers.breakImportedParentCycles([{ id: "a", parent_id: "a" }])), { a: null });
  assert.deepEqual(
    ids(helpers.breakImportedParentCycles([
      { id: "a", parent_id: "c" },
      { id: "b", parent_id: "a" },
      { id: "c", parent_id: "b" },
      { id: "leaf", parent_id: "b" },
    ])),
    { a: null, b: "a", c: "b", leaf: "b" },
  );
});

test("validatePageCreateInput requires a non-empty id and created timestamp", () => {
  const valid = { id: "a", title: "T", parent: null, created: "2026-01-01" };
  assert.doesNotThrow(() => helpers.validatePageCreateInput(valid));
  assert.doesNotThrow(() => helpers.validatePageCreateInput({ ...valid, title: undefined }));
  assert.throws(() => helpers.validatePageCreateInput({ ...valid, id: "  " }), /cannot be empty/);
  assert.throws(() => helpers.validatePageCreateInput({ ...valid, id: 1 }), /must be a string/);
  assert.throws(() => helpers.validatePageCreateInput({ ...valid, created: "" }), /cannot be empty/);
  assert.throws(() => helpers.validatePageCreateInput({ ...valid, parent: 3 }), /must be a string/);
});

test("parseImportedBackup validates envelope and every page", () => {
  assert.equal(helpers.parseImportedBackup(JSON.stringify(minimalBackup())).pages.length, 1);
  const cases = [
    ["{", /not valid JSON/],
    ["[]", /invalid shape/],
    ["null", /invalid shape/],
    [JSON.stringify(minimalBackup({ version: 2 })), /version is not supported/],
    [JSON.stringify(minimalBackup({ exported_at: 1 })), /export timestamp/],
    [JSON.stringify(minimalBackup({ pages: {} })), /too many pages/],
    [JSON.stringify(minimalBackup({ pages: [null] })), /invalid pages/],
    [JSON.stringify(minimalBackup({ pages: [{ title: "no id" }] })), /id is required/],
    [JSON.stringify(minimalBackup({ pages: [{ id: "p", page_kind: "x" }] })), /page_kind/],
    [JSON.stringify(minimalBackup({ pages: [{ id: "p", sort_order: 1.5 }] })), /sort_order/],
    [JSON.stringify(minimalBackup({ pages: [{ id: "p", is_favorite: "yes" }] })), /must be 0 or 1/],
  ];
  for (const [raw, pattern] of cases) {
    assert.throws(() => helpers.parseImportedBackup(raw), pattern, raw);
  }
});

test("prepareImportedBackupPages remaps ids, keeps hierarchy and strips unsafe media", () => {
  const content = JSON.stringify([
    {
      type: "image",
      props: { url: "file:///Users/someone/secret.png", caption: "keep" },
      children: [
        { type: "video", props: { url: "FILE:///tmp/clip.mp4" }, children: [] },
        { type: "paragraph", props: { url: "file:///not-media" }, children: [] },
      ],
    },
  ]);
  const prepared = helpers.prepareImportedBackupPages(
    [
      { id: "parent", title: "Parent", is_deleted: 1, is_template: 1 },
      { id: "child", title: "Child", parent_id: "parent", content },
      { id: "orphan", title: "Orphan", parent_id: "missing" },
    ],
    "2026-03-01T00:00:00.000Z",
  );

  const [parent, child, orphan] = prepared;
  assert.notEqual(parent.id, "parent");
  assert.equal(child.parent_id, parent.id);
  assert.equal(orphan.parent_id, null);
  assert.equal(parent.is_deleted, 0, "imported pages are never hidden in trash");
  assert.equal(parent.is_template, 0);
  for (const page of prepared) {
    assert.equal(page.created_at, "2026-03-01T00:00:00.000Z");
    assert.equal(page.updated_at, "2026-03-01T00:00:00.000Z");
  }

  const blocks = JSON.parse(child.content);
  assert.equal(blocks[0].props.url, undefined);
  assert.equal(blocks[0].props.caption, "keep");
  assert.equal(blocks[0].children[0].props.url, undefined);
  assert.equal(blocks[0].children[1].props.url, "file:///not-media", "only media blocks are sanitised");
});

test("sanitizeImportedPageContent leaves non-block content untouched", () => {
  assert.equal(helpers.sanitizeImportedPageContent(null), null);
  assert.equal(helpers.sanitizeImportedPageContent(""), "");
  assert.equal(helpers.sanitizeImportedPageContent("not json"), "not json");
  assert.equal(helpers.sanitizeImportedPageContent('{"a":1}'), '{"a":1}');
});

test("pageSearchFtsQuery builds a safe prefix query", () => {
  assert.equal(helpers.pageSearchFtsQuery("Hello World"), "hello* world*");
  assert.equal(helpers.pageSearchFtsQuery('"quote" OR NEAR(x)'), "quote* or* near* x*");
  assert.equal(helpers.pageSearchFtsQuery("***"), "");
  assert.equal(helpers.pageSearchFtsQuery(null), "");
  assert.equal(helpers.pageSearchFtsQuery("a b c d e f g h i j").split(" ").length, 8);
});

test("studio project page ids round-trip", () => {
  const pageId = helpers.studioProjectPageId("abc");
  assert.equal(pageId, "studio-project:abc");
  assert.equal(helpers.studioProjectIdFromPageId(pageId), "abc");
  assert.equal(helpers.studioProjectIdFromPageId("plain-page"), null);
  assert.equal(helpers.studioProjectIdFromPageId(null), null);
});

test("canonicalJson sorts keys recursively and rejects unsupported values", () => {
  assert.equal(
    helpers.canonicalJson({ b: 1, a: [true, null, { d: "x", c: 2 }] }),
    '{"a":[true,null,{"c":2,"d":"x"}],"b":1}',
  );
  assert.throws(() => helpers.canonicalJson({ a: undefined }), /unsupported data/);
  assert.throws(() => helpers.canonicalJson({ a: () => 1 }), /unsupported data/);
});

test("trustedUpdateDownload only accepts release artifacts with a sha256", () => {
  const sha256 = "A".repeat(64);
  const url = "https://github.com/marcoodignoti/Shelf/releases/download/v1.0.0/Shelf_1.0.0.dmg";
  assert.deepEqual(helpers.trustedUpdateDownload({ url, sha256 }), { url, sha256: sha256.toLowerCase() });
  for (const bad of [
    null,
    [],
    { url, sha256: "abc" },
    { url: url.replace("https:", "http:"), sha256 },
    { url: url.replace("marcoodignoti", "attacker"), sha256 },
    { url: url.replace(".dmg", ".pkg"), sha256 },
    { url: `${url}?x=1`, sha256 },
  ]) {
    assert.equal(helpers.trustedUpdateDownload(bad), null, JSON.stringify(bad));
  }
});

test("updateArtifactFileName rejects untrusted artifact names", () => {
  assert.equal(
    helpers.updateArtifactFileName(new URL("https://x/releases/download/v1/Shelf_1.0.0.zip")),
    "Shelf_1.0.0.zip",
  );
  for (const bad of ["evil.dmg", "Shelf_1.0.0.dmg.sh", "Shelf_%2e%2e%2fx.dmg", "Shelf_a%20b.dmg"]) {
    assert.throws(
      () => helpers.updateArtifactFileName(new URL(`https://x/releases/download/v1/${bad}`)),
      /not trusted/,
      bad,
    );
  }
});

test("assertSafeInvokeArgs blocks renderer-supplied file paths", () => {
  for (const command of helpers.INVOKE_PATH_COMMANDS) {
    assert.throws(() => helpers.assertSafeInvokeArgs(command, {}), /trusted file dialog/, command);
  }
  assert.throws(
    () => helpers.assertSafeInvokeArgs("import_editor_image", { sourcePath: "/etc/passwd" }),
    /trusted file dialog/,
  );
  assert.throws(
    () => helpers.assertSafeInvokeArgs("import_editor_video", { source_path: "/etc/passwd" }),
    /trusted file dialog/,
  );
  assert.doesNotThrow(() =>
    helpers.assertSafeInvokeArgs("import_editor_image", { fileName: "a.png", bytes: [] }),
  );
  assert.doesNotThrow(() => helpers.assertSafeInvokeArgs("list_pages", { sourcePath: "/x" }));
});
