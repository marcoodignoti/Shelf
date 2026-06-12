const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const appDir = path.join(root, "dist-electron", "mac-arm64", "Shelf.app");
const dmgPath = path.join(root, "dist-electron", `Shelf_${packageJson.version}_arm64.dmg`);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function runResult(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function assertDarwin() {
  if (process.platform !== "darwin") {
    throw new Error("macOS DMG packaging requires darwin");
  }
}

function assertPackagedApp() {
  const executablePath = path.join(appDir, "Contents", "MacOS", "Shelf");
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Packaged Electron app missing: ${executablePath}`);
  }
}

function createDmgStagingDir() {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-dmg-"));
  const stagedAppDir = path.join(stagingDir, "Shelf.app");
  run("ditto", ["--norsrc", appDir, stagedAppDir]);
  run("xattr", ["-cr", stagedAppDir]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", stagedAppDir]);
  fs.symlinkSync("/Applications", path.join(stagingDir, "Applications"));
  return stagingDir;
}

assertDarwin();
assertPackagedApp();

fs.rmSync(dmgPath, { force: true });
run("xattr", ["-cr", appDir]);

let lastCreateStatus = 1;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const stagingDir = createDmgStagingDir();
  try {
    fs.rmSync(dmgPath, { force: true });
    lastCreateStatus = runResult("hdiutil", [
      "create",
      "-volname",
      "Shelf",
      "-srcfolder",
      stagingDir,
      "-ov",
      "-format",
      "UDZO",
      dmgPath,
    ]);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  if (lastCreateStatus === 0) break;
  if (attempt < 3) {
    console.warn(`hdiutil create failed with exit code ${lastCreateStatus}; retrying (${attempt + 1}/3)`);
    sleep(2000);
  }
}

if (lastCreateStatus !== 0) {
  throw new Error(`hdiutil create failed with exit code ${lastCreateStatus}`);
}

run("hdiutil", ["verify", dmgPath]);

console.log(`Packaged ${dmgPath}`);
