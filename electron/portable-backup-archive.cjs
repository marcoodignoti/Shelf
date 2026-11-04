const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { finished } = require("node:stream/promises");
const zlib = require("node:zlib");

const PORTABLE_BACKUP_FORMAT = "shelf-portable";
const PORTABLE_BACKUP_VERSION = 1;
const PORTABLE_ASSET_PREFIX = "shelf-asset://";
const PORTABLE_BACKUP_MAX_ASSETS = 10_000;
const PORTABLE_BACKUP_MAX_TOTAL_ASSET_BYTES = 4 * 1024 * 1024 * 1024;
const PORTABLE_BACKUP_MAX_ARCHIVE_BYTES = PORTABLE_BACKUP_MAX_TOTAL_ASSET_BYTES + 64 * 1024 * 1024;
const PORTABLE_BACKUP_MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const TAR_BLOCK_BYTES = 512;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJson(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isRecord(value)) throw new Error("portable backup contains a non-JSON value");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const input = fs.createReadStream(filePath);
  for await (const chunk of input) hash.update(chunk);
  return hash.digest("hex");
}

function checksumForManifest(manifest) {
  const { checksum, ...withoutChecksum } = manifest;
  return sha256Buffer(Buffer.from(stableJson(withoutChecksum), "utf8"));
}

function portableAssetRef(assetId) {
  return `${PORTABLE_ASSET_PREFIX}${assetId}`;
}

function portableAssetId(value) {
  if (typeof value !== "string" || !value.startsWith(PORTABLE_ASSET_PREFIX)) return null;
  const id = value.slice(PORTABLE_ASSET_PREFIX.length);
  return /^asset-[0-9]{6}$/.test(id) ? id : null;
}

function assertPortableArchivePath(filePath, operation) {
  if (typeof filePath !== "string" || path.extname(filePath).toLowerCase() !== ".shelf") {
    throw new Error(`${operation} requires a .shelf archive`);
  }
}

function normalizeExtension(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(extension) ? extension : "";
}

function archivePathForAsset(assetId) {
  return `assets/${assetId}`;
}

function validateAssetDescriptor(asset) {
  if (!isRecord(asset)) throw new Error("portable backup has an invalid asset entry");
  if (typeof asset.id !== "string" || !/^asset-[0-9]{6}$/.test(asset.id)) {
    throw new Error("portable backup has an invalid asset id");
  }
  if (asset.archive_path !== archivePathForAsset(asset.id)) {
    throw new Error("portable backup has an invalid asset path");
  }
  if (typeof asset.kind !== "string" || !["covers", "editor-images", "editor-videos", "avatars", "studio-documents"].includes(asset.kind)) {
    throw new Error("portable backup has an invalid asset kind");
  }
  if (typeof asset.extension !== "string" || !/^$|^\.[a-z0-9]{1,12}$/.test(asset.extension)) {
    throw new Error("portable backup has an invalid asset extension");
  }
  if (!Number.isSafeInteger(asset.size) || asset.size < 0) {
    throw new Error("portable backup has an invalid asset size");
  }
  if (typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(asset.sha256)) {
    throw new Error("portable backup has an invalid asset checksum");
  }
}

function validatePortableManifest(manifest) {
  if (!isRecord(manifest)) throw new Error("portable backup manifest is invalid");
  if (manifest.format !== PORTABLE_BACKUP_FORMAT || manifest.version !== PORTABLE_BACKUP_VERSION) {
    throw new Error("portable backup version is not supported");
  }
  if (typeof manifest.exported_at !== "string" || manifest.exported_at.length > 512) {
    throw new Error("portable backup has an invalid export timestamp");
  }
  if (!isRecord(manifest.payload)) throw new Error("portable backup payload is invalid");
  if (!Array.isArray(manifest.assets) || manifest.assets.length > PORTABLE_BACKUP_MAX_ASSETS) {
    throw new Error("portable backup has too many assets");
  }
  if (typeof manifest.checksum !== "string" || !/^[a-f0-9]{64}$/i.test(manifest.checksum)) {
    throw new Error("portable backup manifest checksum is invalid");
  }

  const assetIds = new Set();
  let totalBytes = 0;
  for (const asset of manifest.assets) {
    validateAssetDescriptor(asset);
    if (assetIds.has(asset.id)) throw new Error("portable backup has duplicate asset ids");
    assetIds.add(asset.id);
    totalBytes += asset.size;
    if (totalBytes > PORTABLE_BACKUP_MAX_TOTAL_ASSET_BYTES) {
      throw new Error("portable backup assets are too large");
    }
  }

  if (checksumForManifest(manifest) !== manifest.checksum.toLowerCase()) {
    throw new Error("portable backup manifest checksum does not match");
  }
  return manifest;
}

function isAllowedTarPath(entryPath) {
  return entryPath === "manifest.json" || /^assets\/asset-[0-9]{6}$/.test(entryPath);
}

function writeTarString(buffer, offset, length, value) {
  const source = Buffer.from(value, "utf8");
  if (source.length > length) throw new Error("portable backup archive path is too long");
  source.copy(buffer, offset);
}

function writeTarOctal(buffer, offset, length, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("portable backup archive value is invalid");
  const octal = value.toString(8);
  if (octal.length > length - 1) throw new Error("portable backup archive value is too large");
  buffer.write(`${octal.padStart(length - 1, "0")}\0`, offset, length, "ascii");
}

function tarHeader(entryPath, size) {
  if (!isAllowedTarPath(entryPath)) throw new Error("portable backup archive path is invalid");
  const header = Buffer.alloc(TAR_BLOCK_BYTES, 0);
  writeTarString(header, 0, 100, entryPath);
  writeTarOctal(header, 100, 8, 0o600);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = 0;
  writeTarString(header, 257, 6, "ustar\0");
  writeTarString(header, 263, 2, "00");
  writeTarString(header, 265, 32, "shelf");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function readTarString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset);
  const sliceEnd = end === -1 || end > offset + length ? offset + length : end;
  return buffer.subarray(offset, sliceEnd).toString("utf8").trim();
}

function readTarOctal(buffer, offset, length) {
  const field = buffer.subarray(offset, offset + length);
  if (field[0] & 0x80) throw new Error("portable backup uses an unsupported TAR number format");
  const text = field.toString("ascii").replace(/\0/g, "").trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error("portable backup TAR number is invalid");
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) throw new Error("portable backup TAR number is too large");
  return value;
}

function parseTarHeader(header) {
  if (header.length !== TAR_BLOCK_BYTES) throw new Error("portable backup TAR header is truncated");
  const expectedChecksum = readTarOctal(header, 148, 8);
  const checksumHeader = Buffer.from(header);
  checksumHeader.fill(0x20, 148, 156);
  const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
  if (actualChecksum !== expectedChecksum) throw new Error("portable backup TAR header checksum does not match");
  const prefix = readTarString(header, 345, 155);
  const entryPath = readTarString(header, 0, 100);
  const type = header[156];
  if (prefix || !isAllowedTarPath(entryPath) || (type !== 0 && type !== "0".charCodeAt(0))) {
    throw new Error("portable backup archive contains unsupported entries");
  }
  return { path: entryPath, size: readTarOctal(header, 124, 12) };
}

function writeToStream(stream, chunk) {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

function endStream(stream, chunk = undefined) {
  return new Promise((resolve, reject) => {
    stream.end(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

async function writeTarFile(output, entryPath, source) {
  const size = Buffer.isBuffer(source) ? source.length : fs.statSync(source).size;
  await writeToStream(output, tarHeader(entryPath, size));
  if (Buffer.isBuffer(source)) {
    await writeToStream(output, source);
  } else {
    const input = fs.createReadStream(source);
    for await (const chunk of input) await writeToStream(output, chunk);
  }
  const padding = (TAR_BLOCK_BYTES - (size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
  if (padding > 0) await writeToStream(output, Buffer.alloc(padding));
}

async function createPortableArchive({ destinationPath, manifest, assetSources }) {
  assertPortableArchivePath(destinationPath, "portable backup export");
  validatePortableManifest(manifest);
  if (!(assetSources instanceof Map)) throw new Error("portable backup assets are invalid");

  const destinationDir = path.dirname(destinationPath);
  if (!fs.existsSync(destinationDir) || !fs.statSync(destinationDir).isDirectory()) {
    throw new Error("backup destination parent must be a directory");
  }
  const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(serializedManifest, "utf8") > PORTABLE_BACKUP_MAX_MANIFEST_BYTES) {
    throw new Error("portable backup manifest is too large");
  }
  const tempArchivePath = path.join(
    destinationDir,
    `.${path.basename(destinationPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const output = fs.createWriteStream(tempArchivePath, { mode: 0o600 });
  const gzip = zlib.createGzip({ mtime: 0 });
  gzip.pipe(output);
  try {
    await writeTarFile(gzip, "manifest.json", Buffer.from(serializedManifest, "utf8"));
    for (const asset of manifest.assets) {
      const sourcePath = assetSources.get(asset.id);
      if (!sourcePath || !fs.statSync(sourcePath).isFile()) {
        throw new Error("portable backup asset source is missing");
      }
      await writeTarFile(gzip, asset.archive_path, sourcePath);
    }
    await endStream(gzip, Buffer.alloc(TAR_BLOCK_BYTES * 2));
    await finished(output);
    fs.renameSync(tempArchivePath, destinationPath);
  } catch (error) {
    gzip.destroy();
    output.destroy();
    fs.rmSync(tempArchivePath, { force: true });
    throw error;
  }
}

function allZero(buffer) {
  return buffer.every((byte) => byte === 0);
}

async function extractPortableArchive({ sourcePath, stagingRoot }) {
  assertPortableArchivePath(sourcePath, "portable backup import");
  const stats = fs.statSync(sourcePath);
  if (!stats.isFile()) throw new Error("backup path must be a file");
  if (stats.size > PORTABLE_BACKUP_MAX_ARCHIVE_BYTES) {
    throw new Error("portable backup archive is too large");
  }

  fs.mkdirSync(stagingRoot, { recursive: true });
  const stageDir = fs.mkdtempSync(path.join(stagingRoot, ".shelf-import-"));
  let current = null;
  try {
    const archiveEntries = [];
    const archivePaths = new Set();
    let totalEntryBytes = 0;
    let buffer = Buffer.alloc(0);
    let archiveEnded = false;
    const input = fs.createReadStream(sourcePath).pipe(zlib.createGunzip());

    const finishCurrent = async () => {
      if (!current || current.closed) return;
      await endStream(current.output);
      await finished(current.output);
      current.closed = true;
    };

    const consume = async () => {
      while (buffer.length > 0) {
        if (archiveEnded) {
          if (!allZero(buffer)) throw new Error("portable backup archive has trailing data");
          buffer = Buffer.alloc(0);
          return;
        }
        if (!current) {
          if (buffer.length < TAR_BLOCK_BYTES) return;
          const header = buffer.subarray(0, TAR_BLOCK_BYTES);
          buffer = buffer.subarray(TAR_BLOCK_BYTES);
          if (allZero(header)) {
            archiveEnded = true;
            continue;
          }
          const entry = parseTarHeader(header);
          if (archivePaths.has(entry.path)) throw new Error("portable backup archive has duplicate entries");
          archivePaths.add(entry.path);
          totalEntryBytes += entry.size;
          if (totalEntryBytes > PORTABLE_BACKUP_MAX_TOTAL_ASSET_BYTES + PORTABLE_BACKUP_MAX_MANIFEST_BYTES) {
            throw new Error("portable backup archive is too large");
          }
          const destinationPath = path.join(stageDir, ...entry.path.split("/"));
          fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
          current = {
            ...entry,
            output: fs.createWriteStream(destinationPath, { mode: 0o600 }),
            remaining: entry.size,
            padding: (TAR_BLOCK_BYTES - (entry.size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES,
            closed: false,
          };
          archiveEntries.push(entry);
          if (current.remaining === 0) await finishCurrent();
        }
        if (current.remaining > 0) {
          const count = Math.min(current.remaining, buffer.length);
          if (count === 0) return;
          await writeToStream(current.output, buffer.subarray(0, count));
          buffer = buffer.subarray(count);
          current.remaining -= count;
          if (current.remaining > 0) return;
          await finishCurrent();
        }
        if (current.padding > 0) {
          const count = Math.min(current.padding, buffer.length);
          if (count === 0) return;
          buffer = buffer.subarray(count);
          current.padding -= count;
          if (current.padding > 0) return;
        }
        current = null;
      }
    };

    for await (const chunk of input) {
      buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);
      await consume();
    }
    await consume();
    if (current || !archiveEnded || buffer.length > 0) {
      throw new Error("portable backup archive is truncated");
    }
    if (archiveEntries.length === 0 || !archivePaths.has("manifest.json")) {
      throw new Error("portable backup archive is missing a manifest");
    }

    const manifestPath = path.join(stageDir, "manifest.json");
    const manifestStats = fs.statSync(manifestPath);
    if (!manifestStats.isFile() || manifestStats.size > PORTABLE_BACKUP_MAX_MANIFEST_BYTES) {
      throw new Error("portable backup manifest is too large");
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
      throw new Error("portable backup manifest is not valid JSON");
    }
    validatePortableManifest(manifest);

    const expectedPaths = new Set(["manifest.json", ...manifest.assets.map((asset) => asset.archive_path)]);
    if (expectedPaths.size !== archivePaths.size || [...expectedPaths].some((entryPath) => !archivePaths.has(entryPath))) {
      throw new Error("portable backup archive does not match its manifest");
    }

    const assetsById = new Map();
    for (const asset of manifest.assets) {
      const assetPath = path.join(stageDir, ...asset.archive_path.split("/"));
      const assetStats = fs.statSync(assetPath);
      if (!assetStats.isFile() || assetStats.size !== asset.size) {
        throw new Error("portable backup asset size does not match");
      }
      const checksum = await sha256File(assetPath);
      if (checksum !== asset.sha256.toLowerCase()) {
        throw new Error("portable backup asset checksum does not match");
      }
      assetsById.set(asset.id, assetPath);
    }
    return { manifest, stageDir, assetsById };
  } catch (error) {
    if (current?.output) current.output.destroy();
    fs.rmSync(stageDir, { recursive: true, force: true });
    throw error;
  }
}

function removePortableArchiveStaging(stageDir) {
  if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
}

module.exports = {
  PORTABLE_BACKUP_FORMAT,
  PORTABLE_BACKUP_VERSION,
  PORTABLE_ASSET_PREFIX,
  PORTABLE_BACKUP_MAX_ASSETS,
  PORTABLE_BACKUP_MAX_TOTAL_ASSET_BYTES,
  portableAssetRef,
  portableAssetId,
  normalizeExtension,
  checksumForManifest,
  sha256File,
  createPortableArchive,
  extractPortableArchive,
  removePortableArchiveStaging,
};
