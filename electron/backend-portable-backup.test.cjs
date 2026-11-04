const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");
const { ShelfBackend } = require("./backend.cjs");
const {
  createPortableArchive,
  extractPortableArchive,
  removePortableArchiveStaging,
  checksumForManifest,
  sha256File,
} = require("./portable-backup-archive.cjs");

const APP_ASSET_URL_PREFIX = "opennotion-app://asset/";
const now = "2026-07-11T10:00:00.000Z";
const onePixelPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function createBackend(appConfigDir) {
  return new ShelfBackend({ appConfigDir });
}

async function buildPortableFixture(rootDir) {
  const appConfigDir = path.join(rootDir, "source-workspace");
  const backend = createBackend(appConfigDir);
  const coverSource = path.join(rootDir, "cover.png");
  const pdfSource = path.join(rootDir, "paper.pdf");
  fs.writeFileSync(coverSource, onePixelPng);
  fs.writeFileSync(pdfSource, "%PDF-1.4\n%%EOF\n");

  await backend.invoke("create_page", {
    id: "research",
    title: "Research",
    parentId: null,
    createdAt: now,
  });
  await backend.invoke("create_page", {
    id: "linked-note",
    title: "Methods note",
    parentId: "research",
    createdAt: now,
  });
  const coverPath = backend.importCoverImage({ sourcePath: coverSource, pageId: "research" });
  const imagePath = await backend.invoke("import_editor_image", {
    pageId: "research",
    fileName: "figure.png",
    bytes: onePixelPng,
  });
  const mediaUrl = backend.fileSrc(imagePath);
  await backend.invoke("update_page", {
    id: "research",
    updates: {
      cover_url: coverPath,
      content: JSON.stringify([
        { type: "image", props: { url: mediaUrl }, children: [] },
        {
          type: "paragraph",
          content: [{
            type: "pageLink",
            props: {
              pageId: "linked-note",
              title: "Methods note",
              icon: "",
              kind: "note",
              label: "",
            },
          }],
        },
      ]),
      search_text: "figure methods",
    },
    updatedAt: now,
  });
  const avatarPath = backend.importProfileAvatar({ sourcePath: coverSource });
  await backend.invoke("update_workspace_profile", {
    name: "Marco",
    workspaceName: "Research shelf",
  });

  backend.createStudioProject({
    id: "course",
    name: "Civil law",
    parentId: null,
    createdAt: now,
  });
  await backend.importStudioDocument({
    documentId: "paper",
    notePageId: "paper",
    sourcePath: pdfSource,
    importedAt: now,
  });
  backend.updateStudioDocumentProject({ id: "paper", projectId: "course", updatedAt: now });
  backend.linkStudioDocumentPage({
    id: "methods-link",
    documentId: "paper",
    pageId: "linked-note",
    pdfPage: 2,
    label: "Methods",
    createdAt: now,
  });

  return { appConfigDir, avatarPath, backend };
}

function assetPathFromUrl(backend, value) {
  assert.ok(value.startsWith(APP_ASSET_URL_PREFIX));
  return backend.resolveManagedAssetPath(value.slice(APP_ASSET_URL_PREFIX.length));
}

function portableImportDirectories(appConfigDir) {
  return ["covers", "editor-images", "editor-videos", "avatars", "studio-documents"]
    .flatMap((kind) => {
      const directory = path.join(appConfigDir, kind);
      return fs.existsSync(directory)
        ? fs.readdirSync(directory).filter((name) => name.startsWith("portable-"))
        : [];
    });
}

async function rewriteArchive(sourcePath, destinationPath, mutate) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-portable-rewrite-"));
  const inspected = await extractPortableArchive({
    sourcePath,
    stagingRoot,
  });
  try {
    await mutate({ manifest: inspected.manifest, tempDir: inspected.stageDir });
    await createPortableArchive({
      destinationPath,
      manifest: inspected.manifest,
      assetSources: inspected.assetsById,
    });
  } finally {
    removePortableArchiveStaging(inspected.stageDir);
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function corruptManifestChecksumArchive(sourcePath, destinationPath) {
  const archive = zlib.gunzipSync(fs.readFileSync(sourcePath));
  const marker = Buffer.from('"checksum": "', "utf8");
  const markerOffset = archive.indexOf(marker);
  assert.notEqual(markerOffset, -1);
  archive.fill(0x30, markerOffset + marker.length, markerOffset + marker.length + 64);
  fs.writeFileSync(destinationPath, zlib.gzipSync(archive, { mtime: 0 }));
}

test("portable .shelf archive restores pages, managed assets, Studio data, and internal links", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-portable-backup-"));
  const archivePath = path.join(rootDir, "research.shelf");
  const source = await buildPortableFixture(rootDir);
  const targetConfigDir = path.join(rootDir, "target-workspace");
  const target = createBackend(targetConfigDir);

  try {
    const exportedCount = await source.backend.exportBackup({ path: archivePath, exportedAt: now });
    assert.equal(exportedCount, 4);
    assert.ok(fs.existsSync(archivePath));

    const inspected = await extractPortableArchive({ sourcePath: archivePath, stagingRoot: rootDir });
    try {
      assert.equal(inspected.manifest.format, "shelf-portable");
      assert.equal(inspected.manifest.version, 1);
      assert.ok(inspected.manifest.assets.length >= 4);
      assert.ok(inspected.manifest.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256)));
      assert.ok(!JSON.stringify(inspected.manifest).includes(source.appConfigDir));
    } finally {
      removePortableArchiveStaging(inspected.stageDir);
    }

    const importedCount = await target.importBackup({ path: archivePath, importedAt: now });
    assert.equal(importedCount, 3);

    const pages = target.listAllPages();
    const research = pages.find((page) => page.title === "Research");
    const linkedNote = pages.find((page) => page.title === "Methods note");
    assert.ok(research && linkedNote);
    assert.notEqual(research.id, "research");
    assert.equal(research.parent_id, null);
    assert.equal(linkedNote.parent_id, research.id);
    assert.ok(research.cover_url.startsWith(targetConfigDir));
    assert.ok(fs.existsSync(research.cover_url));

    const blocks = JSON.parse(research.content);
    assert.equal(assetPathFromUrl(target, blocks[0].props.url).startsWith(fs.realpathSync(targetConfigDir)), true);
    assert.ok(fs.existsSync(assetPathFromUrl(target, blocks[0].props.url)));
    assert.equal(blocks[1].content[0].props.pageId, linkedNote.id);

    const profile = target.getWorkspaceProfile();
    assert.equal(profile.name, "Marco");
    assert.equal(profile.workspaceName, "Research shelf");
    assert.ok(profile.avatarPath.startsWith(targetConfigDir));
    assert.ok(fs.existsSync(profile.avatarPath));

    const projects = target.listStudioProjects();
    const documents = target.listStudioDocuments();
    assert.equal(projects.length, 1);
    assert.equal(documents.length, 1);
    assert.equal(documents[0].project_id, projects[0].id);
    assert.equal(documents[0].id, documents[0].note_page_id);
    assert.ok(documents[0].stored_file_path.startsWith(targetConfigDir));
    assert.ok(fs.existsSync(target.resolveStudioDocumentPdfPath(documents[0].id)));

    const links = target.listStudioDocumentPageLinks({ documentId: documents[0].id });
    const methodsLink = links.find((link) => link.label === "Methods");
    assert.ok(methodsLink);
    assert.equal(methodsLink.page_id, linkedNote.id);
    assert.equal(methodsLink.pdf_page, 2);
  } finally {
    source.backend.close();
    target.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("portable import verifies asset checksums before writing workspace data", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-portable-checksum-"));
  const archivePath = path.join(rootDir, "valid.shelf");
  const corruptArchivePath = path.join(rootDir, "corrupt.shelf");
  const manifestCorruptArchivePath = path.join(rootDir, "manifest-corrupt.shelf");
  const source = await buildPortableFixture(rootDir);
  const target = createBackend(path.join(rootDir, "target-workspace"));
  const manifestTarget = createBackend(path.join(rootDir, "manifest-target-workspace"));

  try {
    await source.backend.exportBackup({ path: archivePath, exportedAt: now });
    await rewriteArchive(archivePath, corruptArchivePath, async ({ manifest, tempDir }) => {
      const assetPath = path.join(tempDir, manifest.assets[0].archive_path);
      const bytes = fs.readFileSync(assetPath);
      bytes[bytes.length - 1] ^= 0xff;
      fs.writeFileSync(assetPath, bytes);
    });

    await assert.rejects(
      target.importBackup({ path: corruptArchivePath, importedAt: now }),
      /asset checksum does not match/,
    );
    assert.equal(target.listAllPages().length, 0);
    assert.equal(target.listStudioDocuments().length, 0);
    assert.deepEqual(portableImportDirectories(target.appConfigDir), []);

    corruptManifestChecksumArchive(archivePath, manifestCorruptArchivePath);
    await assert.rejects(
      manifestTarget.importBackup({ path: manifestCorruptArchivePath, importedAt: now }),
      /manifest checksum does not match/,
    );
    assert.equal(manifestTarget.listAllPages().length, 0);
  } finally {
    source.backend.close();
    target.close();
    manifestTarget.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("portable import rejects assets whose content does not match their kind", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-portable-content-"));
  const archivePath = path.join(rootDir, "valid.shelf");
  const craftedArchivePath = path.join(rootDir, "crafted.shelf");
  const source = await buildPortableFixture(rootDir);
  const target = createBackend(path.join(rootDir, "target-workspace"));

  try {
    await source.backend.exportBackup({ path: archivePath, exportedAt: now });
    await rewriteArchive(archivePath, craftedArchivePath, async ({ manifest, tempDir }) => {
      const image = manifest.assets.find((asset) => asset.kind === "editor-images");
      assert.ok(image);
      const assetPath = path.join(tempDir, image.archive_path);
      fs.writeFileSync(assetPath, "<script>alert(1)</script>");
      image.extension = ".png";
      image.size = fs.statSync(assetPath).size;
      image.sha256 = await sha256File(assetPath);
      manifest.checksum = checksumForManifest(manifest);
    });

    await assert.rejects(
      target.importBackup({ path: craftedArchivePath, importedAt: now }),
      /not a supported image/,
    );
    assert.equal(target.listAllPages().length, 0);
    assert.deepEqual(portableImportDirectories(target.appConfigDir), []);
  } finally {
    source.backend.close();
    target.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("portable import removes staged asset directories when database import fails", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-portable-atomic-"));
  const archivePath = path.join(rootDir, "valid.shelf");
  const source = await buildPortableFixture(rootDir);
  const target = createBackend(path.join(rootDir, "target-workspace"));

  try {
    await source.backend.exportBackup({ path: archivePath, exportedAt: now });
    target.importPageRecords = () => {
      throw new Error("simulated database failure");
    };
    await assert.rejects(
      target.importBackup({ path: archivePath, importedAt: now }),
      /simulated database failure/,
    );
    assert.equal(target.listAllPages().length, 0);
    assert.equal(target.listStudioDocuments().length, 0);
    assert.deepEqual(portableImportDirectories(target.appConfigDir), []);
  } finally {
    source.backend.close();
    target.close();
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
