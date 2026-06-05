const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));

function env(name, fallback = "") {
  return process.env[name] && process.env[name].trim() ? process.env[name].trim() : fallback;
}

function requiredEnv(name) {
  const value = env(name);
  if (!value) {
    throw new Error(`Missing required ${name}. Generate an Ed25519 update key and keep the private key outside git.`);
  }
  return value;
}

function normalizePem(value) {
  return String(value).replace(/\\n/g, "\n").trim();
}

function privateKeyPem() {
  const keyPath = env("OPENNOTION_UPDATE_PRIVATE_KEY_PATH");
  if (keyPath) return normalizePem(fs.readFileSync(path.resolve(root, keyPath), "utf8"));
  return normalizePem(requiredEnv("OPENNOTION_UPDATE_PRIVATE_KEY_PEM"));
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("Manifest contains unsupported data");
}

function changesFromEnv() {
  const raw = env("OPENNOTION_UPDATE_CHANGES");
  if (!raw) {
    return [
      "Beta stability improvements.",
      "Small UI and workflow fixes.",
      "Tester feedback cleanup.",
    ];
  }

  return raw
    .split(/\r?\n|;/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function fileSizeLabel(filePath) {
  if (!fs.existsSync(filePath)) return undefined;
  const bytes = fs.statSync(filePath).size;
  const megabytes = bytes / 1024 / 1024;
  return `${Math.max(1, Math.round(megabytes))} MB`;
}

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function optionalDownload(filePath, download) {
  if (!fs.existsSync(filePath)) {
    if (env("OPENNOTION_UPDATE_REQUIRE_ALL_ARTIFACTS") === "1") {
      throw new Error(`Missing release artifact for manifest: ${filePath}`);
    }
    return undefined;
  }
  return {
    ...download,
    sha256: fileSha256(filePath),
    ...(fileSizeLabel(filePath) ? { size: fileSizeLabel(filePath) } : {}),
  };
}

const version = env("OPENNOTION_UPDATE_VERSION", packageJson.version);
const tag = env("OPENNOTION_UPDATE_TAG", `v${version}`);
const owner = env("OPENNOTION_GITHUB_OWNER", "marcoodignoti");
const repo = env("OPENNOTION_GITHUB_REPO", "OpenNotion");
const baseUrl = `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tag)}`;
const macArtifact = `OpenNotion_${version}_arm64.dmg`;
const winArtifact = `OpenNotion_${version}_win-x64.zip`;
const winInstallerArtifact = `OpenNotion_${version}_setup_win-x64.exe`;
const macArtifactPath = path.join(root, "dist-electron", macArtifact);
const winArtifactPath = path.join(root, "dist-electron", winArtifact);
const winInstallerArtifactPath = path.join(root, "dist-electron", winInstallerArtifact);
const outputPath = path.resolve(root, env("OPENNOTION_UPDATE_MANIFEST_OUT", "dist-electron/beta-update.json"));

const downloads = {
  macosArm64: optionalDownload(macArtifactPath, {
    url: `${baseUrl}/${macArtifact}`,
    label: "macOS Apple Silicon",
  }),
  windowsX64: optionalDownload(winArtifactPath, {
    url: `${baseUrl}/${winArtifact}`,
    label: "Windows x64 portable zip",
  }),
  windowsInstallerX64: optionalDownload(winInstallerArtifactPath, {
    url: `${baseUrl}/${winInstallerArtifact}`,
    label: "Windows x64 installer",
  }),
};

Object.keys(downloads).forEach((key) => {
  if (!downloads[key]) delete downloads[key];
});

if (Object.keys(downloads).length === 0) {
  throw new Error("At least one release artifact is required for the update manifest");
}

const manifest = {
  version,
  channel: env("OPENNOTION_UPDATE_CHANNEL", "beta"),
  publishedAt: env("OPENNOTION_UPDATE_PUBLISHED_AT", new Date().toISOString()),
  title: env("OPENNOTION_UPDATE_TITLE", `OpenNotion ${version}`),
  summary: env("OPENNOTION_UPDATE_SUMMARY", "New beta build ready for testers."),
  changes: changesFromEnv(),
  downloads,
};

const signature = crypto.sign(null, Buffer.from(canonicalJson(manifest), "utf8"), crypto.createPrivateKey(privateKeyPem()));
const signedManifest = {
  signatureAlgorithm: "ed25519",
  payload: manifest,
  signature: signature.toString("base64"),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(signedManifest, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
