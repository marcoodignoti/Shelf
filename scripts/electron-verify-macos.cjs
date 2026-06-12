const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const appDir = path.join(root, "dist-electron", "mac-arm64", "Shelf.app");
const executablePath = path.join(appDir, "Contents", "MacOS", "Shelf");
const dmgPath = path.join(root, "dist-electron", `Shelf_${packageJson.version}_arm64.dmg`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "pipe", encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${output ? `\n${output}` : ""}`);
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function plistValue(key) {
  return run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(appDir, "Contents", "Info.plist")]);
}

function verifyDmgMount() {
  const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-dmg-mount-"));
  let mounted = false;
  try {
    run("hdiutil", ["attach", dmgPath, "-mountpoint", mountPoint, "-nobrowse", "-readonly"]);
    mounted = true;
    const mountedAppDir = path.join(mountPoint, "Shelf.app");
    assert(fs.existsSync(path.join(mountedAppDir, "Contents", "MacOS", "Shelf")), "Mounted DMG is missing Shelf.app");
    assert(fs.existsSync(path.join(mountPoint, "Applications")), "Mounted DMG is missing Applications shortcut");
    run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", mountedAppDir]);
  } finally {
    if (mounted) {
      run("hdiutil", ["detach", mountPoint], { stdio: "ignore" });
    }
    fs.rmSync(mountPoint, { recursive: true, force: true });
  }
}

if (process.platform !== "darwin") {
  console.log("Skipping macOS release verification outside darwin");
  process.exit(0);
}

assert(fs.existsSync(executablePath), `Packaged app executable missing: ${executablePath}`);
fs.accessSync(executablePath, fs.constants.X_OK);
assert(fs.existsSync(dmgPath), `DMG artifact missing: ${dmgPath}`);
assert(fs.statSync(dmgPath).size > 1024 * 1024, `DMG artifact is unexpectedly small: ${dmgPath}`);
assert(plistValue("CFBundleName") === "Shelf", "Unexpected CFBundleName");
assert(plistValue("CFBundleIdentifier") === "com.marcodignoti.shelf", "Unexpected CFBundleIdentifier");
assert(plistValue("CFBundleShortVersionString") === packageJson.version, "Unexpected CFBundleShortVersionString");
run("hdiutil", ["verify", dmgPath]);
verifyDmgMount();

console.log(`macOS release artifact verified: ${dmgPath}`);
