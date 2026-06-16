const fs = require("node:fs");
const path = require("node:path");

// These names/extensions must never be shipped inside a release bundle.
// They are either local-only developer data (.shelf-dev, .opennotion-dev),
// secrets, or SQLite databases that could contain the developer's personal
// notes and Studio documents.
const EXCLUDED_NAMES = new Set([
  ".shelf-dev",
  ".opennotion-dev",
  ".secrets",
  ".git",
  "node_modules",
  ".DS_Store",
]);
// Intentionally broad: Shelf creates its SQLite database at runtime, so any
// .db/.sqlite/.sqlite3 inside the build tree is local developer data. Revisit
// this list if the app ever needs to ship a bundled read-only database.
const EXCLUDED_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);
const EXCLUDED_SUFFIXES = [".pem.local"];

function isExcludedEntry(entryPath) {
  const base = path.basename(entryPath);
  if (EXCLUDED_NAMES.has(base)) return true;
  const ext = path.extname(base).toLowerCase();
  if (EXCLUDED_EXTENSIONS.has(ext)) return true;
  if (EXCLUDED_SUFFIXES.some((suffix) => base.endsWith(suffix))) return true;
  return false;
}

function copyDirectoryFiltered(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (src) => !isExcludedEntry(src),
  });
}

function assertBundleClean(bundlePath) {
  const suspects = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (isExcludedEntry(fullPath)) {
        suspects.push(path.relative(bundlePath, fullPath));
        continue;
      }
      if (entry.isDirectory()) walk(fullPath);
    }
  }

  walk(bundlePath);

  if (suspects.length > 0) {
    throw new Error(
      `Bundle contains sensitive/dev files that must not be shipped:\n${suspects.join("\n")}`
    );
  }
}

module.exports = {
  isExcludedEntry,
  copyDirectoryFiltered,
  assertBundleClean,
};
