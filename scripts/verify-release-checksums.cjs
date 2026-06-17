const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function sha256OfFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// Look up the expected hash for `basename` inside a SHA256SUMS file's contents.
// Format: "<64-hex>  <filename>\n" per line. Returns null if not found.
function findHashInSums(basename, sumsContents) {
  for (const line of String(sumsContents).split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match && match[2].trim() === basename) return match[1].toLowerCase();
  }
  return null;
}

// Returns true iff the file at filePath hashes to expectedHash (64-hex).
function verifyFileAgainstHash(filePath, expectedHash) {
  const expected = String(expectedHash ?? "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(expected)) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  return sha256OfFile(filePath).toLowerCase() === expected;
}

// CLI: node scripts/verify-release-checksums.cjs <file> [sha256-or-SHA256SUMS-path]
function main() {
  const [, , filePath, hashArg] = process.argv;
  if (!filePath || !hashArg) {
    console.error("Usage: node scripts/verify-release-checksums.cjs <file> <sha256 | SHA256SUMS-path>");
    process.exit(2);
  }

  let expectedHash;
  const trimmed = String(hashArg).trim();
  if (SHA256_PATTERN.test(trimmed)) {
    expectedHash = trimmed;
  } else if (fs.existsSync(trimmed)) {
    expectedHash = findHashInSums(path.basename(filePath), fs.readFileSync(trimmed, "utf8"));
    if (!expectedHash) {
      console.error(`No checksum for ${path.basename(filePath)} in ${trimmed}`);
      process.exit(1);
    }
  } else {
    console.error(`Second argument is not a 64-hex SHA-256 or an existing SHA256SUMS file: ${trimmed}`);
    process.exit(2);
  }

  if (verifyFileAgainstHash(filePath, expectedHash)) {
    console.log(`OK  ${path.basename(filePath)} matches ${expectedHash}`);
    process.exit(0);
  }
  console.error(`FAIL  ${path.basename(filePath)} does NOT match ${expectedHash}`);
  process.exit(1);
}

module.exports = { sha256OfFile, findHashInSums, verifyFileAgainstHash, main };

if (require.main === module) main();
