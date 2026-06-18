// Records a ~12s demo of the Studio workflow (PDF + linked note) from the real
// renderer with the showcase mock, then converts it to WebM + GIF via ffmpeg.
//
// Run: node scripts/capture-demo-video.mjs
//
// Outputs:
//   docs/assets/shelf-demo.webm  (small, crisp, for the landing <video>)
//   docs/assets/shelf-demo.gif   (for the README, where <video> may be stripped)
//
// Reuses the showcase mock from capture-readme-screenshots.mjs, so the footage is
// honest: same BlockNote editor, same pdf.js renderer, same UI as a real install —
// only the workspace data is seeded.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { newAppPage } from "./capture-readme-screenshots.mjs";

const BASE_URL = "http://127.0.0.1:1420";
const OUT_DIR = "docs/assets";
const WEBM_OUT = `${OUT_DIR}/shelf-demo.webm`;
const GIF_OUT = `${OUT_DIR}/shelf-demo.gif`;

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function ensureServer() {
  if ((await fetch(BASE_URL).then((r) => r.ok).catch(() => false))) return null;
  const server = spawn(
    "npm",
    ["run", "preview", "--", "--host", "127.0.0.1", "--port", "1420", "--strictPort"],
    { stdio: "ignore" }
  );
  if (!(await waitForServer(BASE_URL))) throw new Error("preview server did not start");
  return server;
}

function ffmpeg(...args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-y", ...args], { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
}

async function recordStudioFlow(browser) {
  // recordVideo needs a context-level dir; we move the file out afterwards.
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
  });

  const page = await newAppPage(ctx, {
    workspaceMode: "studio",
    currentPageId: "p-studio-note",
  });

  // Wait for the PDF to actually render before we start "acting".
  await page.locator("[data-pdf-page='1'][data-pdf-rendered='true']").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(900); // let the page settle / paint.

  // Beat 1: scroll the PDF down a couple of pages.
  const pdfViewport = page.locator("[data-pdf-page='1']").first();
  await pdfViewport.scrollIntoViewIfNeeded();
  await page.mouse.move(360, 450);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(700);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(900);

  // Beat 2: focus the linked note on the right and type a line.
  // The Studio note pane is a .on-studio-panel; its editor is the ProseMirror surface.
  const editor = page.locator(".on-studio-panel [contenteditable='true']").first();
  await editor.waitFor({ timeout: 15_000 });
  await editor.click({ position: { x: 200, y: 40 } });
  await page.waitForTimeout(400);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("trace = sum, det = product — checked against example 6.2.", { delay: 45 });
  await page.waitForTimeout(600);

  // Beat 3: scroll the PDF back up to close the loop.
  await page.mouse.move(360, 450);
  await page.mouse.wheel(0, -1200);
  await page.waitForTimeout(900);

  await ctx.close();
  return page.video();
}

async function run() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const server = await ensureServer();
  const browser = await chromium.launch();

  let video;
  try {
    video = await recordStudioFlow(browser);
  } finally {
    await browser.close();
    server?.kill();
  }

  // Playwright writes the video to a temp path; video.path() resolves after close.
  const rawPath = await video.path();
  console.log("raw video:", rawPath);

  // Move/normalize the raw WebM first.
  rmSync(WEBM_OUT, { force: true });
  if (rawPath !== WEBM_OUT) renameSync(rawPath, WEBM_OUT);
  console.log("wrote", WEBM_OUT);

  // Two-pass GIF: palette for clean quantization, then encode.
  const palette = `${OUT_DIR}/.palette.png`;
  const FILTER = "fps=15,scale=900:-1:flags=lanczos";
  await ffmpeg("-i", WEBM_OUT, "-t", "14", "-vf", `${FILTER},palettegen=stats_mode=diff`, palette);
  await ffmpeg(
    "-i", WEBM_OUT, "-t", "14", "-i", palette,
    "-lavfi", `${FILTER}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    GIF_OUT
  );
  rmSync(palette, { force: true });
  console.log("wrote", GIF_OUT);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
