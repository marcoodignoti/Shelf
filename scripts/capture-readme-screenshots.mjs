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
const txt = (value, styles) => ({ type: "text", text: value, styles: styles ?? {} });
const paragraph = (value) => ({ type: "paragraph", content: text(value), children: [] });
const paragraphRich = (parts) => ({ type: "paragraph", content: parts, children: [] });
const heading = (value, level = 2) => ({ type: "heading", props: { level }, content: text(value), children: [] });
const check = (value, checked) => ({ type: "checkListItem", props: { checked }, content: text(value), children: [] });
const bullet = (value) => ({ type: "bulletListItem", content: text(value), children: [] });
const numbered = (value) => ({ type: "numberedListItem", content: text(value), children: [] });
const quote = (value) => ({ type: "quote", content: text(value), children: [] });
const formula = (latex) => ({ type: "formula", props: { formula: latex }, children: [] });
const code = (source, language = "text") => ({ type: "codeBlock", props: { language }, content: source, children: [] });
const table = (rows) => ({
  type: "table",
  content: { type: "tableContent", rows: rows.map((cells) => ({ cells })) },
  children: [],
});

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
  paragraphRich([
    txt("Week 4 covers the time-dependent formulation and what “measurement” actually does to a state. The key insight from lecture: "),
    txt("superposition is not ignorance — it is the state.", { bold: true }),
    txt(" Two states being added as amplitudes, not probabilities, is what makes quantum mechanics genuinely different from a classical ignorance model."),
  ]),
  heading("The Schrödinger equation"),
  formula("i\\hbar \\frac{\\partial}{\\partial t} \\Psi(x, t) = \\hat{H} \\Psi(x, t)"),
  paragraph("The Hamiltonian drives time evolution. For a free particle the dispersion relation falls out directly, and stationary states appear as the separable solutions. I keep forgetting which sign convention Griffiths uses, so I pinned the derivation below."),
  heading("This week"),
  check("Re-derive the infinite square well from boundary conditions", true),
  check("Problem set 4 — questions 1–6", true),
  check("Read Griffiths §2.3 on harmonic oscillators", false),
  check("Office hours: ask about degenerate perturbation theory", false),
  heading("Numerical check — ground state of the square well"),
  paragraph("Small script I use to sanity-check the analytic energy levels against a finite-difference solver. The relative error stays under 1% for the first five levels with N = 800 points."),
  code(
    "import numpy as np\n\nN = 800\nL = 1.0\nx = np.linspace(0, L, N)\nh = x[1] - x[0]\n\n# Finite-difference Hamiltonian, V = 0 inside the well.\nH = (np.diag(2 * np.ones(N)) - np.diag(np.ones(N - 1), 1) - np.diag(np.ones(N - 1), -1)) / h**2\n\nenergies = np.linalg.eigvalsh(H)[::-1][:5]\nprint(\"E_n (numeric) =\", np.round(energies, 4))",
    "python"
  ),
  heading("Comparison: analytic vs. numeric"),
  table([
    ["Level n", "Analytic E_n", "Numeric E_n", "Rel. error"],
    ["1", "49.3480", "49.3421", "0.012%"],
    ["2", "197.3921", "197.3684", "0.012%"],
    ["3", "444.1322", "444.0789", "0.012%"],
    ["4", "789.5684", "789.4736", "0.012%"],
    ["5", "1233.7006", "1233.5525", "0.012%"],
  ]),
  heading("Open questions"),
  quote("If the wavefunction collapses on measurement, what counts as a measurement? — follow up with the decoherence paper in Studio."),
  bullet("Ehrenfest theorem → classical limit"),
  bullet("Why is the ground state energy nonzero? (answer: confinement × uncertainty)"),
  numbered("Draft the §2.3 summary and link it from the thesis outline."),
  numbered("Add the solver output as a figure in the methodology page."),
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
    id: "p-lit", title: "Literature Review", icon: "📚", parent_id: "proj-research",
    blocks: [
      paragraph("Annotated sources for the methodology chapter, grouped by what they actually contribute. Priority column is what I use to decide what to read in full."),
      heading("Source comparison"),
      table([
        ["Paper", "Year", "Contribution", "Priority"],
        ["Zurek — Decoherence, einselection", "2003", "Pointer-state basis", "High"],
        ["Joos & Zeh — Emergence of classicality", "1985", "Environment coupling", "Medium"],
        ["Schlosshauer — Decoherence overview", "2005", "Survey / citations", "High"],
        ["Griffiths — QM textbook", "2018", "Reference derivations", "Reference"],
      ]),
      heading("Notes per source"),
      bullet("Zurek: the einselection argument is the cleanest answer I have found to the measurement question — worth re-reading before the defense."),
      bullet("Schlosshauer: use this as the backbone for the literature review; it already maps the field."),
    ],
    updated_at: iso(200), sort_order: 0,
    search_text: "sources annotated bibliography decoherence einselection survey",
  }),
  makePage({
    id: "p-method", title: "Methodology", icon: "🧪", parent_id: "proj-research",
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
      heading("Quantum Notes — Lecture Series"),
      paragraph("The two-slit experiment chapter is the cleanest intro to amplitudes I have found. Notes below follow the lecture numbering."),
      bullet("Probability amplitudes add, probabilities do not"),
      bullet("Indistinguishability is what creates interference"),
    ],
    updated_at: iso(45), sort_order: 2,
    search_text: "lecture notes amplitudes interference two-slit",
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
      paragraphRich([
        txt("Reading alongside the PDF on the left. The lecturer keeps tying the determinant back to "),
        txt("volume scaling", { bold: true }),
        txt(" — that picture is what made the product-of-eigenvalues result click for me."),
      ]),
      heading("Core definition"),
      formula("A\\vec{x} = \\lambda \\vec{x}"),
      paragraph("Solve det(A − λI) = 0 for the eigenvalues, then back-substitute for the eigenvectors. The characteristic polynomial is where most of the algebra actually lives."),
      heading("Key identities"),
      table([
        ["Quantity", "In terms of eigenvalues λᵢ"],
        ["trace(A)", "Σ λᵢ"],
        ["det(A)", "∏ λᵢ"],
        ["rank(A)", "count of nonzero λᵢ"],
      ]),
      heading("Symmetric matrices (the friendly case)"),
      bullet("All eigenvalues are real."),
      bullet("Eigenvectors are orthogonal → diagonalizable by an orthogonal Q."),
      bullet("This is why A = QΛQᵀ shows up everywhere in the simulation chapter."),
      heading("To do"),
      check("Redo example 6.2 by hand (3×3, repeated root)", true),
      check("Check the symmetric case numerically against numpy.linalg.eigh", false),
      check("Add a figure of the eigenvector basis to the methodology page", false),
    ],
    updated_at: iso(8), sort_order: 4,
    search_text: "eigenvalues eigenvectors trace determinant characteristic polynomial symmetric orthogonal lecture notes",
  }),
  // Project-kind pages drive the sidebar's collapsible project groups.
  makePage({
    id: "proj-courses", title: "This Semester", icon: "🎓", is_favorite: 1,
    blocks: [paragraph("Course hubs — lecture notes, problem sets, and exam prep in one place.")],
    updated_at: iso(70), sort_order: 0,
    search_text: "courses semester lectures exams",
    page_kind: "project",
  }),
  makePage({
    id: "proj-research", title: "Research", icon: "🔬",
    blocks: [paragraph("Active research threads and their source papers.")],
    updated_at: iso(140), sort_order: 1,
    search_text: "research papers decoherence threads",
    page_kind: "project",
  }),
];

const STUDIO_DOCUMENT = {
  id: "p-studio-note",
  title: "Eigenvalues — Lecture 12",
  original_filename: "linear-algebra-lecture-notes.pdf",
  stored_file_path: "/showcase/linear-algebra-lecture-notes.pdf",
  note_page_id: "p-studio-note",
  project_id: "proj-algebra",
  last_opened_at: iso(8),
  viewer_zoom: 110,
  viewer_page: 1,
  panel_layout: "pdf-left",
  created_at: iso(2880),
  updated_at: iso(8),
};

const STUDIO_PROJECTS = [
  { id: "proj-algebra", name: "Linear Algebra", parent_id: null, sort_order: 0, created_at: iso(2880), updated_at: iso(40) },
  { id: "proj-qm", name: "Quantum Mechanics", parent_id: null, sort_order: 1, created_at: iso(2880), updated_at: iso(60) },
  { id: "proj-thesis-sources", name: "Thesis Sources", parent_id: null, sort_order: 2, created_at: iso(2880), updated_at: iso(120) },
  { id: "proj-qm-exams", name: "Past Exams", parent_id: "proj-qm", sort_order: 0, created_at: iso(2880), updated_at: iso(200) },
];

function createTextPdf(pageCount) {
  const objects = [];
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>");
  let nextId = 3;
  const contentIds = [];

  const sections = [
    {
      title: "Chapter 6 — Eigenvalues and Eigenvectors",
      lines: [
        "Linear Algebra — Lecture Notes",
        "Prof. M. Riva  ·  Department of Mathematics",
        "",
        "The eigenvalue problem asks for the special directions that a matrix",
        "does not rotate: vectors x for which Ax is a multiple of x. Those",
        "multiples are the eigenvalues, and they carry the deep information",
        "about the matrix - its powers, its exponential, its stability.",
        "",
        "Reading this chapter, focus on the geometric picture: an eigenvector",
        "is a direction the matrix leaves invariant, and the eigenvalue is",
        "the factor it stretches that direction by.",
      ],
    },
    {
      title: "6.1  The characteristic equation",
      lines: [
        "Almost every vector changes direction when multiplied by A. Certain",
        "exceptional vectors x are in the same direction as Ax. Those are",
        "the eigenvectors. Multiply an eigenvector by A, and Ax is a scalar",
        "lambda times the original x.",
        "",
        "The basic equation is  Ax = lambda x.",
        "To find the eigenvalues, solve the characteristic equation:",
        "",
        "        det(A - lambda I) = 0",
        "",
        "This is a polynomial of degree n in lambda. Its roots are the",
        "eigenvalues; back-substitution into (A - lambda I)x = 0 gives the",
        "eigenvectors.",
      ],
    },
    {
      title: "6.2  Trace, determinant, and the eigenvalues",
      lines: [
        "Two identities tie the eigenvalues back to quantities we can read",
        "directly off the matrix:",
        "",
        "    trace(A) = sum of the eigenvalues",
        "    det(A)   = product of the eigenvalues",
        "",
        "Geometrically: trace measures total stretching along the axes, and",
        "the determinant is the volume scaling factor of the linear map.",
        "That is why a zero eigenvalue (singular matrix) collapses volume",
        "to zero in one direction.",
      ],
    },
    {
      title: "6.3  Symmetric matrices",
      lines: [
        "Symmetric matrices are the friendly case and the one that matters",
        "most for applications:",
        "",
        "  - all eigenvalues are real;",
        "  - eigenvectors are orthogonal;",
        "  - A is diagonalized by an orthogonal matrix:  A = Q L Q^T.",
        "",
        "This spectral decomposition is the backbone of principal component",
        "analysis, the moment of inertia tensor, and the finite-difference",
        "Hamiltonian in the quantum notes.",
      ],
    },
    {
      title: "6.4  Worked example",
      lines: [
        "Example. Find the eigenvalues and eigenvectors of",
        "",
        "        A = [ 4   1 ]",
        "            [ 2   3 ]",
        "",
        "Characteristic polynomial:",
        "        (4 - lambda)(3 - lambda) - 2 = lambda^2 - 7 lambda + 10",
        "        = (lambda - 5)(lambda - 2)",
        "",
        "So lambda1 = 5, lambda2 = 2, with eigenvectors (1, 1) and (1, -2).",
        "Check: trace = 7 = 5 + 2;  det = 10 = 5 * 2.  Both identities hold.",
      ],
    },
  ];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const section = sections[Math.min(pageIndex, sections.length - 1)];
    const escaped = (s) => s.replace(/[\\()]/g, (ch) => `\\${ch}`);
    const textOps = [];
    // Title in bold.
    textOps.push(`/F2 14 Tf 18 TL 56 760 Td (${escaped(section.title)}) Tj T*`);
    textOps.push(`/F1 12 Tf 16 TL 0 8 Td`);
    for (const line of section.lines) {
      textOps.push(`(${escaped(line)}) Tj T*`);
    }
    // Body filler so the page looks full and content-like.
    for (let extra = 0; extra < 14; extra += 1) {
      textOps.push(
        `(Example ${pageIndex + 1}.${extra + 1}: the determinant ties the pivots to the eigenvalue product.) Tj T*`
      );
    }
    // Footer with page number.
    textOps.push(`0 -560 Td (Linear Algebra - Lecture Notes                page ${pageIndex + 1} of ${pageCount}) Tj`);
    const stream = `BT\n${textOps.join("\n")}\nET`;
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

export async function newAppPage(context, { theme = "light", currentPageId = "p-quantum", workspaceMode = "notes" } = {}) {
  const page = await context.newPage();
  await page.addInitScript(({ pages, studioDocument, studioProjects, theme, currentPageId, workspaceMode }) => {
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
        if (cmd === "list_studio_projects") return studioProjects;
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
  }, { pages: PAGES, studioDocument: STUDIO_DOCUMENT, studioProjects: STUDIO_PROJECTS, theme, currentPageId, workspaceMode });

  const pdf = createTextPdf(6);
  await page.route("**/linear-algebra-lecture-notes.pdf*", (route) =>
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

// Capture a zoomed crop of a single element (high-DPR element screenshot).
async function shootElement(page, locator, name, { padding = 16 } = {}) {
  await page.waitForTimeout(400);
  await locator.waitFor({ state: "visible" });
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await locator.screenshot({ path: `${OUT_DIR}/${name}.png`, omitBackground: false });
  console.log("captured", name);
}

// Run a detail shot; on failure, warn and continue (don't abort the whole run).
async function detail(context, name, setup) {
  let page;
  try {
    page = await setup(context);
    await shootElement(page, page.lastLocator, name);
  } catch (error) {
    console.warn(`SKIP ${name}: ${error.message.split("\n")[0]}`);
  } finally {
    await page?.close().catch(() => {});
  }
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

  // --- Zoomed detail shots (element crops at high DPR) ---
  // Each is fault-tolerant: a missing/changed selector logs a SKIP, not an abort.

  // D1. Formula block rendered with KaTeX.
  await detail(context, "shelf-detail-formula", async (ctx) => {
    const page = await newAppPage(ctx);
    page.lastLocator = page.locator(".katex-block-wrapper").first();
    return page;
  });

  // D2. Comparison table block. [data-content-type="table"] is the BlockNote
  // block container; the native <table> lives inside it (most stable hook).
  await detail(context, "shelf-detail-table", async (ctx) => {
    const page = await newAppPage(ctx);
    page.lastLocator = page.locator('[data-content-type="table"] table').first();
    return page;
  });

  // D3. Code block (the finite-difference solver).
  await detail(context, "shelf-detail-code", async (ctx) => {
    const page = await newAppPage(ctx);
    page.lastLocator = page.locator(".bn-editor pre").first();
    return page;
  });

  // D4. Slash command menu (cropped, not full-window).
  await detail(context, "shelf-detail-slash-menu", async (ctx) => {
    const page = await newAppPage(ctx, { currentPageId: "p-ideas" });
    const lastBlock = page.locator(".bn-block-content").last();
    await lastBlock.waitFor();
    await lastBlock.click();
    await page.waitForTimeout(300);
    await page.keyboard.press("End");
    await page.waitForTimeout(150);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    await page.keyboard.type("/", { delay: 100 });
    await page.locator(".bn-suggestion-menu").waitFor();
    await page.waitForTimeout(300);
    page.lastLocator = page.locator(".bn-suggestion-menu");
    return page;
  });

  // D5. Sidebar page row with hover-revealed actions (favorite pin visible).
  await detail(context, "shelf-detail-sidebar-hover", async (ctx) => {
    const page = await newAppPage(ctx);
    const rows = page.locator(".on-sidebar-page-row");
    await rows.first().waitFor();
    const count = await rows.count();
    const target = count > 1 ? rows.nth(1) : rows.first();
    await target.hover();
    await page.waitForTimeout(400);
    page.lastLocator = target;
    return page;
  });

  // D6. Studio sidebar with project tree (needs studio mode).
  await detail(context, "shelf-detail-studio-projects", async (ctx) => {
    const page = await newAppPage(ctx, { workspaceMode: "studio", currentPageId: "p-studio-note" });
    await page.locator("[data-pdf-page='1'][data-pdf-rendered='true']").waitFor({ timeout: 30_000 });
    page.lastLocator = page.locator(".on-sidebar-project-row").first();
    return page;
  });

  // D7. Home dashboard favorites section (recents + favorites cards).
  await detail(context, "shelf-detail-home-favorites", async (ctx) => {
    const page = await newAppPage(ctx, { currentPageId: "__opennotion_home__" });
    await page.getByText("Recent workspace activity.").waitFor();
    // Favorites is the second <section>; capture the section block.
    page.lastLocator = page.locator("main section").nth(1);
    return page;
  });

  await browser.close();
  server?.kill();
}

// Auto-run only when invoked directly (`node scripts/capture-readme-screenshots.mjs`),
// not when imported (e.g. by the video capture script).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { run, PAGES, STUDIO_DOCUMENT, STUDIO_PROJECTS };
