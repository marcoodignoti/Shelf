const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const electronDist = path.join(root, "node_modules", "electron", "dist");
const outputDir = path.join(root, "dist-electron", "win-x64", "OpenNotion");
const resourcesDir = path.join(outputDir, "resources");
const appResourcesDir = path.join(resourcesDir, "app");

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, { recursive: true });
}

if (process.platform !== "win32") {
  throw new Error("Windows packaging requires win32");
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(outputDir), { recursive: true });
copyDirectory(electronDist, outputDir);

const electronExe = path.join(outputDir, "electron.exe");
const openNotionExe = path.join(outputDir, "OpenNotion.exe");
if (!fs.existsSync(electronExe)) {
  throw new Error(`Electron executable missing: ${electronExe}`);
}
fs.renameSync(electronExe, openNotionExe);

fs.rmSync(appResourcesDir, { recursive: true, force: true });
fs.mkdirSync(appResourcesDir, { recursive: true });
copyDirectory(path.join(root, "dist"), path.join(appResourcesDir, "dist"));
copyDirectory(path.join(root, "electron"), path.join(appResourcesDir, "electron"));
copyDirectory(path.join(root, "assets"), path.join(appResourcesDir, "assets"));
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

console.log(`Packaged ${outputDir}`);
