# Security Hardening Pass — Design

**Date:** 2026-06-16
**Branch:** `security/review-and-fix`
**Scope:** Remediation of findings M1, L2, L1, M2, L3 from the 2026-06-16 security review.

## Context

A security review of the Electron + React codebase found no critical or
high-severity vulnerabilities. The Electron hardening fundamentals are sound
(context isolation, sandbox, node-integration off, trusted-sender IPC checks,
fully parameterized SQL, path-traversal guards, signed update manifest flow).
The five findings below are medium-to-low severity. This spec covers the
remediation of all five, executed in order M1 → L2 → L1 → M2 → L3.

A key constraint surfaced during brainstorming: **the maintainer does not have
an Apple Developer ID.** M1 is therefore scoped to build *dormant* tooling that
activates automatically once a Developer ID is obtained, plus a SHA-256
checksum mechanism that protects users *today*, before any certificate exists.

## Guiding principles

- **Slot into existing patterns** — reuse the env-gated codesign model already
  in `electron-package-dir.cjs`, reuse the `fileSha256` logic already in
  `write-beta-update-manifest.cjs`, reuse `ensurePrivateDirectory` for L2.
- **Secret-safe by default** — every new capability is a no-op (or a safe
  fallback) when the required secret/env var is absent, so the existing
  unsigned workflow keeps working until a Developer ID exists.
- **One behavioral change per fix** — each step is independently testable and
  independently revertable.

## M1 — Code-signing/notarization tooling + checksums

Splits into two deliverables: (a) dormant notarization tooling, and (b) SHA-256
checksum publication that works today.

### M1(a) — Notarization tooling (dormant)

**New file:** `scripts/electron-notarize.cjs`

Exports `notarizeApp({ appPath, dmgPath })`. Reads Apple credentials from env:
`SHELF_APPLE_ID`, `SHELF_APPLE_APP_SPECIFIC_PASSWORD`, `SHELF_APPLE_TEAM_ID`.
It also checks `SHELF_MAC_CODESIGN_IDENTITY` (already used by the codesign
step) to decide whether a real signing identity is present.

- **No-op fallback (today):** when any Apple credential is missing, log
  `"Skipping notarization (no Apple credentials)"` and return without invoking
  `xcrun`. This keeps CI green with no certificates present.
- **Active path (when certs exist):** `xcrun notarytool submit <dmg> --apple-id
  ... --team-id ... --password ... --wait`, then `xcrun stapler staple <dmg>`
  and `xcrun stapler staple <app>`. Throw on non-zero exit (staple failure is a
  release blocker once notarization is active, matching the codesign-verify
  strictness in `electron-package-dir.cjs`).

**Wiring:** call `notarizeApp` from `scripts/electron-package-dmg.cjs` after
`hdiutil create`/`verify`, gated identically to the codesign step (env-driven,
no hard requirement). No new public npm script needed — it is part of
`release:package:macos`. The function signature takes both paths so it can
notarize and staple both the `.app` and the `.dmg`.

**`spawnSync` discipline:** matches the existing `run()` helper pattern in
`electron-package-dmg.cjs` — inherit stdio, throw on non-zero status. No shell,
no `exec`, no string interpolation of secrets into a shell (args passed as an
array to `spawnSync`).

### M1(b) — Checksums (works today)

**New file:** `scripts/write-release-checksums.cjs`

Computes SHA-256 of every release artifact under `dist-electron/` matching
`Shelf_*.{dmg,zip,exe}` and writes `dist-electron/SHA256SUMS` in the standard
`<hash>  <filename>` format (one per line). Reuses the `fileSha256` logic from
`write-beta-update-manifest.cjs` — that logic is small enough to duplicate
verbatim (5 lines) rather than introduce a shared module; the duplication is
localized to release scripts that already share conventions.

**New file:** `scripts/verify-release-checksums.cjs`

User-facing verifier. Usage: `node scripts/verify-release-checksums.cjs <file>
[sha256-or-SHA256SUMS-path]`. If the second arg is a `SHA256SUMS` file, look up
the matching basename; if it's a 64-hex string, compare directly. Exits non-zero
on mismatch. Pure `crypto`, no third-party deps. This is the protection that
works today: a user downloads the dmg and `SHA256SUMS`, runs the script, and
confirms integrity out-of-band before opening an unsigned binary.

**Wiring:**
- Add npm script `release:checksums` → `node scripts/write-release-checksums.cjs`.
- In `publish-release-assets.yml`, run `write-release-checksums.cjs` after the
  CI artifacts are downloaded into `dist-electron/`, and add `SHA256SUMS` to the
  `gh release upload` asset list.
- Document the verify command in `SECURITY.md` under the distribution caveats.

### M1 tests

- `scripts/electron-notarize.test.cjs`: require the module with Apple
  credentials unset and stub `child_process.spawnSync` to record invocations;
  call `notarizeApp(...)` and assert it resolves and that `spawnSync` was never
  called with `xcrun` (the no-op fallback must not touch the notarization tool
  chain). Restore the real `spawnSync` after the test.
- `scripts/verify-release-checksums.test.cjs`: write a temp file + known hash,
  assert the verifier matches and that a tampered buffer fails with non-zero
  exit.

### M1 files touched

- New: `scripts/electron-notarize.cjs`, `scripts/electron-notarize.test.cjs`
- New: `scripts/write-release-checksums.cjs`, `scripts/verify-release-checksums.cjs`
- New: `scripts/verify-release-checksums.test.cjs`
- Edit: `scripts/electron-package-dmg.cjs` (call `notarizeApp`)
- Edit: `package.json` (add `release:checksums` script)
- Edit: `.github/workflows/publish-release-assets.yml` (generate + upload SHA256SUMS)
- Edit: `SECURITY.md` (document verify command, note dormant notarize path)

## L2 — Restrict DB file permissions to 0o600

**Problem:** `ensurePrivateDirectory` (`backend.cjs:74`) sets the *directory* to
0o700, but `opennotion.db` is created by `DatabaseSync` with default umask
(typically 0644 on macOS). On a shared multi-user host, other local users could
read note contents.

**Fix:** add a `restrictDatabaseFilePermissions(dbPath)` helper in `backend.cjs`,
called from `openDatabase` after the DB opens. It chmods `opennotion.db`,
`opennotion.db-wal`, and `opennotion.db-shm` to `0o600` (whichever exist), each
wrapped in try/catch so a missing sidecar on a fresh DB does not fail startup.
Guarded `process.platform !== "win32"`, matching `ensurePrivateDirectory`'s
existing platform guard. Called immediately after `PRAGMA journal_mode = WAL`
runs, then once more at the end of `openDatabase` so WAL sidecars created by the
first write are covered.

**Test:** `electron/backend.test.cjs` (or co-located) — open a DB via
`openDatabase(tempDir)`, write a row, then assert
`fs.statSync(dbPath).mode & 0o077 === 0`. Skipped on Windows.

## L1 — KaTeX XSS regression guard

**Problem:** `renderFormulaHtml` (`editorMath.tsx:1271`) renders KaTeX output via
`dangerouslySetInnerHTML`. The current config (`trust: false`) is safe, but a
future flip of `trust` would become an XSS vector fed by user/backup content.

**Fix, two parts:**
1. **Comment** at `renderFormulaHtml` stating: *KaTeX output is rendered via
   `dangerouslySetInnerHTML`; `trust: false` is a security boundary — never
   change to `trust: true` without sanitizing output.*
2. **Unit test** `src/lib/editorMath.test.ts` — feed adversarial formulas and
   assert the output is XSS-free:
   - `\href{javascript:alert(1)}{x}`
   - `\url{data:text/html,<script>}`
   - raw `<script>alert(1)</script>`
   - raw `<img src=x onerror=alert(1)>`
   - a `trust`-bypass attempt via `\includegraphics`

   Assert output contains none of: `javascript:`, `<script`, `onerror=`, or
   `<img` with an event handler. Any future flip of `trust: true` fails this
   test. A test is preferred over a comment alone because comments rot.

## M2 — Tighten macOS entitlements

**Problem:** `packaging/entitlements.mac.plist` enables `allow-jit`,
`allow-unsigned-executable-memory`, and `disable-library-validation`, all true.
`disable-library-validation` is only required when loading third-party native
code. Shelf loads none.

**Fix:** remove `com.apple.security.cs.disable-library-validation` from the
plist. Keep `allow-jit` and `allow-unsigned-executable-memory` — V8 genuinely
needs them.

**Pre-check before removing:** grep the codebase for `.node` native modules and
`require(` of native addons to confirm none are loaded. Record the grep result
in the implementation.

**Subtlety:** with ad-hoc signing today, this is partly cosmetic, but tightening
it now means the entitlements are already correct the day a Developer ID is
obtained — no second pass needed. This composes with M1.

**L2/L1 tests cover regression risk; M2 has no unit test (it's a build-config
file).** Verified by the existing `release:verify:macos` codesign-verify step in
CI, which runs on every macOS package job.

## L3 — Tighten CSP `connect-src` to the actual bound port

**Problem:** `index.html` CSP allows
`connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*` (wildcard port). The
Studio PDF server binds an ephemeral port (`main.cjs:298-318`). If the renderer
were ever compromised, it could exfiltrate data to *any* local process.

**Fix:** move the CSP off the static `<meta>` in `index.html` and into a
response header injected by the custom-protocol handler in `main.cjs`
(`handleAppProtocolRequest`), so it can include the *runtime-known* bound port:
`connect-src 'self' http://127.0.0.1:<port> ws://127.0.0.1:<port>`.

- The dev-server (`ELECTRON_RENDERER_URL`) case keeps its own CSP derived from
  that URL — dev HMR must keep working.
- The `<meta>` tag in `index.html` stays as a **defense-in-depth fallback only**,
  narrowed from the current wildcard to `127.0.0.1` (no port wildcard) so the
  fallback is strictly safer than today even if the header path is somehow
  bypassed.

**Honest risk note:** L3 is the most behaviorally risky of the five — CSP
changes can silently break PDF loading or HMR, and CSP issues are hard to catch
without runtime testing. Mitigation: keep the dev-server path untouched, and
manually test the Studio PDF viewer in a packaged build before considering L3
done. If anything looks fragile, default to the narrower static meta tag only.

**Verification for L3:** manual open of a Studio PDF document in a packaged
build after the CSP change, confirming the PDF renders and range requests
succeed.

## Order of execution

1. **M1** — new scripts + workflow + SECURITY.md edit. No runtime behavior change
   in the app itself; all release-only.
2. **L2** — backend.cjs + test. Isolated, unit-tested.
3. **L1** — editorMath.tsx comment + test. Isolated, unit-tested.
4. **M2** — entitlements plist edit. Build-config only.
5. **L3** — index.html + main.cjs CSP. Highest runtime risk; done last so the
   earlier, safe changes are committed first.

## Verification (final gate)

- `npm run test` — L1, L2, M1 unit tests pass.
- `npm run build` — CSP / index.html change compiles, TypeScript clean.
- `npm run electron:smoke` — backend permissions + DB still work.
- Manual Studio PDF open in a packaged build — L3 did not break PDF loading.

## Out of scope

- Obtaining an Apple Developer ID or Windows code-signing certificate (the
  maintainer's to-do; the tooling built in M1 consumes them when present).
- Dependency audit automation beyond what `npm audit` in `check:electron`
  already provides.
- The other informational findings from the review (no action required).
