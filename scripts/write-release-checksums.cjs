const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist-electron");

// Matches the release artifacts produced by the packaging scripts.
const ARTIFACT_GLOBS = ["Shelf_*.dmg", "Shelf_*.zip", "Shelf_*_setup_*.exe"];

function sha256OfFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function listArtifacts() {
  if (!fs.existsSync(distDir)) return [];
  const entries = fs.readdirSync(distDir).filter((name) => {
    const lower = name.toLowerCase();
    return (
      (lower.endsWith(".dmg") || lower.endsWith(".zip") || lower.endsWith(".exe")) &&
      /^shelf_/i.test(name)
    );
  });
  return entries.sort();
}

function writeChecksums() {
  const artifacts = listArtifacts();
  if (artifacts.length === 0) {
    throw new Error(`No release artifacts found in ${distDir}`);
  }
  const lines = artifacts.map((name) => {
    const hash = sha256OfFile(path.join(distDir, name));
    return `${hash}  ${name}`;
  });
  const outPath = path.join(distDir, "SHA256SUMS");
  fs.writeFileSync(outPath, `${lines.join("\n")}\n`);
  console.log(`Wrote ${outPath} (${artifacts.length} entries)`);
  return { outPath, count: artifacts.length };
}

module.exports = { writeChecksums, listArtifacts, sha256OfFile };

if (require.main === module) writeChecksums();
