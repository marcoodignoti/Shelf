const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const root = path.resolve(__dirname, "..");
const executablePath = path.join(root, "dist-electron", "mac-arm64", "OpenNotion.app", "Contents", "MacOS", "OpenNotion");
const screenshotPath = path.join(os.tmpdir(), "opennotion-electron-visual-smoke.png");

async function main() {
  if (process.platform !== "darwin") {
    console.log("Skipping packaged visual smoke outside macOS");
    return;
  }
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Packaged Electron app missing: ${executablePath}`);
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "opennotion-electron-smoke-"));
  const app = await electron.launch({
    executablePath,
    env: {
      ...process.env,
      OPENNOTION_USER_DATA_DIR: userDataDir,
      ELECTRON_ENABLE_LOGGING: "1",
    },
  });

  const consoleMessages = [];
  try {
    const window = await app.firstWindow({ timeout: 15000 });
    window.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));
    window.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));

    await window.waitForLoadState("domcontentloaded", { timeout: 15000 });
    await window.waitForTimeout(3000);

    const pageState = await window.evaluate(() => ({
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 500) ?? "",
      rootChildren: document.getElementById("root")?.childElementCount ?? 0,
      scriptSources: Array.from(document.scripts, (script) => script.src),
    }));
    await window.screenshot({ path: screenshotPath, fullPage: true });

    if (pageState.rootChildren < 1 || pageState.bodyText.length < 20) {
      throw new Error(
        `Electron visual smoke failed: ${JSON.stringify({ pageState, consoleMessages, screenshotPath }, null, 2)}`
      );
    }

    console.log(`Electron visual smoke passed: ${screenshotPath}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
