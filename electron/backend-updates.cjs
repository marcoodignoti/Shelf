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
  function emitDownloadProgress(onProgress, progress) {
    if (typeof onProgress !== "function") return;
    onProgress(progress);
  }

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
      // Drop tokens that no longer appear in the freshly verified manifest
      // (e.g. a new release shipped with different URLs/checksums), but keep
      // existing tokens for downloads that are unchanged. This makes a manifest
      // re-fetch idempotent, so concurrent update checks (auto-notice + manual
      // settings check, or an in-flight download) cannot invalidate a token
      // that the renderer is still holding.
      const nextVerified = new Map();
      for (const key of Object.keys(downloads)) {
        const download = trustedUpdateDownload(downloads[key]);
        if (!download) continue;
        const fingerprint = `${download.url}\0${download.sha256}`;
        let downloadToken;
        const existingToken = context.verifiedDownloadsByFingerprint?.get(fingerprint);
        if (existingToken && context.verifiedUpdateDownloads.has(existingToken)) {
          downloadToken = existingToken;
        } else {
          downloadToken = crypto
            .randomBytes(UPDATE_DOWNLOAD_TOKEN_BYTES)
            .toString("base64url");
        }
        nextVerified.set(downloadToken, download);
        downloads[key] = { ...downloads[key], downloadToken };
      }
      context.verifiedUpdateDownloads.clear();
      for (const [token, download] of nextVerified) {
        context.verifiedUpdateDownloads.set(token, download);
      }
      context.verifiedDownloadsByFingerprint = new Map(
        [...nextVerified].map(([token, download]) => [
          `${download.url}\0${download.sha256}`,
          token,
        ]),
      );
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
      return verified;
    },

    async downloadUpdateArtifact({
      url,
      sha256,
      downloadToken,
      download_token,
      downloadId,
      download_id,
      onProgress,
    }) {
      const verifiedDownloadToken = String(downloadToken ?? download_token ?? "").trim();
      const verifiedDownload = updateBackend.verifiedUpdateDownload({
        downloadToken: verifiedDownloadToken,
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
      const activeDownloadId = String(downloadId ?? download_id ?? "").trim();
      const abortController = new AbortController();
      if (activeDownloadId) {
        context.activeUpdateDownloads.set(activeDownloadId, abortController);
      }
      fs.mkdirSync(context.downloadsDir, { recursive: true });
      const finalPath = path.join(context.downloadsDir, fileName);
      const tempPath = path.join(
        context.downloadsDir,
        `.${fileName}.${process.pid}.${Date.now()}.download`,
      );
      let bytes = 0;

      try {
        const timeoutSignal = AbortSignal.timeout(600_000);
        const signal = AbortSignal.any
          ? AbortSignal.any([abortController.signal, timeoutSignal])
          : abortController.signal;
        const response = await fetch(parsed.toString(), {
          headers: { accept: "application/octet-stream" },
          signal,
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
        const totalBytes =
          Number.isFinite(contentLength) && contentLength > 0
            ? contentLength
            : null;
        const startedAt = Date.now();
        let lastProgressAt = 0;
        const progressBase = {
          url: parsed.toString(),
          sha256: expectedSha256,
          totalBytes,
        };

        const reportProgress = (status) => {
          const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0);
          const bytesPerSecond =
            elapsedSeconds > 0 && bytes > 0 ? bytes / elapsedSeconds : null;
          const remainingBytes =
            totalBytes && totalBytes > bytes ? totalBytes - bytes : 0;
          const estimatedSecondsRemaining =
            bytesPerSecond && remainingBytes > 0
              ? remainingBytes / bytesPerSecond
              : null;
          emitDownloadProgress(onProgress, {
            ...progressBase,
            bytes,
            percent: totalBytes ? Math.min(100, (bytes / totalBytes) * 100) : null,
            bytesPerSecond,
            estimatedSecondsRemaining,
            status,
          });
        };

        reportProgress("downloading");

        await pipeline(
          Readable.fromWeb(response.body),
          async function* verifyChunks(source) {
            for await (const chunk of source) {
              const buffer = Buffer.from(chunk);
              bytes += buffer.length;
              if (bytes > UPDATE_ARTIFACT_MAX_BYTES)
                throw new Error("Update download is too large");
              hash.update(buffer);
              const now = Date.now();
              if (now - lastProgressAt >= 250) {
                lastProgressAt = now;
                reportProgress("downloading");
              }
              yield buffer;
            }
          },
          fs.createWriteStream(tempPath, { flags: "w" }),
        );

        reportProgress("verifying");

        const actualSha256 = hash.digest("hex");
        if (actualSha256 !== expectedSha256) {
          throw new Error("Update download checksum mismatch");
        }

        fs.rmSync(finalPath, { force: true });
        fs.renameSync(tempPath, finalPath);
        const error = await context.openPath(finalPath);
        if (error) throw new Error(error);
        if (verifiedDownloadToken) {
          context.verifiedUpdateDownloads.delete(verifiedDownloadToken);
          context.verifiedDownloadsByFingerprint?.delete(
            `${verifiedDownload.url}\0${verifiedDownload.sha256}`,
          );
        }
        reportProgress("done");
        return { path: finalPath, bytes, sha256: actualSha256 };
      } catch (error) {
        fs.rmSync(tempPath, { force: true });
        if (abortController.signal.aborted) {
          return {
            cancelled: true,
            bytes,
            sha256: expectedSha256,
          };
        }
        throw error;
      } finally {
        if (activeDownloadId) {
          context.activeUpdateDownloads.delete(activeDownloadId);
        }
      }
    },

    cancelUpdateDownload({ downloadId, download_id }) {
      const activeDownloadId = String(downloadId ?? download_id ?? "").trim();
      if (!activeDownloadId) return { cancelled: false };
      const abortController = context.activeUpdateDownloads.get(activeDownloadId);
      if (!abortController) return { cancelled: false };
      abortController.abort();
      context.activeUpdateDownloads.delete(activeDownloadId);
      return { cancelled: true };
    },
  };

  return updateBackend;
}

module.exports = { createUpdateBackend };
