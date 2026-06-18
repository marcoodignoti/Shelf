// Quick local validation of the landing page: serves a staged copy of what the
// Pages workflow would deploy, loads it in Chromium, logs console errors, and
// confirms the demo <video> and GSAP scripts load.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const STAGE = "docs/.stage-landing";
const PORT = 4319;

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".webm": "video/webm", ".gif": "image/gif", ".ico": "image/x-icon",
};

async function stage() {
  await rm(STAGE, { recursive: true, force: true });
  await mkdir(`${STAGE}/assets`, { recursive: true });
  await mkdir(`${STAGE}/vendor`, { recursive: true });
  await cp("docs/site/index.html", `${STAGE}/index.html`);
  await cp("docs/site/vendor", `${STAGE}/vendor`, { recursive: true });
  // assets referenced by the page
  const assets = [
    "shelf-demo.webm", "shelf-demo.gif", "shelf-studio-pdf.png",
    "shelf-detail-code.png", "shelf-detail-formula.png", "shelf-detail-slash.png",
    "shelf-detail-sidebar.png", "shelf-detail-table.png", "shelf-detail-home.png",
    "shelf-social-preview.png", "shelf-dark.png", "shelf-editor.png",
    "shelf-search.png", "shelf-slash-menu.png",
  ];
  for (const a of assets) await cp(`docs/assets/${a}`, `${STAGE}/assets/${a}`);
  await cp("assets/app-icon.png", `${STAGE}/assets/app-icon.png`);
}

const server = createServer(async (req, res) => {
  let p = path.join(STAGE, req.url === "/" ? "/index.html" : req.url);
  try {
    const data = await readFile(p);
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});

await stage();
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("requestfailed", (r) => errors.push("REQFAIL: " + r.url() + " " + (r.failure()?.errorText ?? "")));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const videoOk = await page.locator("video source").evaluate((el) => el.readyState >= 0).catch(() => false);
const gsapOk = await page.evaluate(() => typeof window.gsap === "object" && typeof window.ScrollTrigger === "object").catch(() => false);
const videoSrc = await page.locator("video source").getAttribute("src").catch(() => null);
const title = await page.title();

console.log("title:", title);
console.log("gsap loaded:", gsapOk);
console.log("video src:", videoSrc);
console.log("console errors:", errors.length ? errors : "none");

await browser.close();
server.close();
await rm(STAGE, { recursive: true, force: true });
process.exit(errors.length ? 1 : 0);
