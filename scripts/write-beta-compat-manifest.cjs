const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function env(name, fallback = "") {
  return process.env[name] && process.env[name].trim() ? process.env[name].trim() : fallback;
}

const inputPath = path.resolve(root, env("SHELF_UPDATE_SIGNED_MANIFEST", env("OPENNOTION_UPDATE_SIGNED_MANIFEST", "dist-electron/beta-update.json")));
const outputPath = path.resolve(root, env("SHELF_UPDATE_COMPAT_MANIFEST_OUT", env("OPENNOTION_UPDATE_COMPAT_MANIFEST_OUT", "dist-electron/beta-update-compat.json")));

if (!fs.existsSync(inputPath)) {
  throw new Error(`Signed update manifest missing: ${inputPath}`);
}

const signedManifest = JSON.parse(fs.readFileSync(inputPath, "utf8"));
if (!signedManifest || typeof signedManifest !== "object" || !signedManifest.payload) {
  throw new Error(`Signed update manifest has no payload: ${inputPath}`);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(signedManifest.payload, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
