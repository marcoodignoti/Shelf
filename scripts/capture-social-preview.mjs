// Renders docs/assets/shelf-social-preview.png (1280x640 @2x), the
// image GitHub shows when the repo link is shared. Uses the freshly captured
// editor screenshots, so run capture-readme-screenshots.mjs first.
import { chromium } from "playwright";
import { writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1280px; height: 640px; overflow: hidden;
    font-family: -apple-system, "SF Pro Display", "Segoe UI", sans-serif;
    background: #0b0d10;
    position: relative;
    color: #fff;
  }
  .glow {
    position: absolute; inset: 0;
    background:
      radial-gradient(900px 500px at 78% 110%, rgba(124, 92, 255, 0.22), transparent 65%),
      radial-gradient(700px 420px at 12% -10%, rgba(64, 145, 255, 0.14), transparent 60%);
  }
  .left {
    position: absolute; left: 72px; top: 0; bottom: 0; width: 480px;
    display: flex; flex-direction: column; justify-content: center; gap: 28px;
    z-index: 2;
  }
  .brand { display: flex; align-items: center; gap: 20px; }
  .brand img { width: 84px; height: 84px; border-radius: 20px; }
  .brand h1 { font-size: 58px; font-weight: 700; letter-spacing: -0.02em; }
  .tagline { font-size: 26px; line-height: 1.45; color: #c7cdd6; font-weight: 400; }
  .tagline b { color: #fff; font-weight: 600; }
  .chips { display: flex; gap: 10px; flex-wrap: wrap; }
  .chip {
    font-size: 16px; font-weight: 600; color: #e6e9ee;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.05);
    padding: 8px 16px; border-radius: 999px;
  }
  .shot {
    position: absolute; left: 620px; top: 64px; width: 980px;
    border-radius: 14px;
    box-shadow: 0 40px 90px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.09);
    overflow: hidden;
    z-index: 1;
  }
  .shot img { width: 100%; display: block; }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="left">
    <div class="brand">
      <img src="../assets/app-icon.png" alt="">
      <h1>Shelf</h1>
    </div>
    <div class="tagline">A <b>local-first</b> workspace for notes, PDFs, study, and research.<br>No account. Your data stays on your machine.</div>
    <div class="chips">
      <span class="chip">macOS</span>
      <span class="chip">Windows</span>
      <span class="chip">Free &amp; MIT</span>
      <span class="chip">Notion-style editor</span>
      <span class="chip">PDF Studio</span>
    </div>
  </div>
  <div class="shot"><img src="../docs/assets/shelf-dark.png" alt=""></div>
</body>
</html>`;

const tempPath = resolve("scripts/.social-preview.html");
writeFileSync(tempPath, html);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 640 },
  deviceScaleFactor: 2,
});
await page.goto(`file://${tempPath}`);
await page.waitForTimeout(400);
await page.screenshot({ path: "docs/assets/shelf-social-preview.png" });
await browser.close();
rmSync(tempPath);
console.log("captured shelf-social-preview");
