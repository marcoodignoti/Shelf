const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const electronDist = path.join(root, "node_modules", "electron", "dist");
const outputDir = path.join(root, "dist-electron", "win-x64", "OpenNotion");
const resourcesDir = path.join(outputDir, "resources");
const appResourcesDir = path.join(resourcesDir, "app");
const appIcon = path.join(root, "assets", "app-icon.ico");

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, { recursive: true });
}

if (process.platform !== "win32") {
  throw new Error("Windows packaging requires win32");
}

function windowsVersion(version) {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4).map((part) => (Number.isFinite(part) ? part : 0)).join(".");
}

async function main() {
  const { rcedit } = await import("rcedit");

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  copyDirectory(electronDist, outputDir);

  const electronExe = path.join(outputDir, "electron.exe");
  const openNotionExe = path.join(outputDir, "OpenNotion.exe");
  if (!fs.existsSync(electronExe)) {
    throw new Error(`Electron executable missing: ${electronExe}`);
  }
  fs.renameSync(electronExe, openNotionExe);

  await rcedit(openNotionExe, {
    icon: appIcon,
    "file-version": windowsVersion(packageJson.version),
    "product-version": windowsVersion(packageJson.version),
    "version-string": {
      CompanyName: packageJson.author,
      FileDescription: "OpenNotion",
      InternalFilename: "OpenNotion.exe",
      OriginalFilename: "OpenNotion.exe",
      ProductName: "OpenNotion",
    },
  });

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
        version: packageJson.version,
        description: packageJson.description,
        author: packageJson.author,
        main: "electron/main.cjs",
      },
      null,
      2
    )
  );

  console.log(`Packaged ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
