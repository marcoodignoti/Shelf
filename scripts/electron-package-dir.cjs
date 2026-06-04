const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const electronApp = path.join(root, "node_modules", "electron", "dist", "Electron.app");
const outputDir = path.join(root, "dist-electron", "mac-arm64");
const workingOutputDir =
  process.platform === "darwin" ? fs.mkdtempSync(path.join(os.tmpdir(), "opennotion-package-")) : outputDir;
const appDir = path.join(workingOutputDir, "OpenNotion.app");
const finalAppDir = path.join(outputDir, "OpenNotion.app");
const resourcesDir = path.join(appDir, "Contents", "Resources");
const appResourcesDir = path.join(resourcesDir, "app");
const appIcon = path.join(root, "assets", "app-icon.icns");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, { recursive: true });
}

function copyAppBundle(source, destination) {
  if (process.platform === "darwin") {
    run("ditto", [source, destination]);
    return;
  }
  copyDirectory(source, destination);
}

fs.rmSync(path.join(root, "dist-electron"), { recursive: true, force: true });
fs.mkdirSync(workingOutputDir, { recursive: true });
copyAppBundle(electronApp, appDir);

const macOsDir = path.join(appDir, "Contents", "MacOS");
fs.renameSync(path.join(macOsDir, "Electron"), path.join(macOsDir, "OpenNotion"));

fs.rmSync(appResourcesDir, { recursive: true, force: true });
fs.mkdirSync(appResourcesDir, { recursive: true });
copyDirectory(path.join(root, "dist"), path.join(appResourcesDir, "dist"));
copyDirectory(path.join(root, "electron"), path.join(appResourcesDir, "electron"));
copyDirectory(path.join(root, "assets"), path.join(appResourcesDir, "assets"));
fs.copyFileSync(appIcon, path.join(resourcesDir, "app-icon.icns"));
fs.writeFileSync(
  path.join(appResourcesDir, "package.json"),
  JSON.stringify(
    {
      name: "opennotion",
      version: "0.1.0",
      description: "Local-first Notion-style workspace.",
      author: "Marco Dignoti",
      main: "electron/main.cjs",
    },
    null,
    2
  )
);

const plist = path.join(appDir, "Contents", "Info.plist");
run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleName OpenNotion", plist]);
run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleDisplayName OpenNotion", plist]);
run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleIdentifier org.opennotion.desktop", plist]);
run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleExecutable OpenNotion", plist]);
run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleShortVersionString 0.1.0", plist]);
run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleVersion 0.1.0", plist]);
run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleIconFile app-icon", plist]);

if (process.platform === "darwin") {
  run("xattr", ["-cr", appDir]);
  run("codesign", ["--force", "--deep", "--sign", "-", appDir]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appDir]);
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  run("ditto", ["--norsrc", appDir, finalAppDir]);
  fs.rmSync(workingOutputDir, { recursive: true, force: true });
  run("xattr", ["-cr", finalAppDir]);
}

console.log(`Packaged ${finalAppDir}`);
