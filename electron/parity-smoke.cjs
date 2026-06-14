const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { _electron: electron } = require("playwright");

const root = path.resolve(__dirname, "..");
const executablePath = path.join(root, "dist-electron", "mac-arm64", "Shelf.app", "Contents", "MacOS", "Shelf");
const tinyPdfFixture = Buffer.from(
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSA+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9Sb290IDEgMCBSIC9TaXplIDQgPj4Kc3RhcnR4cmVmCjE4NgolJUVPRgo=",
  "base64"
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function launchApp(userDataDir) {
  const app = await electron.launch({
    executablePath,
    // Pin the renderer locale: parity assertions use English strings and must
    // not depend on the host machine's system language.
    args: ["--lang=en-US"],
    env: {
      ...process.env,
      SHELF_USER_DATA_DIR: userDataDir,
      ELECTRON_ENABLE_LOGGING: "1",
    },
  });
  const window = await app.firstWindow({ timeout: 15000 });
  const consoleMessages = [];
  window.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
  window.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
  await window.waitForLoadState("domcontentloaded", { timeout: 15000 });
  await window.waitForTimeout(1500);
  return { app, window, consoleMessages };
}

function relevantConsoleMessages(messages) {
  return messages.filter((message) => !message.includes("ExperimentalWarning"));
}

async function waitForBodyText(window, expectedText) {
  await window.waitForFunction((text) => document.body.innerText.includes(text), expectedText, { timeout: 15000 });
}

async function waitForCondition(check, message, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastValue;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await check();
    if (lastValue.pass) return lastValue.value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${message}: ${JSON.stringify(lastValue)}`);
}

async function invoke(window, command, args = {}) {
  return await window.evaluate(({ command, args }) => window.openNotion.invoke(command, args), { command, args });
}

async function waitForPageRecord(window, title, body) {
  await waitForCondition(async () => {
    const pages = await invoke(window, "list_all_pages");
    const page = pages.find((candidate) => candidate.title === title && (candidate.search_text ?? "").includes(body));
    return {
      pass: Boolean(page),
      value: pages.map((candidate) => ({ title: candidate.title, search_text: candidate.search_text })),
    };
  }, "Page record did not persist");
}

function readDb(userDataDir) {
  const db = new DatabaseSync(path.join(userDataDir, "opennotion.db"));
  try {
    return {
      pages: db.prepare("SELECT id, title, search_text, page_kind FROM pages WHERE is_deleted = 0 ORDER BY created_at").all(),
      studioDocuments: db.prepare("SELECT title, original_filename FROM studio_documents ORDER BY title").all(),
      schemaVersion: db.prepare("SELECT value FROM app_metadata WHERE key = 'schema_version'").get()?.value,
    };
  } finally {
    db.close();
  }
}

async function main() {
  if (process.platform !== "darwin") {
    console.log("Skipping packaged parity smoke outside macOS");
    return;
  }
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Packaged Electron app missing: ${executablePath}`);
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-electron-parity-"));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-electron-parity-files-"));
	  const pageTitle = `Electron Parity ${crypto.randomUUID().slice(0, 8)}`;
	  const pageBody = "Electron parity body survives packaged reopen";
	  const backupPath = path.join(workDir, "shelf-parity-backup.json");
	  const pdfPath = path.join(workDir, "parity-doc.pdf");
  fs.writeFileSync(pdfPath, tinyPdfFixture);

  let first = await launchApp(userDataDir);
  try {
    await first.window.getByText("New page").click();
    await first.window.getByText("Blank page").click();
    await first.window.locator("textarea[placeholder='Untitled']").fill(pageTitle);
    await first.window.locator('[contenteditable="true"]').first().click();
    await first.window.keyboard.type(pageBody);

    await waitForPageRecord(first.window, pageTitle, pageBody);

    await first.window.getByRole("button", { name: "Search" }).click();
    await first.window.getByPlaceholder("Search pages...").fill("packaged reopen");
    await first.window.waitForSelector(".on-modal-panel", { timeout: 10000 });
    await waitForBodyText(first.window, pageTitle);

	    await first.window.evaluate(async ({ backupPath, pdfPath }) => {
	      async function expectTrustedDialogError(command, args) {
	        try {
	          await window.openNotion.invoke(command, args);
	          throw new Error(`${command} unexpectedly succeeded`);
	        } catch (error) {
	          if (!String(error?.message || error).includes("trusted file dialog")) {
	            throw error;
	          }
	        }
	      }
	      await expectTrustedDialogError("export_backup", { path: backupPath, exportedAt: new Date().toISOString() });
	      await expectTrustedDialogError("import_backup", { path: backupPath, importedAt: new Date().toISOString() });
	      await expectTrustedDialogError("import_studio_document", {
	        documentId: crypto.randomUUID(),
	        notePageId: crypto.randomUUID(),
	        sourcePath: pdfPath,
	        importedAt: new Date().toISOString(),
	      });
	    }, { backupPath, pdfPath });

	    await invoke(first.window, "create_studio_project", {
	      id: crypto.randomUUID(),
	      name: "Parity Project",
	      createdAt: new Date().toISOString(),
	    });
	  } finally {
    await first.app.close();
  }

  const second = await launchApp(userDataDir);
  try {
    await waitForBodyText(second.window, pageTitle);
    await second.window.getByRole("button", { name: "Search" }).click();
    await second.window.getByPlaceholder("Search pages...").fill("packaged reopen");
    await waitForBodyText(second.window, pageBody);
    await second.window.keyboard.press("Escape");

	    const errorBoundaryVisible = await second.window.getByText("Something went wrong.").isVisible().catch(() => false);
	    assert(!errorBoundaryVisible, "App rendered error boundary");
    await second.window.screenshot({ path: path.join(os.tmpdir(), "shelf-electron-parity-smoke.png"), fullPage: true });
  } finally {
    await second.app.close();
  }

  assert(
    relevantConsoleMessages(first.consoleMessages).length === 0,
    `First launch console errors: ${relevantConsoleMessages(first.consoleMessages).join("\n")}`
  );
  assert(
    relevantConsoleMessages(second.consoleMessages).length === 0,
    `Second launch console errors: ${relevantConsoleMessages(second.consoleMessages).join("\n")}`
  );

  const dbState = readDb(userDataDir);
  assert(dbState.schemaVersion === "2", "Unexpected schema version");
	  assert(dbState.pages.filter((page) => page.title === pageTitle).length >= 1, "Created page missing from DB");
	  assert(dbState.pages.some((page) => page.search_text?.includes(pageBody)), "Created page body missing from DB");
	  assert(dbState.studioDocuments.length === 0, "Raw Studio import should not create document rows");

  console.log(`Electron parity smoke passed: ${userDataDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
