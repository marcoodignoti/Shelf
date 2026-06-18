// Stages the landing (same as the Pages deploy) plus an asset gallery, then serves
// both on a local port. Run in the background; it stays up until killed.
//
//   /         -> the landing page
//   /gallery  -> every screenshot, the demo video, and the GIF
import { createServer } from "node:http";
import { readFile, mkdir, cp, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const STAGE = "docs/.stage-landing";
const PORT = Number(process.env.PORT) || 4399;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".webm": "video/webm",
  ".gif": "image/gif", ".ico": "image/x-icon", ".json": "application/json",
};

const LANDING_ASSETS = [
  "shelf-demo.webm", "shelf-demo.gif",
  "shelf-editor.png", "shelf-studio-pdf.png", "shelf-dark.png",
  "shelf-search.png", "shelf-slash-menu.png", "shelf-social-preview.png",
  "shelf-detail-formula.png", "shelf-detail-table.png", "shelf-detail-code.png",
  "shelf-detail-slash.png", "shelf-detail-sidebar.png", "shelf-detail-home.png",
];

async function stage() {
  await rm(STAGE, { recursive: true, force: true });
  await mkdir(`${STAGE}/assets`, { recursive: true });
  await mkdir(`${STAGE}/vendor`, { recursive: true });
  await cp("docs/site/index.html", `${STAGE}/index.html`);
  await cp("docs/site/vendor", `${STAGE}/vendor`, { recursive: true });
  for (const a of LANDING_ASSETS) {
    if (existsSync(`docs/assets/${a}`)) await cp(`docs/assets/${a}`, `${STAGE}/assets/${a}`);
  }
  await cp("assets/app-icon.png", `${STAGE}/assets/app-icon.png`);
  await buildGallery();
}

async function buildGallery() {
  const items = [];
  for (const a of LANDING_ASSETS) {
    const p = `docs/assets/${a}`;
    if (!existsSync(p)) continue;
    const s = await stat(p);
    const kb = Math.round(s.size / 1024);
    const dim = a.endsWith(".png") ? await pngDim(p) : null;
    items.push({ name: a, kb, dim, kind: kindOf(a) });
  }
  const cards = items.map((it) => {
    const media = it.kind === "video"
      ? `<video controls muted loop playsinline style="max-width:100%;border-radius:8px;border:1px solid var(--line)"><source src="assets/${it.name}" type="video/webm"></video>`
      : `<img src="assets/${it.name}" alt="${it.name}" loading="lazy">`;
    return `<figure>
      <div class="frame">${media}</div>
      <figcaption><code>${it.name}</code><span>${it.dim ? it.dim + " · " : ""}${it.kb} KB</span></figcaption>
    </figure>`;
  }).join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Shelf — asset gallery</title>
    <style>
      :root{--bg:#0c0a09;--ink:#fafaf9;--muted:#a8a29e;--line:#292524}
      @media(prefers-color-scheme:light){:root{--bg:#fafaf9;--ink:#1c1917;--muted:#78716c;--line:#e7e5e4}}
      *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
        font-family:-apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif;line-height:1.5;
        -webkit-font-smoothing:antialiased}
      .wrap{max-width:1180px;margin:0 auto;padding:48px 28px 80px}
      h1{font-size:24px;font-weight:650;letter-spacing:-0.01em;margin:0 0 6px}
      p.sub{color:var(--muted);margin:0 0 36px;font-size:15px}
      .back{display:inline-block;margin-bottom:28px;color:var(--muted);text-decoration:none;font-size:14px}
      .back:hover{color:var(--ink)}
      .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:28px}
      figure{margin:0}
      .frame{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--bg);min-height:60px;display:flex;align-items:center;justify-content:center}
      .frame img{width:100%;display:block}
      figcaption{margin-top:10px;display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--muted)}
      code{font-family:ui-monospace,SF Mono,Menlo,monospace}
    </style></head><body><div class="wrap">
    <a class="back" href="/">← Back to landing</a>
    <h1>Shelf — asset gallery</h1>
    <p class="sub">All screenshots, the demo video and the GIF used by the landing and README. Captured from the real renderer with a seeded showcase workspace.</p>
    <div class="grid">${cards}</div>
    </div></body></html>`;
  await writeFile(`${STAGE}/gallery.html`, html);
}

import { writeFile } from "node:fs/promises";

async function pngDim(file) {
  const b = await readFile(file);
  if (b.length < 24 || b.toString("ascii", 12, 16) !== "IHDR") return null;
  return `${b.readUInt32BE(16)}×${b.readUInt32BE(20)}`;
}

function kindOf(name) {
  if (name.endsWith(".webm")) return "video";
  if (name.endsWith(".gif")) return "gif";
  return "image";
}

await stage();

const server = createServer(async (req, res) => {
  let url = req.url.split("?")[0];
  if (url === "/gallery") url = "/gallery.html";
  const p = path.join(STAGE, url === "/" ? "/index.html" : url);
  try {
    const data = await readFile(p);
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`Shelf preview ready:`);
  console.log(`  Landing : http://localhost:${PORT}/`);
  console.log(`  Gallery : http://localhost:${PORT}/gallery`);
  console.log(`  (Ctrl+C to stop)`);
});
