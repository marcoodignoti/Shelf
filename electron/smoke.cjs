const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { OpenNotionBackend } = require("./backend.cjs");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opennotion-electron-"));
const backend = new OpenNotionBackend({ appConfigDir: tempRoot });

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
