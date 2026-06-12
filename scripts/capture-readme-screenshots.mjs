// Captures the README/product screenshots from the built renderer with a
// seeded, curated workspace. Run a preview server first (or let this spawn
// one):
//   npm run build && node scripts/capture-readme-screenshots.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const BASE_URL = "http://127.0.0.1:1420";
const OUT_DIR = "docs/assets";

const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

const text = (value, styles = {}) => [{ type: "text", text: value, styles }];
const paragraph = (value) => ({ type: "paragraph", content: text(value), children: [] });
const heading = (value, level = 2) => ({ type: "heading", props: { level }, content: text(value), children: [] });
const check = (value, checked) => ({ type: "checkListItem", props: { checked }, content: text(value), children: [] });
const bullet = (value) => ({ type: "bulletListItem", content: text(value), children: [] });
const quote = (value) => ({ type: "quote", content: text(value), children: [] });
const formula = (latex) => ({ type: "formula", props: { formula: latex }, children: [] });

const makePage = (overrides) => ({
  id: overrides.id,
  title: overrides.title,
  parent_id: overrides.parent_id ?? null,
  content: overrides.blocks ? JSON.stringify(overrides.blocks) : null,
  search_text: overrides.search_text ?? "",
  icon: overrides.icon ?? null,
  cover_url: null,
  is_deleted: 0,
  is_favorite: overrides.is_favorite ?? 0,
  is_template: 0,
  is_database: 0,
  database_schema: null,
  properties: null,
  sort_order: overrides.sort_order ?? 0,
  page_kind: overrides.page_kind ?? "note",
  created_at: overrides.created_at ?? iso(2880),
  updated_at: overrides.updated_at ?? iso(60),
});

const quantumBlocks = [
  paragraph("Week 4 covers the time-dependent formulation and what “measurement” actually does to a state. Key insight from lecture: superposition is not ignorance — it is the state."),
  heading("The Schrödinger equation"),
  formula("i\\hbar \\frac{\\partial}{\\partial t} \\Psi(x, t) = \\hat{H} \\Psi(x, t)"),
  paragraph("The Hamiltonian drives time evolution. For a free particle the dispersion relation follows directly, and stationary states fall out as the separable solutions."),
  heading("This week"),
  check("Re-derive the infinite square well from boundary conditions", true),
  check("Problem set 4 — questions 1–6", true),
  check("Read Griffiths §2.3 on harmonic oscillators", false),
  check("Office hours: ask about degenerate perturbation theory", false),
  heading("Open questions"),
  quote("If the wavefunction collapses on measurement, what counts as a measurement? — follow up with the decoherence paper in Studio"),
  bullet("Ehrenfest theorem → classical limit"),
  bullet("Why is the ground state energy nonzero?"),
];

const PAGES = [
  makePage({
    id: "p-quantum", title: "Quantum Mechanics — Week 4", icon: "⚛️",
    blocks: quantumBlocks, is_favorite: 1, updated_at: iso(12), sort_order: 0,
    search_text: "schrodinger equation hamiltonian eigenvalues measurement superposition",
  }),
  makePage({
    id: "p-thesis", title: "Thesis Outline", icon: "📐",
    blocks: [
      paragraph("Working structure for the dissertation. Each chapter links to its own page."),
      heading("Chapters"),
      bullet("Introduction and motivation"),
      bullet("Literature review"),
      bullet("Methodology"),
      bullet("Results and discussion"),
    ],
    is_favorite: 1, updated_at: iso(95), sort_order: 1,
    search_text: "dissertation chapters literature methodology results",
  }),
  makePage({
    id: "p-lit", title: "Literature Review", icon: "📚", parent_id: "p-thesis",
    blocks: [paragraph("Annotated sources, grouped by theme.")], updated_at: iso(200), sort_order: 0,
    search_text: "sources annotated bibliography",
  }),
  makePage({
    id: "p-method", title: "Methodology", icon: "🧪", parent_id: "p-thesis",
    blocks: [paragraph("Experiment design and instrumentation notes.")], updated_at: iso(300), sort_order: 1,
    search_text: "experiment design instrumentation",
  }),
  makePage({
    id: "p-results", title: "Results Draft", icon: "📈", parent_id: "p-thesis",
    blocks: [paragraph("Preliminary plots and what they suggest.")], updated_at: iso(400), sort_order: 2,
    search_text: "plots preliminary findings",
  }),
  makePage({
    id: "p-reading", title: "Reading Notes", icon: "📖",
    blocks: [
      heading("Feynman — Lectures, Vol. III"),
      paragraph("The two-slit experiment chapter is the cleanest intro to amplitudes I have found. Notes below follow his numbering."),
      bullet("Probability amplitudes add, probabilities do not"),
      bullet("Indistinguishability is what creates interference"),
    ],
    updated_at: iso(45), sort_order: 2,
    search_text: "feynman lectures amplitudes interference two-slit",
  }),
  makePage({
    id: "p-ideas", title: "Ideas Inbox", icon: "💡",
    blocks: [
      check("Compare eigenvalue solvers for the simulation chapter", false),
      check("Email Prof. Riva about the colloquium slot", false),
      check("Prototype: export reading notes to flashcards", false),
    ],
    updated_at: iso(25), sort_order: 3,
    search_text: "eigenvalue solvers colloquium flashcards",
  }),
  makePage({
    id: "p-studio-note", title: "Eigenvalues — Lecture 12", icon: "🎯", page_kind: "studio_note",
    blocks: [
      paragraph("Notes while reading chapter 6. Strang keeps tying determinants back to volume — useful picture for the proof sketch below."),
      heading("Key results"),
      formula("A\\vec{x} = \\lambda \\vec{x}"),
      bullet("Trace equals the sum of eigenvalues"),
      bullet("Determinant equals their product"),
      check("Redo example 6.2 by hand", true),
      check("Check the symmetric case: real eigenvalues, orthogonal eigenvectors", false),
    ],
    updated_at: iso(8), sort_order: 4,
    search_text: "eigenvalues eigenvectors trace determinant strang",
  }),
];

const STUDIO_DOCUMENT = {
  id: "doc-strang",
  title: "Linear Algebra — Strang",
  original_filename: "strang-linear-algebra.pdf",
  stored_file_path: "/showcase/strang-linear-algebra.pdf",
  note_page_id: "p-studio-note",
  project_id: null,
  last_opened_at: iso(8),
  viewer_zoom: 110,
  viewer_page: 1,
  panel_layout: "pdf-left",
  created_at: iso(2880),
  updated_at: iso(8),
};

function createTextPdf(pageCount) {
  const objects = [];
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>");
  let nextId = 2;
  const contentIds = [];
  const bodyLines = [
    "Chapter 6 — Eigenvalues and Eigenvectors",
    "",
    "The eigenvalue problem asks for the special directions that a matrix",
    "does not rotate: vectors x for which Ax is a multiple of x. Those",
    "multiples are the eigenvalues, and they carry the deep information",
    "about the matrix — its powers, its exponential, its stability.",
    "",
    "6.1  Introduction",
    "",
    "Almost every vector changes direction when multiplied by A. Certain",
    "exceptional vectors x are in the same direction as Ax. Those are the",
    "eigenvectors. Multiply an eigenvector by A, and the vector Ax is a",
    "number lambda times the original x.",
    "",
    "The basic equation is Ax = lambda x. The number lambda is an",
    "eigenvalue of A, and the vector x is the associated eigenvector.",
    "The key to finding them: solve det(A - lambda I) = 0.",
  ];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const lines = bodyLines.map((line) =>
      `(${line.replace(/[\\()]/g, (ch) => `\\${ch}`)}) Tj T*`
    );
    for (let extra = 0; extra < 24; extra += 1) {
      lines.push(`(Worked example ${pageIndex + 1}.${extra + 1}: the determinant ties the pivots to the eigenvalue product.) Tj T*`);
    }
    const stream = `BT /F1 12 Tf 16 TL 56 760 Td\n${lines.join("\n")}\nET`;
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    contentIds.push(nextId);
    nextId += 1;
  }
  const pagesId = nextId;
  nextId += 1;
  const pageIds = [];
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    objects.push(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R >> >> /Contents ${contentIds[pageIndex]} 0 R >>`
    );
    pageIds.push(nextId);
    nextId += 1;
  }
  objects.splice(pagesId - 1, 0, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`);
  const catalogId = nextId;
  objects.push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const offsets = [0];
  let body = "%PDF-1.4\n";
  for (const [index, object] of objects.entries()) {
    offsets[index + 1] = Buffer.byteLength(body, "utf8");
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Root ${catalogId} 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}

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

async function newAppPage(context, { theme = "light", currentPageId = "p-quantum", workspaceMode = "notes" } = {}) {
  const page = await context.newPage();
  await page.addInitScript(({ pages, studioDocument, theme, currentPageId, workspaceMode }) => {
    window.localStorage.clear();
    window.localStorage.setItem("opennotion-theme", theme);
    window.localStorage.setItem("opennotion-workspace-mode", workspaceMode);
    if (currentPageId) window.localStorage.setItem("opennotion-current-page-id", currentPageId);
    if (workspaceMode === "studio") window.localStorage.setItem("opennotion-current-studio-document-id", studioDocument.id);

    const sortPages = (list) => [...list].filter((p) => p.is_deleted === 0)
      .sort((a, b) => a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : b.created_at.localeCompare(a.created_at));

    window.openNotion = {
      invoke: async (cmd, args = {}) => {
        if (cmd === "list_pages") return sortPages(pages);
        if (cmd === "list_all_pages") return pages;
        if (cmd === "get_page") return pages.find((p) => p.id === args.id) ?? null;
        if (cmd === "search_pages") {
          const query = String(args.query ?? "").trim().toLowerCase();
          if (!query) return [];
          return sortPages(pages)
            .filter((p) => p.title.toLowerCase().includes(query) || (p.search_text ?? "").toLowerCase().includes(query))
            .map((p) => ({ ...p, matched_content: (p.search_text ?? "").toLowerCase().includes(query) ? p.search_text : null }));
        }
        if (cmd === "list_studio_documents") return [studioDocument];
        if (cmd === "list_studio_projects") return [];
        if (cmd === "list_all_studio_document_page_links" || cmd === "list_studio_document_page_links") {
          return [{
            id: "link-1", document_id: studioDocument.id, page_id: studioDocument.note_page_id,
            pdf_page: null, label: "Primary note", sort_order: 0,
            created_at: studioDocument.created_at, updated_at: studioDocument.updated_at,
            page: pages.find((p) => p.id === studioDocument.note_page_id),
          }];
        }
        if (cmd === "update_studio_document_viewer_state") return null;
        if (cmd === "update_page") return null;
        if (cmd === "show_character_palette") return null;
        throw new Error(`Unhandled showcase command: ${cmd}`);
      },
      open: async () => null,
      save: async () => null,
      fileSrc: (filePath) => filePath,
    };
  }, { pages: PAGES, studioDocument: STUDIO_DOCUMENT, theme, currentPageId, workspaceMode });

  const pdf = createTextPdf(6);
  await page.route("**/strang-linear-algebra.pdf*", (route) =>
    route.fulfill({ body: pdf, contentType: "application/pdf" })
  );
  await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded" });
  return page;
}

async function shoot(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
  console.log("captured", name);
  await page.close();
}

async function run() {
  let server = null;
  if (!(await fetch(BASE_URL).then((r) => r.ok).catch(() => false))) {
    server = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "1420", "--strictPort"], { stdio: "ignore" });
    if (!(await waitForServer(BASE_URL))) throw new Error("preview server did not start");
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });

  // 1. Editor — rich page, light.
  {
    const page = await newAppPage(context);
    await page.getByLabel("Formula preview: i\\hbar \\frac{\\partial}{\\partial t} \\Psi(x, t) = \\hat{H} \\Psi(x, t)").waitFor();
    await shoot(page, "shelf-editor");
  }

  // 2. Home dashboard.
  {
    const page = await newAppPage(context, { currentPageId: "__opennotion_home__" });
    await page.getByText("Recent workspace activity.").waitFor();
    await page.getByText("Quantum Mechanics — Week 4").first().waitFor();
    await shoot(page, "shelf-home");
  }

  // 3. Studio split view with the PDF rendered.
  {
    const page = await newAppPage(context, { workspaceMode: "studio", currentPageId: "p-studio-note" });
    await page.locator("[data-pdf-page='1'][data-pdf-rendered='true']").waitFor({ timeout: 30_000 });
    await shoot(page, "shelf-studio-pdf");
  }

  // 4. Slash menu open in the editor.
  {
    const page = await newAppPage(context, { currentPageId: "p-ideas" });
    const lastBlock = page.locator(".bn-block-content").last();
    await lastBlock.waitFor();
    await lastBlock.click();
    await page.waitForTimeout(400);
    await page.keyboard.press("End");
    await page.waitForTimeout(200);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    await page.keyboard.type("/", { delay: 120 });
    await page.locator(".bn-suggestion-menu").waitFor();
    await page.waitForTimeout(300);
    await shoot(page, "shelf-slash-menu");
  }

  // 5. Command palette search.
  {
    const page = await newAppPage(context);
    await page.locator('[contenteditable="true"]').first().waitFor();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
    const paletteInput = page.locator("input:focus");
    await paletteInput.waitFor();
    await page.waitForTimeout(300);
    await paletteInput.fill("eigen");
    await page.waitForTimeout(700);
    await shoot(page, "shelf-search");
  }

  // 6. Editor in dark mode.
  {
    const page = await newAppPage(context, { theme: "dark" });
    await page.getByLabel("Formula preview: i\\hbar \\frac{\\partial}{\\partial t} \\Psi(x, t) = \\hat{H} \\Psi(x, t)").waitFor();
    await shoot(page, "shelf-dark");
  }

  await browser.close();
  server?.kill();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
