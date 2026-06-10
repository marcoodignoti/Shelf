#!/usr/bin/env node
// Regenerates the README/product-tour screenshots in docs/assets by driving
// the real Electron app (real backend, real SQLite) with Playwright against a
// freshly seeded demo workspace.
//
// Usage:
//   node scripts/generate-readme-screenshots.cjs
//
// On Linux/CI run it under a virtual display, e.g.:
//   xvfb-run -s "-screen 0 3200x2000x24" node scripts/generate-readme-screenshots.cjs
//
// The script uses a throwaway userData directory, so it never touches a real
// workspace database.

const { _electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "docs", "assets");
const VIEWPORT = { width: 1440, height: 900 };

// ---------------------------------------------------------------------------
// Demo PDF generation (base-14 fonts only, no dependencies)
// ---------------------------------------------------------------------------

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 76;
const TEXT_W = PAGE_W - MARGIN * 2;

// run: { f: "H" | "HB" | "HO" | "S", size, text }
const FONT_RES = { H: "F1", HB: "F2", HO: "F3", S: "F4" };

function escapePdfText(text) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapText(text, size, maxWidth) {
  const avgChar = size * 0.5;
  const maxChars = Math.floor(maxWidth / avgChar);
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

class PdfPageBuilder {
  constructor() {
    this.ops = [];
    this.y = PAGE_H - MARGIN;
  }

  textLine(runs, { leading = 16, x = MARGIN } = {}) {
    this.y -= leading;
    const parts = runs
      .map((run) => `/${FONT_RES[run.f]} ${run.size} Tf (${escapePdfText(run.text)}) Tj`)
      .join(" ");
    this.ops.push(`BT 1 0 0 1 ${x} ${this.y} Tm ${parts} ET`);
  }

  centeredLine(runs, { leading = 16 } = {}) {
    const width = runs.reduce((total, run) => total + run.text.length * run.size * 0.5, 0);
    this.textLine(runs, { leading, x: MARGIN + Math.max(0, (TEXT_W - width) / 2) });
  }

  paragraph(text, { size = 10.5, leading = 15.5, font = "H" } = {}) {
    for (const line of wrapText(text, size, TEXT_W)) {
      this.textLine([{ f: font, size, text: line }], { leading });
    }
  }

  space(amount) {
    this.y -= amount;
  }

  rule() {
    this.y -= 10;
    this.ops.push(`0.75 w 0.6 G ${MARGIN} ${this.y} m ${PAGE_W - MARGIN} ${this.y} l S 0 G`);
    this.y -= 4;
  }

  pageNumber(current, total) {
    this.ops.push(
      `BT 1 0 0 1 ${PAGE_W / 2 - 10} ${MARGIN - 32} Tm /${FONT_RES.H} 9 Tf 0.45 g (${current} / ${total}) Tj 0 g ET`
    );
  }

  stream() {
    return this.ops.join("\n");
  }
}

function buildDemoPdf() {
  const paragraphs = {
    abstract:
      "These notes develop the theory of static electric fields from first principles. Starting from Coulomb's law, we introduce the electric field as a vector field defined at every point in space, visualize it through field lines, and arrive at Gauss's law as the first of Maxwell's equations. Worked examples cover point charges, charged conductors, and continuous charge distributions.",
    coulomb1:
      "Electric charge is a conserved, quantized property of matter. Two point charges at rest exert forces on one another along the line joining them: like charges repel and unlike charges attract. The magnitude of the force falls off with the square of the separation, a result established experimentally by Coulomb with a torsion balance in 1785.",
    coulomb2:
      "The constant of proportionality depends on the medium between the charges. In vacuum it is conventionally written in terms of the permittivity of free space, and its size explains why electrostatic effects dominate gravity at the atomic scale by nearly forty orders of magnitude.",
    field1:
      "Rather than thinking of charges acting on each other at a distance, it is far more fruitful to say that a charge modifies the space around it. The electric field at a point is defined operationally: place a small positive test charge there, measure the force on it, and divide by the magnitude of the test charge.",
    field2:
      "The field concept earns its keep when the sources move or when many charges act together. Fields obey the principle of superposition: the field of a collection of charges is the vector sum of the fields each charge would produce alone, which reduces every electrostatics problem to bookkeeping over the source distribution.",
    lines1:
      "A field line is a curve whose tangent at every point gives the direction of the electric field there. Lines begin on positive charges and end on negative charges or at infinity, they never cross, and their local density is proportional to the field strength. A sketch of field lines therefore encodes both the direction and the relative magnitude of the field across a whole region at a glance.",
    lines2:
      "For a single positive point charge the lines radiate outward symmetrically in all directions. For a dipole they bow from the positive to the negative charge, crowding together in the gap where the field is strongest. These pictures, introduced by Faraday, remain the most intuitive map of an electrostatic configuration.",
    gauss1:
      "Consider any closed surface drawn in an electric field. The flux of the field through that surface measures the net number of field lines passing outward through it. Gauss's law states that this flux depends only on the total charge enclosed, no matter how the charge is arranged or how the surface is shaped.",
    gauss2:
      "When a charge distribution has spherical, cylindrical, or planar symmetry, Gauss's law turns the calculation of the field into a one-line argument. It is also the differential statement that electric field lines have sources and sinks only where charge resides.",
    conductors1:
      "In electrostatic equilibrium the field inside a conductor vanishes: any interior field would drive currents until the charges rearrange to cancel it. All excess charge resides on the surface, the field just outside is perpendicular to the surface, and the entire conductor is an equipotential.",
    energy1:
      "Assembling a charge configuration costs work against the mutual forces, and that work is stored as electrostatic potential energy. It is often most natural to regard the energy as residing in the field itself, distributed through space with a density proportional to the square of the field strength.",
  };

  const eq = {
    coulomb: [
      { f: "HO", size: 12, text: "F" },
      { f: "H", size: 12, text: " = k " },
      { f: "HO", size: 12, text: "q" },
      { f: "H", size: 9, text: "1" },
      { f: "HO", size: 12, text: "q" },
      { f: "H", size: 9, text: "2" },
      { f: "H", size: 12, text: " / " },
      { f: "HO", size: 12, text: "r" },
      { f: "H", size: 9, text: "2" },
    ],
    field: [
      { f: "HO", size: 12, text: "E" },
      { f: "H", size: 12, text: " = " },
      { f: "HO", size: 12, text: "F" },
      { f: "H", size: 12, text: " / " },
      { f: "HO", size: 12, text: "q" },
      { f: "H", size: 9, text: "0" },
    ],
    gaussIntegral: [
      { f: "S", size: 12, text: "\xF2" }, // integral
      { f: "HO", size: 12, text: " E " },
      { f: "S", size: 12, text: "\xD7" }, // dot operator
      { f: "HO", size: 12, text: " dA" },
      { f: "H", size: 12, text: " = " },
      { f: "HO", size: 12, text: "Q" },
      { f: "H", size: 9, text: "enc" },
      { f: "H", size: 12, text: " / " },
      { f: "S", size: 12, text: "e" }, // epsilon
      { f: "H", size: 9, text: "0" },
    ],
    gaussDifferential: [
      { f: "S", size: 12, text: "\xD1" }, // nabla
      { f: "S", size: 12, text: " \xD7 " },
      { f: "HO", size: 12, text: "E" },
      { f: "H", size: 12, text: " = " },
      { f: "S", size: 12, text: "r" }, // rho
      { f: "H", size: 12, text: " / " },
      { f: "S", size: 12, text: "e" },
      { f: "H", size: 9, text: "0" },
    ],
    energy: [
      { f: "HO", size: 12, text: "u" },
      { f: "H", size: 12, text: " = " },
      { f: "S", size: 12, text: "e" },
      { f: "H", size: 9, text: "0" },
      { f: "HO", size: 12, text: "E" },
      { f: "H", size: 9, text: "2" },
      { f: "H", size: 12, text: " / 2" },
    ],
  };

  const sectionPages = [
    {
      heading: "3.1  Coulomb's Law",
      blocks: [paragraphs.coulomb1, { eq: eq.coulomb }, paragraphs.coulomb2],
    },
    {
      heading: "3.2  The Electric Field",
      blocks: [paragraphs.field1, { eq: eq.field }, paragraphs.field2],
    },
    {
      heading: "3.3  Field Lines",
      blocks: [paragraphs.lines1, paragraphs.lines2],
    },
    {
      heading: "3.4  Gauss's Law",
      blocks: [paragraphs.gauss1, { eq: eq.gaussIntegral }, { eq: eq.gaussDifferential }, paragraphs.gauss2],
    },
    {
      heading: "3.5  Conductors in Equilibrium",
      blocks: [paragraphs.conductors1],
    },
    {
      heading: "3.6  Energy in the Electrostatic Field",
      blocks: [paragraphs.energy1, { eq: eq.energy }],
    },
  ];

  const fillerSections = [
    ["3.7  Worked Examples", paragraphs.coulomb2, paragraphs.field2],
    ["3.8  The Dipole Field", paragraphs.lines2, paragraphs.lines1],
    ["3.9  Continuous Distributions", paragraphs.gauss2, paragraphs.gauss1],
    ["3.10  Shielding and Cavities", paragraphs.conductors1, paragraphs.field1],
    ["Problems", paragraphs.energy1, paragraphs.coulomb1],
  ];
  for (const [heading, first, second] of fillerSections) {
    sectionPages.push({ heading, blocks: [first, second] });
  }

  const totalPages = sectionPages.length + 1;
  const pageStreams = [];

  const cover = new PdfPageBuilder();
  cover.space(110);
  cover.centeredLine([{ f: "HB", size: 26, text: "Electromagnetic Fields" }], { leading: 30 });
  cover.space(6);
  cover.centeredLine([{ f: "H", size: 14, text: "Lecture Notes - Chapter 3: Electrostatics" }], { leading: 20 });
  cover.space(2);
  cover.centeredLine([{ f: "HO", size: 11, text: "Department of Physics" }], { leading: 18 });
  cover.space(28);
  cover.rule();
  cover.space(8);
  cover.textLine([{ f: "HB", size: 12, text: "Abstract" }], { leading: 18 });
  cover.space(4);
  cover.paragraph(paragraphs.abstract, { font: "HO", size: 10.5 });
  cover.space(8);
  cover.rule();
  cover.pageNumber(1, totalPages);
  pageStreams.push(cover.stream());

  sectionPages.forEach((section, index) => {
    const builder = new PdfPageBuilder();
    builder.space(8);
    builder.textLine([{ f: "HB", size: 15, text: section.heading }], { leading: 22 });
    builder.space(8);
    for (const block of section.blocks) {
      if (typeof block === "string") {
        builder.paragraph(block);
        builder.space(10);
      } else {
        builder.space(6);
        builder.centeredLine(block.eq, { leading: 18 });
        builder.space(12);
      }
    }
    builder.pageNumber(index + 2, totalPages);
    pageStreams.push(builder.stream());
  });

  return assemblePdf(pageStreams);
}

function assemblePdf(pageStreams) {
  const fonts = [
    ["Helvetica", "WinAnsiEncoding"],
    ["Helvetica-Bold", "WinAnsiEncoding"],
    ["Helvetica-Oblique", "WinAnsiEncoding"],
    ["Symbol", null],
  ];
  const pageCount = pageStreams.length;
  const fontObjStart = 3 + pageCount * 2;

  const objects = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);

  const fontRefs = `<< /F1 ${fontObjStart} 0 R /F2 ${fontObjStart + 1} 0 R /F3 ${fontObjStart + 2} 0 R /F4 ${fontObjStart + 3} 0 R >>`;
  pageStreams.forEach((stream, i) => {
    const contentRef = 3 + i * 2 + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font ${fontRefs} >> /Contents ${contentRef} 0 R >>`
    );
    objects.push({ stream });
  });
  for (const [baseFont, encoding] of fonts) {
    objects.push(
      `<< /Type /Font /Subtype /Type1 /BaseFont /${baseFont}${encoding ? ` /Encoding /${encoding}` : ""} >>`
    );
  }

  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(body, "latin1");
    if (typeof object === "string") {
      body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    } else {
      const length = Buffer.byteLength(object.stream, "latin1");
      body += `${index + 1} 0 obj\n<< /Length ${length} >>\nstream\n${object.stream}\nendstream\nendobj\n`;
    }
  });
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

// ---------------------------------------------------------------------------
// Demo workspace content (BlockNote block JSON)
// ---------------------------------------------------------------------------

function text(value, styles = {}) {
  return { type: "text", text: value, styles };
}

function block(type, props, content, children = []) {
  return { type, props, content, children };
}

const physicsContent = [
  block("heading", { level: 2 }, [text("Key concepts")]),
  block("paragraph", {}, [
    text("The electric field assigns a vector to every point in space. Everything in electrostatics follows from "),
    text("Coulomb's law", { bold: true }),
    text(" plus the principle of superposition."),
  ]),
  block("bulletListItem", {}, [text("Field lines start on positive charges and end on negative ones — they never cross.")]),
  block("bulletListItem", {}, [text("Flux through a closed surface depends only on the enclosed charge (Gauss's law).")]),
  block("bulletListItem", {}, [text("Inside a conductor in equilibrium the field is exactly zero.")]),
  block("heading", { level: 2 }, [text("This week")]),
  block("checkListItem", { checked: true }, [text("Re-read chapter 3 and annotate the PDF in Studio")]),
  block("checkListItem", { checked: true }, [text("Derive Gauss's law from Coulomb's law")]),
  block("checkListItem", { checked: false }, [text("Problem set 4 — questions 1 to 6")]),
  block("checkListItem", { checked: false }, [text("Office hours: ask about dielectrics")]),
];

const studioNoteContent = [
  block("heading", { level: 2 }, [text("Chapter 3 — Electrostatics")]),
  block("paragraph", {}, [
    text("Reading notes for the lecture PDF. The central move of the chapter: replace "),
    text("action at a distance", { italic: true }),
    text(" with a field defined at every point in space."),
  ]),
  block("heading", { level: 3 }, [text("Gauss's law")]),
  block("paragraph", {}, [
    text("Flux through any closed surface counts only the "),
    text("enclosed", { bold: true }),
    text(" charge — shape of the surface is irrelevant. Use symmetry to pick a surface where the field is constant."),
  ]),
  block("bulletListItem", {}, [text("Spherical symmetry → point-charge field outside any shell")]),
  block("bulletListItem", {}, [text("Cylindrical symmetry → field falls off as 1/r")]),
  block("bulletListItem", {}, [text("Planar symmetry → uniform field, independent of distance")]),
  block("heading", { level: 3 }, [text("Open questions")]),
  block("checkListItem", { checked: false }, [text("Why exactly does the inverse-square law make the flux surface-independent?")]),
  block("checkListItem", { checked: false }, [text("Work through the dipole field-line sketch on page 8")]),
];

const readingContent = [
  block("heading", { level: 2 }, [text("Currently reading")]),
  block("paragraph", {}, [
    text("The Order of Time", { italic: true }),
    text(" — Carlo Rovelli. Time as an emergent, statistical phenomenon rather than a fundamental backdrop."),
  ]),
  block("bulletListItem", {}, [text("Ch. 2: entropy is the only law that distinguishes past from future")]),
  block("bulletListItem", {}, [text("Ch. 4: the present is local, not universal")]),
  block("heading", { level: 2 }, [text("Up next")]),
  block("checkListItem", { checked: false }, [text("Surely You're Joking, Mr. Feynman!")]),
  block("checkListItem", { checked: false }, [text("The Character of Physical Law")]),
];

const launchContent = [
  block("heading", { level: 2 }, [text("Goal")]),
  block("paragraph", {}, [
    text("Ship the public beta by "),
    text("end of the month", { bold: true }),
    text(", with signed builds for macOS and Windows."),
  ]),
  block("heading", { level: 2 }, [text("Checklist")]),
  block("checkListItem", { checked: true }, [text("Landing page copy")]),
  block("checkListItem", { checked: true }, [text("Press kit + screenshots")]),
  block("checkListItem", { checked: false }, [text("Notarize the macOS build")]),
  block("checkListItem", { checked: false }, [text("Announcement thread")]),
];

const pastaContent = [
  block("heading", { level: 2 }, [text("Cacio e pepe")]),
  block("paragraph", {}, [text("Four ingredients, zero excuses. The sauce is an emulsion — the starchy water does the work.")]),
  block("bulletListItem", {}, [text("Tonnarelli or spaghetti, 320 g")]),
  block("bulletListItem", {}, [text("Pecorino Romano, 200 g, finely grated")]),
  block("bulletListItem", {}, [text("Black pepper, toasted and crushed")]),
  block("checkListItem", { checked: false }, [text("Try the risottata method next time")]),
];

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function seedWorkspace(window, pdfPath) {
  return await window.evaluate(
    async ({ pdfPath, contents }) => {
      const api = window.openNotion;
      const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
      const createPage = async (title, parentId, minutesAgo) =>
        await api.invoke("create_page", {
          id: crypto.randomUUID(),
          title,
          parentId,
          createdAt: iso(minutesAgo),
        });
      const updatePage = async (id, updates, minutesAgo) =>
        await api.invoke("update_page", { id, updates, updatedAt: iso(minutesAgo) });

      // Notes workspace ----------------------------------------------------
      const recipes = await createPage("Recipes", null, 60 * 24 * 6);
      const pasta = await createPage("Weeknight Pasta", recipes.id, 60 * 24 * 6);
      const desserts = await createPage("Desserts", recipes.id, 60 * 24 * 5);

      const reading = await createPage("Reading Notes", null, 60 * 24 * 4);
      const launch = await createPage("Product Launch", null, 60 * 24 * 3);
      const checklist = await createPage("Launch Checklist", launch.id, 60 * 24 * 3);
      const positioning = await createPage("Positioning", launch.id, 60 * 24 * 2);

      const physics = await createPage("Physics - Electromagnetism", null, 60 * 24 * 2);
      const lecture1 = await createPage("Lecture 1 - Coulomb's Law", physics.id, 60 * 24);
      const lecture2 = await createPage("Lecture 2 - Field Lines", physics.id, 60 * 12);

      // Icons, content, favorites — ordered so updated_at shapes "Recent".
      await updatePage(desserts.id, { icon: "🍰" }, 60 * 24 * 5);
      await updatePage(positioning.id, { icon: "🎯" }, 60 * 24 * 2);
      await updatePage(pasta.id, { icon: "🍝", content: JSON.stringify(contents.pasta), search_text: "cacio e pepe pecorino pepper emulsion" }, 60 * 30);
      await updatePage(recipes.id, { icon: "🥘" }, 60 * 28);
      await updatePage(checklist.id, { icon: "✅", content: JSON.stringify(contents.launch), search_text: "ship public beta signed builds landing page press kit notarize announcement" }, 60 * 9);
      await updatePage(launch.id, { icon: "🚀" }, 60 * 8);
      await updatePage(reading.id, { icon: "📖", content: JSON.stringify(contents.reading), search_text: "order of time rovelli entropy feynman" }, 60 * 6);
      await updatePage(lecture1.id, { icon: "📐" }, 60 * 5);
      await updatePage(lecture2.id, { icon: "🧲" }, 60 * 3);
      await updatePage(physics.id, { icon: "⚡", title: "Physics — Electromagnetism", content: JSON.stringify(contents.physics), search_text: "electric field coulomb gauss law field lines conductor problem set" }, 30);

      await api.invoke("toggle_favorite", { id: physics.id, isFavorite: true });
      await api.invoke("toggle_favorite", { id: reading.id, isFavorite: true });
      await api.invoke("toggle_favorite", { id: launch.id, isFavorite: true });

      // Studio document ----------------------------------------------------
      const documentId = crypto.randomUUID();
      const notePageId = crypto.randomUUID();
      const studioDocument = await api.invoke("import_studio_document", {
        documentId,
        notePageId,
        sourcePath: pdfPath,
        importedAt: iso(20),
      });
      await updatePage(notePageId, { icon: "⚡", content: JSON.stringify(contents.studioNote), search_text: "electrostatics gauss flux symmetry dipole" }, 10);
      await api.invoke("update_studio_document_viewer_state", {
        id: documentId,
        updates: { viewer_zoom: 90 },
        updatedAt: iso(10),
      });

      // Presentation state for the captures: a roomier sidebar and an even
      // PDF/note split.
      window.localStorage.setItem("opennotion-sidebar-width", "300");
      window.localStorage.setItem(`opennotion-studio-panel-ratio-${documentId}`, "60");

      return { physicsId: physics.id, documentId: studioDocument.id };
    },
    {
      pdfPath,
      contents: {
        physics: physicsContent,
        studioNote: studioNoteContent,
        reading: readingContent,
        launch: launchContent,
        pasta: pastaContent,
      },
    }
  );
}

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "opennotion-screenshots-"));
  const pdfPath = path.join(userDataDir, "Electromagnetic Fields - Chapter 3.pdf");
  fs.writeFileSync(pdfPath, buildDemoPdf());
  fs.mkdirSync(outputDir, { recursive: true });

  const launchArgs = [".", "--force-device-scale-factor=2"];
  if (process.getuid && process.getuid() === 0) launchArgs.push("--no-sandbox");

  // Point the app's userData (and therefore its SQLite database) at the
  // throwaway directory. XDG_CONFIG_HOME covers Linux; on macOS Electron
  // ignores it, so guard against clobbering a real workspace there.
  if (process.platform === "darwin") {
    throw new Error("run this on Linux (or add a userData override) so a real workspace is never touched");
  }
  const app = await _electron.launch({
    args: launchArgs,
    cwd: repoRoot,
    env: { ...process.env, XDG_CONFIG_HOME: userDataDir },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");

  await app.evaluate(({ BrowserWindow }, viewport) => {
    const [win] = BrowserWindow.getAllWindows();
    win.setContentSize(viewport.width, viewport.height);
  }, VIEWPORT);

  await window.getByRole("button", { name: "New page" }).waitFor({ timeout: 60_000 });
  console.log("App ready, seeding demo workspace…");
  await seedWorkspace(window, pdfPath);

  await window.reload();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("button", { name: "New page" }).waitFor({ timeout: 60_000 });
  await window.waitForTimeout(1500);

  const shoot = async (name) => {
    const file = path.join(outputDir, name);
    await window.screenshot({ path: file });
    console.log(`captured ${name}`);
  };

  // 1. Home dashboard ------------------------------------------------------
  await window.getByText("Recent workspace activity.").waitFor();
  await window.waitForTimeout(700);
  await shoot("opennotion-home.png");

  // 2. Page with subpages ----------------------------------------------------
  await window.getByRole("button", { name: /Physics — Electromagnetism/ }).first().click();
  await window.getByText("Key concepts").first().waitFor();
  await window.waitForTimeout(900);
  await shoot("opennotion-page-subpages.png");

  // 3. Slash command menu (on an empty lecture page) -------------------------
  await window.getByRole("button", { name: "Search" }).click();
  await window.getByPlaceholder("Search pages...").fill("Lecture 2");
  await window.waitForTimeout(400);
  await window.locator(".on-command-overlay").getByText(/Lecture 2/).first().click();
  await window.waitForFunction(() => {
    const title = document.querySelector("textarea[placeholder='Untitled']");
    return title instanceof HTMLTextAreaElement && title.value.startsWith("Lecture 2");
  });
  const editor = window.locator('[contenteditable="true"]').first();
  await editor.click();
  await window.keyboard.type("/");
  await window.getByText("Heading 1").first().waitFor();
  await window.waitForTimeout(700);
  await shoot("opennotion-slash-menu.png");
  await window.keyboard.press("Escape");
  await window.keyboard.press("Backspace");

  // 4. Search palette --------------------------------------------------------
  await window.getByRole("button", { name: "Search" }).click();
  await window.getByPlaceholder("Search pages...").waitFor();
  await window.waitForTimeout(700);
  await shoot("opennotion-search.png");
  await window.keyboard.press("Escape");

  // 5. Studio split view -----------------------------------------------------
  await window.getByRole("button", { name: "Studio" }).click();
  await window.getByRole("button", { name: /Electromagnetic Fields/ }).first().click();
  await window.locator("canvas").first().waitFor({ timeout: 60_000 });
  await window.getByText("Chapter 3 — Electrostatics").first().waitFor();
  await window.waitForTimeout(2500);
  await shoot("opennotion-studio-pdf.png");

  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
