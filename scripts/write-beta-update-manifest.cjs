const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packageJson = require(path.join(root, "package.json"));

function env(name, fallback = "") {
  return process.env[name] && process.env[name].trim() ? process.env[name].trim() : fallback;
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

const version = env("OPENNOTION_UPDATE_VERSION", packageJson.version);
const tag = env("OPENNOTION_UPDATE_TAG", `v${version}`);
const owner = env("OPENNOTION_GITHUB_OWNER", "marcoodignoti");
const repo = env("OPENNOTION_GITHUB_REPO", "OpenNotion");
const baseUrl = `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tag)}`;
const macArtifact = `OpenNotion_${version}_arm64.dmg`;
const winArtifact = `OpenNotion_${version}_win-x64.zip`;
const outputPath = path.resolve(root, env("OPENNOTION_UPDATE_MANIFEST_OUT", "dist-electron/beta-update.json"));

const manifest = {
  version,
  channel: env("OPENNOTION_UPDATE_CHANNEL", "beta"),
  publishedAt: env("OPENNOTION_UPDATE_PUBLISHED_AT", new Date().toISOString()),
  title: env("OPENNOTION_UPDATE_TITLE", `OpenNotion ${version}`),
  summary: env("OPENNOTION_UPDATE_SUMMARY", "New beta build ready for testers."),
  changes: changesFromEnv(),
  downloads: {
    macosArm64: {
      url: `${baseUrl}/${macArtifact}`,
      label: "macOS Apple Silicon",
      ...(fileSizeLabel(path.join(root, "dist-electron", macArtifact)) ? { size: fileSizeLabel(path.join(root, "dist-electron", macArtifact)) } : {}),
    },
    windowsX64: {
      url: `${baseUrl}/${winArtifact}`,
      label: "Windows x64 portable zip",
      ...(fileSizeLabel(path.join(root, "dist-electron", winArtifact)) ? { size: fileSizeLabel(path.join(root, "dist-electron", winArtifact)) } : {}),
    },
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
