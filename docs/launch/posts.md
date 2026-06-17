# Launch posts (drafts)

These are drafts to review, not posts to publish. Do **not** post anywhere until the
beta-test checklist (`beta-test-checklist.md`) gating rule passes.

Tone across all of them: technical, transparent, no marketing language, no asking for
stars. The ask is feedback from people who study / read PDFs / take research notes.

Replace `[link]` / `[landing]` with real URLs before posting.

---

## Reddit (targeted subs)

Best-fit communities (read each subreddit's rules before posting):

- r/macapps
- r/PKMS
- r/notion (only if framed as a privacy/local-first option, not "use this instead")
- r/GradSchool, r/PhD (PDF workflow angle)
- r/productivity (local-first angle)

### Post

```text
I built Shelf, a local-first desktop workspace for notes and PDFs.

I wanted a Notion-like writing experience for study and research, but without sending
my PDFs and annotations to a cloud account. Shelf keeps everything in local SQLite —
no account, no cloud backend, no telemetry.

What's there today:
- a block editor (headings, checklists, code blocks, tables, KaTeX formulas);
- a split-screen PDF Studio: source on one side, linked note on the other, with
  viewer position/zoom/layout remembered per document;
- ⌘K / Ctrl+K full-text search across titles and page content;
- Markdown and JSON export;
- signed, SHA-256-verified in-app updates.

It's an early beta and I'm looking for feedback, not stars. Two things I already know
are rough: the macOS build is ad-hoc signed (not notarized, so Gatekeeper warns on
first launch), and the Windows build is not yet Authenticode-signed (SmartScreen warns).

If you study or read a lot of PDFs, I'd specifically like to hear:
- how painful the install is on your machine;
- whether the PDF + linked-note workflow fits how you actually work;
- whether the local-first / no-account model is clear or confusing.

GitHub: [link]
```

---

## Hacker News — Show HN

Rules: https://news.ycombinator.com/showhn.html
Do not coordinate upvotes or ask friends to comment. One shot — post it well.

### Title

```text
Show HN: Shelf – A local-first workspace for notes and PDFs
```

### Body

```text
Hi HN,

I built Shelf because I wanted a polished desktop workspace for study and research notes
without moving my PDFs and annotations into a cloud account.

It combines a block editor with a split-screen PDF Studio: read a source on one side,
write the linked note on the other, and keep the whole workspace stored locally in
SQLite. No account, no cloud backend, no telemetry.

What's there today:
- Notion-style block editor (slash commands, headings, checklists, code, tables, KaTeX);
- PDF Studio with position/zoom/layout remembered per document, flat memory use even in
  long PDFs;
- ⌘K / Ctrl+K full-text search across titles and content;
- Markdown and JSON export;
- signed, SHA-256-verified in-app updates.

Honest rough edges I already know about:
- macOS build is ad-hoc signed (hardened runtime) but not notarized, so Gatekeeper
  warns on first launch (right-click → Open to recover);
- Windows build is not yet Authenticode-signed, so SmartScreen warns (More info → Run
  anyway).

It's an early beta. I'm especially looking for feedback on:
- the PDF + linked-note workflow;
- install friction on macOS and Windows;
- whether the local-first model is clear enough.

GitHub: [link]
Landing: [landing]
```

---

## LinkedIn / X (short)

```text
I'm building Shelf: a private, local-first desktop workspace for notes and PDFs.

The goal: a Notion-like writing experience for study and research, but without cloud
lock-in — block editor, split-screen PDF Studio, local SQLite, Markdown/JSON export,
no account, no telemetry.

It's an early beta. I'm looking for feedback from students, researchers, and people who
work heavily with PDFs. If that's you, I'd value 15 minutes.

GitHub: [link]
```
