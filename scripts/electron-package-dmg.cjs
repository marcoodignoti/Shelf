const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const appDir = path.join(root, "dist-electron", "mac-arm64", "OpenNotion.app");
const dmgPath = path.join(root, "dist-electron", `OpenNotion_${packageJson.version}_arm64.dmg`);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function assertDarwin() {
  if (process.platform !== "darwin") {
    throw new Error("macOS DMG packaging requires darwin");
  }
}

function assertPackagedApp() {
  const executablePath = path.join(appDir, "Contents", "MacOS", "OpenNotion");
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Packaged Electron app missing: ${executablePath}`);
  }
}

function createDmgStagingDir() {
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "opennotion-dmg-"));
  const stagedAppDir = path.join(stagingDir, "OpenNotion.app");
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

const stagingDir = createDmgStagingDir();
try {
  run("hdiutil", [
    "create",
    "-volname",
    "OpenNotion",
    "-srcfolder",
    stagingDir,
    "-ov",
    "-format",
    "UDZO",
    dmgPath,
  ]);
  run("hdiutil", ["verify", dmgPath]);
} finally {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}

console.log(`Packaged ${dmgPath}`);
