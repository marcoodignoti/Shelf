# Shelf beta-test checklist

A short, concrete first-run script to run through with 2–3 beta testers on macOS and
Windows **before** posting on Show HN / Reddit. The goal is to catch first-launch
friction (Gatekeeper, SmartScreen, update flow, Studio workflow) before it becomes the
public's first impression.

## How to use this

1. Send a tester the latest release link (and the Homebrew tap on macOS).
2. Sit with them in person or on a call if possible; otherwise ask them to note **where
   they got stuck** and **what they expected** at each step.
3. Do **not** coach them through the Gatekeeper/SmartScreen step before they hit it —
   that's the friction we are measuring.

---

## 1. Install (macOS — Apple Silicon)

- [ ] Tester downloads `Shelf_<version>_arm64.dmg` from the releases page.
- [ ] **OR** installs via Homebrew: `brew tap marcoodignoti/shelf && brew install --cask shelf-beta`.
- [ ] Tester drags Shelf to `/Applications`.
- [ ] First launch: Gatekeeper warns about an unidentified developer.
  - [ ] Tester is able to recover (right-click → Open → Open, **or** `xattr -dr com.apple.quarantine /Applications/Shelf.app`).
  - [ ] Note: how long did they hesitate? Did they understand the workaround?
- [ ] App opens to an empty workspace.

## 2. Install (Windows 10/11 x64)

- [ ] Tester downloads `Shelf_<version>_setup_win-x64.exe`.
- [ ] SmartScreen warns on first run.
  - [ ] Tester is able to recover (More info → Run anyway).
  - [ ] Note: same friction questions as above.
- [ ] Installer completes and Shelf launches.
- [ ] **Optional**: tester tries the portable build (`Shelf_<version>_win-x64.zip`).

## 3. First-run writing (notes mode)

- [ ] Tester creates a page from the sidebar / Home.
- [ ] Uses the slash command (`/`) to add a heading, a checklist, and a code block.
- [ ] Pastes a LaTeX snippet (e.g. `\[ E = mc^2 \]`) and sees it render as a formula.
- [ ] Creates a subpage and reorders it by drag and drop.
- [ ] Marks a page as favorite; sees it on Home.
- [ ] Presses `⌘K` / `Ctrl+K`, searches by title and by page content, and lands on a result.

## 4. Studio (the core workflow)

- [ ] Tester switches to Studio mode.
- [ ] Imports a real PDF they brought (ideally a long one, 100+ pages).
- [ ] Confirms the PDF opens on the left and a linked note is on the right.
- [ ] Pages through the PDF with arrow keys / trackpad swipe.
- [ ] Switches reading mode (continuous → single → two-page) and back.
- [ ] Types a note; confirms it's saved after restarting the app.
- [ ] Restarts Shelf and confirms the PDF opens at the **same page/zoom/layout**.
- [ ] (Stress) Tester opens a large PDF (500–800 pages) and scrolls: memory stays flat,
      scrolling is smooth.

## 5. Export & portability

- [ ] Tester exports a page as Markdown and opens the `.md` in another editor.
- [ ] Tester exports a page tree as JSON.
- [ ] Tester locates the local data folder
      (`~/Library/Application Support/org.opennotion.desktop/` on macOS; equivalent on
      Windows) and confirms `opennotion.db` and `backups/` exist.

## 6. Update flow

- [ ] Tester triggers an update check (or you push a patch release during the test).
- [ ] The **Restart to update** path applies the new version in place.
- [ ] The database backup snapshot appears under `backups/`.

## 7. Sign-off questions

Ask the tester directly:

- On a scale of 1–10, how much friction did the **install** add?
- Was the **local-first / no-account** model clear, or did they look for a sign-in?
- Did anything feel broken or confusing in the **Studio** workflow specifically?
- Would they keep using it? What's the single thing that would make them switch?

## 8. Gating rule for launch

Do **not** post Show HN / Reddit until:

- at least 2 testers on macOS **and** 1 on Windows complete steps 1–4 without coaching;
- no blocking bug surfaces in the Studio workflow (step 4);
- the install friction (step 1/2) is understood and documented well enough that a
  stranger could recover from it by reading the README alone.
