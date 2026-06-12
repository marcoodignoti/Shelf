const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { _electron: electron } = require("playwright");

const root = path.resolve(__dirname, "..");
const executablePath = path.join(root, "dist-electron", "mac-arm64", "Shelf.app", "Contents", "MacOS", "Shelf");
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axL6wAAAABJRU5ErkJggg==",
  "base64"
);
const tinyPdf = Buffer.from(
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSA+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9Sb290IDEgMCBSIC9TaXplIDQgPj4Kc3RhcnR4cmVmCjE4NgolJUVPRgo=",
  "base64"
);
const tinyMp4Header = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x01,
  0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31,
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  if (process.platform !== "darwin") {
    console.log("Skipping packaged stability smoke outside macOS");
    return;
  }
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Packaged Electron app missing: ${executablePath}`);
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-electron-stability-"));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-electron-stability-files-"));
  const pngPath = path.join(workDir, "cover.png");
  const badPngPath = path.join(workDir, "bad.png");
  const pdfPath = path.join(workDir, "cleanup.pdf");
  const invalidBackupPath = path.join(workDir, "invalid.json");
  fs.writeFileSync(pngPath, onePixelPng);
  fs.writeFileSync(badPngPath, "not an image");
  fs.writeFileSync(pdfPath, tinyPdf);
  fs.writeFileSync(invalidBackupPath, "{bad");

  const app = await electron.launch({
    executablePath,
    // Pin the renderer locale: smoke assertions use English strings and must
    // not depend on the host machine's system language.
    args: ["--lang=en-US"],
    env: {
      ...process.env,
      SHELF_USER_DATA_DIR: userDataDir,
      ELECTRON_ENABLE_LOGGING: "1",
    },
  });

  try {
    const window = await app.firstWindow({ timeout: 15000 });
    await window.waitForLoadState("domcontentloaded", { timeout: 15000 });

    const result = await window.evaluate(
      async ({ pngPath, badPngPath, pdfPath, invalidBackupPath, pngBytes, mp4Bytes }) => {
        const invoke = (command, args = {}) => window.openNotion.invoke(command, args);
        const now = new Date().toISOString();
        const pageId = crypto.randomUUID();
        await invoke("create_page", { id: pageId, title: "Stability Smoke", parentId: null, createdAt: now });

        const coverPath = await invoke("import_cover_image", { sourcePath: pngPath, pageId });
        let badCoverError = "";
        try {
          await invoke("import_cover_image", { sourcePath: badPngPath, pageId });
        } catch (error) {
          badCoverError = String(error?.message || error);
        }

        const editorPath = await invoke("import_editor_image", {
          pageId,
          fileName: "inline.png",
          bytes: pngBytes,
        });
        const editorVideoPath = await invoke("import_editor_video", {
          pageId,
          fileName: "inline.mp4",
          bytes: mp4Bytes,
        });

        let invalidBackupError = "";
        try {
          await invoke("import_backup", { path: invalidBackupPath, importedAt: now });
        } catch (error) {
          invalidBackupError = String(error?.message || error);
        }

        let unknownCommandError = "";
        try {
          await invoke("definitely_missing_command", {});
        } catch (error) {
          unknownCommandError = String(error?.message || error);
        }

        const document = await invoke("import_studio_document", {
          documentId: crypto.randomUUID(),
          notePageId: crypto.randomUUID(),
          sourcePath: pdfPath,
          importedAt: now,
        });
        await invoke("delete_studio_document", { id: document.id });

        return { coverPath, badCoverError, editorPath, editorVideoPath, invalidBackupError, unknownCommandError, storedPdfPath: document.stored_file_path };
      },
      { pngPath, badPngPath, pdfPath, invalidBackupPath, pngBytes: Array.from(onePixelPng), mp4Bytes: Array.from(tinyMp4Header) }
    );

    assert(fs.existsSync(result.coverPath), "Cover image was not copied");
    assert(result.badCoverError.includes("supported image"), `Bad cover was not rejected: ${result.badCoverError}`);
    assert(fs.existsSync(result.editorPath), "Editor image was not written");
    assert(fs.existsSync(result.editorVideoPath), "Editor video was not written");
    assert(result.invalidBackupError.includes("not valid JSON"), `Invalid backup was not rejected: ${result.invalidBackupError}`);
    assert(result.unknownCommandError.includes("unknown command"), `Unknown command was not rejected: ${result.unknownCommandError}`);
    assert(!fs.existsSync(result.storedPdfPath), "Studio delete did not remove copied PDF");

    const db = new DatabaseSync(path.join(userDataDir, "opennotion.db"));
    try {
      const documents = db.prepare("SELECT COUNT(*) AS count FROM studio_documents").get().count;
      assert(documents === 0, "Studio delete left a document row");
    } finally {
      db.close();
    }
  } finally {
    await app.close();
  }

  console.log(`Electron stability smoke passed: ${userDataDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
