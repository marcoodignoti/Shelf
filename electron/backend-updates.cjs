const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const {
  UPDATE_MANIFEST_MAX_BYTES,
  UPDATE_ARTIFACT_MAX_BYTES,
  UPDATE_DOWNLOAD_TOKEN_BYTES,
  UPDATE_MANIFEST_URLS,
  UPDATE_DOWNLOAD_URL_PATTERN,
  SHA256_PATTERN,
  signedManifestPayload,
  updateArtifactFileName,
  trustedUpdateDownload,
} = require("./backend-helpers.cjs");

function createUpdateBackend(context) {
  const updateBackend = {
    async fetchUpdateManifest({ url }) {
      const parsed = new URL(String(url ?? ""));
      if (parsed.protocol !== "https:")
        throw new Error("update manifest URL must use HTTPS");
      if (!UPDATE_MANIFEST_URLS.has(parsed.toString())) {
        throw new Error("update manifest URL is not trusted");
      }

      const response = await fetch(parsed.toString(), {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });

      if (!response.ok) {
        throw new Error(`Update check failed (${response.status})`);
      }

      const contentLength = Number.parseInt(
        response.headers.get("content-length") || "0",
        10,
      );
      if (
        Number.isFinite(contentLength) &&
        contentLength > UPDATE_MANIFEST_MAX_BYTES
      ) {
        throw new Error("Update manifest is too large");
      }

      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > UPDATE_MANIFEST_MAX_BYTES) {
        throw new Error("Update manifest is too large");
      }

      let signedManifest;
      try {
        signedManifest = JSON.parse(text);
      } catch {
        throw new Error("Invalid signed update manifest");
      }
      return updateBackend.rememberVerifiedUpdateDownloads(
        signedManifestPayload(signedManifest, context.updateManifestPublicKey),
      );
    },

    rememberVerifiedUpdateDownloads(payload) {
      const manifest = structuredClone(payload);
      const downloads =
        manifest &&
        typeof manifest === "object" &&
        !Array.isArray(manifest) &&
        manifest.downloads &&
        typeof manifest.downloads === "object" &&
        !Array.isArray(manifest.downloads)
          ? manifest.downloads
          : {};
      context.verifiedUpdateDownloads.clear();
      for (const key of Object.keys(downloads)) {
        const download = trustedUpdateDownload(downloads[key]);
        if (!download) continue;
        const downloadToken = crypto
          .randomBytes(UPDATE_DOWNLOAD_TOKEN_BYTES)
          .toString("base64url");
        context.verifiedUpdateDownloads.set(downloadToken, download);
        downloads[key] = { ...downloads[key], downloadToken };
      }
      return manifest;
    },

    verifiedUpdateDownload({ downloadToken, url, sha256 }) {
      const token = String(downloadToken ?? "").trim();
      const verified = context.verifiedUpdateDownloads.get(token);
      if (!verified)
        throw new Error("update download is not linked to a verified manifest");
      const requestedUrl = String(url ?? "");
      const requestedSha256 = String(sha256 ?? "")
        .trim()
        .toLowerCase();
      if (requestedUrl !== verified.url || requestedSha256 !== verified.sha256) {
        throw new Error("update download does not match verified manifest");
      }
      context.verifiedUpdateDownloads.delete(token);
      return verified;
    },

    async downloadUpdateArtifact({
      url,
      sha256,
      downloadToken,
      download_token,
    }) {
      const verifiedDownload = updateBackend.verifiedUpdateDownload({
        downloadToken: downloadToken ?? download_token,
        url,
        sha256,
      });
      const parsed = new URL(String(url ?? ""));
      const expectedSha256 = verifiedDownload.sha256;
      if (!UPDATE_DOWNLOAD_URL_PATTERN.test(parsed.toString())) {
        throw new Error("update download URL is not trusted");
      }
      if (!SHA256_PATTERN.test(expectedSha256)) {
        throw new Error("update checksum is invalid");
      }

      const fileName = updateArtifactFileName(parsed);
      fs.mkdirSync(context.downloadsDir, { recursive: true });
      const finalPath = path.join(context.downloadsDir, fileName);
      const tempPath = path.join(
        context.downloadsDir,
        `.${fileName}.${process.pid}.${Date.now()}.download`,
      );

      try {
        const response = await fetch(parsed.toString(), {
          headers: { accept: "application/octet-stream" },
          signal: AbortSignal.timeout(600_000),
        });
        if (!response.ok)
          throw new Error(`Update download failed (${response.status})`);
        if (!response.body) throw new Error("Update download response is empty");

        const contentLength = Number.parseInt(
          response.headers.get("content-length") || "0",
          10,
        );
        if (
          Number.isFinite(contentLength) &&
          contentLength > UPDATE_ARTIFACT_MAX_BYTES
        ) {
          throw new Error("Update download is too large");
        }

        const hash = crypto.createHash("sha256");
        let bytes = 0;

        await pipeline(
          Readable.fromWeb(response.body),
          async function* verifyChunks(source) {
            for await (const chunk of source) {
              const buffer = Buffer.from(chunk);
              bytes += buffer.length;
              if (bytes > UPDATE_ARTIFACT_MAX_BYTES)
                throw new Error("Update download is too large");
              hash.update(buffer);
              yield buffer;
            }
          },
          fs.createWriteStream(tempPath, { flags: "w" }),
        );

        const actualSha256 = hash.digest("hex");
        if (actualSha256 !== expectedSha256) {
          throw new Error("Update download checksum mismatch");
        }

        fs.rmSync(finalPath, { force: true });
        fs.renameSync(tempPath, finalPath);
        const error = await context.openPath(finalPath);
        if (error) throw new Error(error);
        return { path: finalPath, bytes, sha256: actualSha256 };
      } catch (error) {
        fs.rmSync(tempPath, { force: true });
        throw error;
      }
    },
  };

  return updateBackend;
}

module.exports = { createUpdateBackend };
