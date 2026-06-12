const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));
const electronDist = path.join(root, "node_modules", "electron", "dist");
const outputDir = path.join(root, "dist-electron", "win-x64", "Shelf");
const resourcesDir = path.join(outputDir, "resources");
const appResourcesDir = path.join(resourcesDir, "app");
const appIcon = path.join(root, "assets", "app-icon.ico");

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, { recursive: true });
}

function env(name, fallback = "") {
  return process.env[name] && process.env[name].trim() ? process.env[name].trim() : fallback;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

if (process.platform !== "win32") {
  throw new Error("Windows packaging requires win32");
}

function windowsVersion(version) {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4).map((part) => (Number.isFinite(part) ? part : 0)).join(".");
}

function signWindowsExecutable(executablePath) {
  const certificatePath = env("SHELF_WINDOWS_PFX_PATH", env("OPENNOTION_WINDOWS_PFX_PATH"));
  const certificateSha1 = env("SHELF_WINDOWS_CERTIFICATE_SHA1", env("OPENNOTION_WINDOWS_CERTIFICATE_SHA1"));
  if (!certificatePath && !certificateSha1) return;

  const args = [
    "sign",
    "/fd",
    "SHA256",
    "/td",
    "SHA256",
    "/tr",
    env("SHELF_WINDOWS_TIMESTAMP_URL", env("OPENNOTION_WINDOWS_TIMESTAMP_URL", "http://timestamp.digicert.com")),
  ];

  if (certificatePath) {
    args.push("/f", path.resolve(root, certificatePath));
    const password = env("SHELF_WINDOWS_PFX_PASSWORD", env("OPENNOTION_WINDOWS_PFX_PASSWORD"));
    if (password) args.push("/p", password);
  } else {
    args.push("/sha1", certificateSha1);
  }

  args.push(executablePath);
  run(env("SHELF_SIGNTOOL_PATH", env("OPENNOTION_SIGNTOOL_PATH", "signtool.exe")), args);
}

async function main() {
  const { rcedit } = await import("rcedit");

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outputDir), { recursive: true });
  copyDirectory(electronDist, outputDir);

  const electronExe = path.join(outputDir, "electron.exe");
  const shelfExe = path.join(outputDir, "Shelf.exe");
  if (!fs.existsSync(electronExe)) {
    throw new Error(`Electron executable missing: ${electronExe}`);
  }
  fs.renameSync(electronExe, shelfExe);

  await rcedit(shelfExe, {
    icon: appIcon,
    "file-version": windowsVersion(packageJson.version),
    "product-version": windowsVersion(packageJson.version),
    "version-string": {
      CompanyName: packageJson.author,
      FileDescription: "Shelf",
      InternalFilename: "Shelf.exe",
      OriginalFilename: "Shelf.exe",
      ProductName: "Shelf",
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
        name: "shelf",
        version: packageJson.version,
        description: packageJson.description,
        author: packageJson.author,
        main: "electron/main.cjs",
      },
      null,
      2
    )
  );

  signWindowsExecutable(shelfExe);
  console.log(`Packaged ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
