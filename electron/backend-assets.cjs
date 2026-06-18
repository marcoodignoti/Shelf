const fs = require("node:fs");
const path = require("node:path");
const {
  COVER_IMAGE_MAX_BYTES,
  PROFILE_METADATA_KEYS,
  ensurePrivateDirectory,
  safeStorageId,
  safeFileStem,
  validatedCoverExtension,
  validatedEditorImageExtension,
  validatedEditorImageSource,
  validatedEditorVideoExtension,
  validatedEditorVideoSource,
} = require("./backend-helpers.cjs");

function bytesToBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return Buffer.from(bytes || []);
}

function createAssetBackend(context) {
  return {
    importProfileAvatar({ sourcePath, source_path }) {
      const source = sourcePath ?? source_path;
      const avatarsDir = path.join(context.appConfigDir, "avatars");
      ensurePrivateDirectory(avatarsDir);
      const extension = validatedCoverExtension(source, COVER_IMAGE_MAX_BYTES);
      const destination = path.join(
        avatarsDir,
        `profile-${Date.now()}.${extension}`,
      );
      const previousPath = context.readMetadataValue(
        PROFILE_METADATA_KEYS.avatarPath,
      );
      fs.copyFileSync(source, destination);
      context.writeMetadataValue(PROFILE_METADATA_KEYS.avatarPath, destination);
      if (previousPath && previousPath !== destination) {
        try {
          const resolved = path.resolve(previousPath);
          if (
            resolved.startsWith(avatarsDir + path.sep) ||
            resolved === avatarsDir
          ) {
            fs.rmSync(resolved, { force: true });
          }
        } catch {
          // A failed delete must not fail the command.
        }
      }
      return destination;
    },

    importCoverImage({ sourcePath, source_path, pageId, page_id }) {
      const source = sourcePath ?? source_path;
      const pageIdValue = pageId ?? page_id;
      const coversDir = path.join(context.appConfigDir, "covers");
      ensurePrivateDirectory(coversDir);
      const extension = validatedCoverExtension(source, COVER_IMAGE_MAX_BYTES);
      const safePageId = String(pageIdValue ?? "").replace(
        /[^a-zA-Z0-9-]/g,
        "",
      );
      const destination = path.join(
        coversDir,
        `${safePageId}-${Date.now()}.${extension}`,
      );
      fs.copyFileSync(source, destination);
      return destination;
    },

    importEditorImage({
      pageId,
      page_id,
      fileName,
      file_name,
      sourcePath,
      source_path,
      bytes,
    }) {
      const pageIdValue = pageId ?? page_id;
      const source = sourcePath ?? source_path;
      const sourceValue = source ? String(source) : null;
      const fileNameValue = fileName ?? file_name ?? "image";
      const imagesDir = path.join(
        context.appConfigDir,
        "editor-images",
        safeStorageId(pageIdValue),
      );
      ensurePrivateDirectory(imagesDir);
      const buffer = bytesToBuffer(bytes);
      const extension = sourceValue
        ? validatedEditorImageSource(sourceValue)
        : validatedEditorImageExtension(fileNameValue, buffer);
      const destination = path.join(
        imagesDir,
        `${Date.now()}-${safeFileStem(sourceValue ? path.basename(sourceValue) : fileNameValue)}.${extension}`,
      );
      if (sourceValue) {
        fs.copyFileSync(sourceValue, destination);
      } else {
        fs.writeFileSync(destination, buffer);
      }
      return destination;
    },

    importEditorVideo({
      pageId,
      page_id,
      fileName,
      file_name,
      sourcePath,
      source_path,
      bytes,
    }) {
      const pageIdValue = pageId ?? page_id;
      const source = sourcePath ?? source_path;
      const sourceValue = source ? String(source) : null;
      const fileNameValue = fileName ?? file_name ?? "video";
      const videosDir = path.join(
        context.appConfigDir,
        "editor-videos",
        safeStorageId(pageIdValue),
      );
      ensurePrivateDirectory(videosDir);
      const buffer = bytesToBuffer(bytes);
      const extension = sourceValue
        ? validatedEditorVideoSource(sourceValue)
        : validatedEditorVideoExtension(fileNameValue, buffer);
      const destination = path.join(
        videosDir,
        `${Date.now()}-${safeFileStem(sourceValue ? path.basename(sourceValue) : fileNameValue)}.${extension}`,
      );
      if (sourceValue) {
        fs.copyFileSync(sourceValue, destination);
      } else {
        fs.writeFileSync(destination, buffer);
      }
      return destination;
    },
  };
}

module.exports = { createAssetBackend };
