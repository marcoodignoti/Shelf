#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { electronDevEnv } = require("./electron-dev-paths.cjs");

const root = path.resolve(__dirname, "..");
const rendererUrl = process.env.ELECTRON_RENDERER_URL || "http://127.0.0.1:1420";
const rendererTimeoutMs = Number(process.env.ELECTRON_RENDERER_TIMEOUT_MS || 90_000);
const renderer = new URL(rendererUrl);
const electronDir = path.join(root, "electron");
const viteCacheDir = path.join(root, "node_modules", ".vite");
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const electronBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");

let viteProcess = null;
let electronProcess = null;
let watcher = null;
let restartTimer = null;
let restartingElectron = false;
let shuttingDown = false;

function spawnProcess(command, args, options = {}) {
  return spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    detached: process.platform !== "win32",
    shell: process.platform === "win32",
    ...options,
    env: {
      ...process.env,
      ...options.env,
    },
  });
}

function isRendererListening(url) {
  return new Promise((resolve) => {
    const target = new URL(url);
    const socket = net.createConnection({
      host: target.hostname,
      port: Number(target.port || (target.protocol === "https:" ? 443 : 80)),
    });

    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.on("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function waitForRenderer(url, timeoutMs = 30_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on("error", () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`renderer did not start at ${url}`));
          return;
        }
        setTimeout(probe, 250);
      });

      request.setTimeout(1_000, () => {
        request.destroy();
      });
    };

    probe();
  });
}

function removeStaleViteOptimizerTemps() {
  if (!fs.existsSync(viteCacheDir)) return;
  for (const entry of fs.readdirSync(viteCacheDir)) {
    if (!entry.startsWith("deps_temp_")) continue;
    fs.rmSync(path.join(viteCacheDir, entry), { recursive: true, force: true });
  }
}

function startElectron() {
  if (shuttingDown) return;
  electronProcess = spawnProcess(electronBin, ["."], {
    env: electronDevEnv(process.env, root, rendererUrl),
  });

  electronProcess.on("exit", () => {
    electronProcess = null;
    if (restartingElectron && !shuttingDown) {
      restartingElectron = false;
      startElectron();
    }
  });
}

function restartElectron() {
  if (shuttingDown) return;
  restartingElectron = true;
  if (electronProcess) {
    electronProcess.kill();
    return;
  }
  restartingElectron = false;
  startElectron();
}

function queueElectronRestart() {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    console.log("[electron:dev] electron files changed, restarting main process");
    restartElectron();
  }, 150);
}

function signalChild(child, signal, force = false) {
  if (!child || (!force && child.killed)) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to killing only the direct child.
    }
  }
  child.kill(signal);
}

function stopChild(child) {
  if (!child || child.killed) return;
  signalChild(child, "SIGTERM");
  setTimeout(() => signalChild(child, "SIGKILL", true), 1_000).unref();
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  watcher?.close();
  stopChild(electronProcess);
  stopChild(viteProcess);
  process.exitCode = code;
}

async function run() {
  if (await isRendererListening(rendererUrl)) {
    throw new Error(`[electron:dev] renderer URL already in use: ${rendererUrl}. Stop the old dev server first.`);
  }

  removeStaleViteOptimizerTemps();
  viteProcess = spawnProcess(npmBin, [
    "run",
    "dev",
    "--",
    "--host",
    renderer.hostname,
    "--port",
    renderer.port || "1420",
    "--force",
  ]);
  viteProcess.on("exit", (code) => {
    if (!shuttingDown) shutdown(code ?? 1);
  });

  await waitForRenderer(rendererUrl, rendererTimeoutMs);
  startElectron();

  watcher = fs.watch(electronDir, (_eventType, filename) => {
    if (filename && filename.endsWith(".cjs")) {
      queueElectronRestart();
    }
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

run().catch((error) => {
  console.error(error);
  shutdown(1);
});
