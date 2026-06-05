const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { OpenNotionBackend } = require("./backend.cjs");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opennotion-electron-"));
const updateSigningKey = crypto.generateKeyPairSync("ed25519");
const updateManifestPublicKey = updateSigningKey.publicKey.export({ format: "pem", type: "spki" });
const backend = new OpenNotionBackend({ appConfigDir: tempRoot, updateManifestPublicKey });
const tinyPdfFixture = Buffer.from(
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSA+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9Sb290IDEgMCBSIC9TaXplIDQgPj4Kc3RhcnR4cmVmCjE4NgolJUVPRgo=",
  "base64"
);

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("unsupported signed manifest test value");
}

function signedUpdateManifest(payload) {
  return {
    signatureAlgorithm: "ed25519",
    payload,
    signature: crypto.sign(null, Buffer.from(canonicalJson(payload), "utf8"), updateSigningKey.privateKey).toString("base64"),
  };
}

async function run() {
  const createdAt = "2026-06-03T00:00:00.000Z";
  const page = await backend.invoke("create_page", {
    id: "page-1",
    title: "Smoke",
    parentId: null,
    createdAt,
  });

  if (page.id !== "page-1" || page.title !== "Smoke") {
    throw new Error("create_page returned wrong page");
  }

  await backend.invoke("update_page", {
    id: "page-1",
    updates: { content: "Hello Electron", search_text: "Hello Electron" },
    updatedAt: createdAt,
  });

  const results = await backend.invoke("search_pages", { query: "electron" });
  if (results.length !== 1 || results[0].id !== "page-1") {
    throw new Error("search_pages failed");
  }

  const backupPath = path.join(tempRoot, "backup.json");
  const exported = await backend.invoke("export_backup", { path: backupPath, exportedAt: createdAt });
  if (exported !== 1 || !fs.existsSync(backupPath)) {
    throw new Error("export_backup failed");
  }

  await backend.invoke("delete_page", { id: "page-1" });
  const imported = await backend.invoke("import_backup", { path: backupPath, importedAt: createdAt });
  if (imported !== 1) {
    throw new Error("import_backup failed");
  }

  const pages = await backend.invoke("list_pages");
  if (pages.length !== 1 || pages[0].title !== "Smoke") {
    throw new Error("list_pages after import failed");
  }

  await backend.invoke("create_page", {
    id: "linked-page",
    title: "Linked page",
    parentId: null,
    createdAt,
  });

  const pdfPath = path.join(tempRoot, "source.pdf");
  fs.writeFileSync(pdfPath, tinyPdfFixture);
  await backend.invoke("import_studio_document", {
    documentId: "doc-1",
    notePageId: "studio-note-1",
    sourcePath: pdfPath,
    importedAt: createdAt,
  });

  const primaryLinks = await backend.invoke("list_studio_document_page_links", { documentId: "doc-1" });
  if (primaryLinks.length !== 1 || primaryLinks[0].page_id !== "studio-note-1") {
    throw new Error("studio primary page link failed");
  }

  const linked = await backend.invoke("link_studio_document_page", {
    id: "doc-link-1",
    documentId: "doc-1",
    pageId: "linked-page",
    pdfPage: 3,
    label: "p. 3",
    createdAt,
  });
  if (linked.page_id !== "linked-page" || linked.pdf_page !== 3 || linked.page.title !== "Linked page") {
    throw new Error("link_studio_document_page failed");
  }

  const studioLinks = await backend.invoke("list_studio_document_page_links", { documentId: "doc-1" });
  if (studioLinks.length !== 2 || !studioLinks.some((link) => link.page_id === "linked-page" && link.pdf_page === 3)) {
    throw new Error("list_studio_document_page_links failed");
  }

  const allStudioLinks = await backend.invoke("list_all_studio_document_page_links");
  if (allStudioLinks.length !== 2 || !allStudioLinks.some((link) => link.document_id === "doc-1" && link.page_id === "linked-page")) {
    throw new Error("list_all_studio_document_page_links failed");
  }

  await backend.invoke("unlink_studio_document_page", { id: "doc-link-1" });
  const remainingStudioLinks = await backend.invoke("list_studio_document_page_links", { documentId: "doc-1" });
  if (remainingStudioLinks.some((link) => link.id === "doc-link-1")) {
    throw new Error("unlink_studio_document_page failed");
  }

  await backend.invoke("open_external_url", { url: "https://github.com/marcoodignoti/OpenNotion" });
  try {
    await backend.invoke("open_external_url", { url: "http://example.com" });
    throw new Error("open_external_url accepted non-HTTPS URL");
  } catch (error) {
    if (!String(error?.message || error).includes("external URL must use HTTPS")) {
      throw error;
    }
  }

  try {
    await backend.invoke("fetch_update_manifest", { url: "http://example.com/beta-update.json" });
    throw new Error("fetch_update_manifest accepted non-HTTPS URL");
  } catch (error) {
    if (!String(error?.message || error).includes("update manifest URL must use HTTPS")) {
      throw error;
    }
  }

  const assetRoot = path.join(tempRoot, "covers");
  const assetPath = path.join(assetRoot, "cover.png");
  fs.mkdirSync(assetRoot, { recursive: true });
  fs.writeFileSync(assetPath, Buffer.from("managed asset"));
  const assetUrl = backend.fileSrc(assetPath);
  if (!assetUrl.startsWith("opennotion-app://asset/") || assetUrl.startsWith("file://")) {
    throw new Error("fileSrc did not use the app asset protocol");
  }
  if (backend.resolveManagedAssetPath(new URL(assetUrl).pathname.slice(1)) !== fs.realpathSync(assetPath)) {
    throw new Error("app asset protocol token did not resolve to the managed file");
  }

  const updateManifestUrl = "https://github.com/marcoodignoti/OpenNotion/releases/download/beta/beta-update.json";
  const manifestPayload = {
    version: "99.0.0",
    channel: "beta",
    publishedAt: "2026-06-05T00:00:00.000Z",
    title: "OpenNotion 99.0.0",
    summary: "Signed update manifest.",
    changes: ["Signed manifest"],
    downloads: {},
  };
  const originalManifestFetch = global.fetch;
  try {
    global.fetch = async () => new Response(JSON.stringify(signedUpdateManifest(manifestPayload)), {
      status: 200,
      headers: { "content-length": "512" },
    });
    const verifiedManifest = await backend.invoke("fetch_update_manifest", { url: updateManifestUrl });
    if (verifiedManifest.version !== manifestPayload.version) {
      throw new Error("fetch_update_manifest did not return verified payload");
    }

    let rejectedBadSignature = false;
    try {
      global.fetch = async () => {
        const manifest = signedUpdateManifest(manifestPayload);
        manifest.signature = "bad";
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { "content-length": "512" },
        });
      };
      await backend.invoke("fetch_update_manifest", { url: updateManifestUrl });
    } catch (error) {
      if (!String(error?.message || error).includes("signature")) throw error;
      rejectedBadSignature = true;
    }
    if (!rejectedBadSignature) throw new Error("fetch_update_manifest accepted bad signature");
  } finally {
    global.fetch = originalManifestFetch;
  }

  const updateBytes = Buffer.from("verified update artifact");
  const updateSha256 = crypto.createHash("sha256").update(updateBytes).digest("hex");
  const updateUrl = "https://github.com/marcoodignoti/OpenNotion/releases/download/v99.0.0/OpenNotion_99.0.0_arm64.dmg";
  const installerUpdateUrl = "https://github.com/marcoodignoti/OpenNotion/releases/download/v99.0.0/OpenNotion_99.0.0_setup_win-x64.exe";
  const originalFetch = global.fetch;
  let openedUpdatePath = null;
  global.fetch = async () => new Response(updateBytes, {
    status: 200,
    headers: { "content-length": String(updateBytes.length) },
  });
  backend.openPath = async (filePath) => {
    openedUpdatePath = filePath;
    return "";
  };

  const verifiedUpdate = await backend.invoke("download_update_artifact", {
    url: updateUrl,
    sha256: updateSha256,
  });
  if (verifiedUpdate.sha256 !== updateSha256 || !fs.existsSync(verifiedUpdate.path) || openedUpdatePath !== verifiedUpdate.path) {
    throw new Error("download_update_artifact failed verified download");
  }

  const verifiedInstallerUpdate = await backend.invoke("download_update_artifact", {
    url: installerUpdateUrl,
    sha256: updateSha256,
  });
  if (!verifiedInstallerUpdate.path.endsWith(".exe")) {
    throw new Error("download_update_artifact rejected Windows installer");
  }

  try {
    await backend.invoke("download_update_artifact", {
      url: updateUrl,
      sha256: "0".repeat(64),
    });
    throw new Error("download_update_artifact accepted bad checksum");
  } catch (error) {
    if (!String(error?.message || error).includes("checksum mismatch")) {
      throw error;
    }
  } finally {
    global.fetch = originalFetch;
  }
}

run()
  .finally(() => {
    backend.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
