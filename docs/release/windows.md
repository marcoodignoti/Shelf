# Windows Release Checklist

Shelf's Windows release ships two artifacts from GitHub Actions:

- unsigned portable Electron zip for compatibility with existing testers
- unsigned NSIS installer for Windows auto-update support

## GitHub Actions Artifact

The `Windows package` job in `.github/workflows/ci.yml` runs on
`windows-2025` and uploads:

```text
Shelf_0.1.4_win-x64.zip
Shelf_0.1.4_setup_win-x64.exe
latest.yml
```

Inside the extracted zip:

```text
Shelf.exe
```

`latest.yml` must be uploaded to the same GitHub Release as the installer.
`electron-updater` uses that file to discover and download future Windows
installer updates.

## Local Windows Build

Run on Windows:

```sh
npm ci
npm run release:package:windows
npm run release:package:windows:installer
```

Generated portable directory:

```text
dist-electron/win-x64/Shelf/
```

Generated installer files:

```text
dist-electron/builder/Shelf_0.1.4_setup_win-x64.exe
dist-electron/builder/latest.yml
```

## Acceptance Criteria

- `Shelf.exe` launches on a clean Windows account.
- Notes, images, Studio documents, and settings persist after relaunch.
- App data is created per user and is not bundled into the zip.
- SmartScreen warning is expected until code signing is implemented.
- The zip does not contain local development databases, imported PDFs, editor
  images, covers, or Studio documents.
- Portable zip beta update notices open the latest GitHub Release zip manually.
- Installer builds check for Windows updates in background, download newer
  installers automatically, and install on app quit.

## Not Yet Supported

- Authenticode-signed Windows installer
- SmartScreen reputation
- Microsoft Store packaging
