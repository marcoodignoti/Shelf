# Contributing

Thanks for taking time to improve Shelf.

Shelf is a local-first desktop app. Contributions should preserve that
product direction: private by default, no required cloud account, and no
unexpected network dependency for core notes or Studio documents.

## Development Setup

For a fuller repository walkthrough, see the
[developer guide](docs/developer-guide.md).

```sh
npm ci
npm run electron:dev
```

## Opening Issues

Use the bug report template for reproducible app problems, beta feedback for
release testing notes, and feature requests for new workflows. Remove private
notes, PDFs, screenshots, databases, and local app data before attaching files.

## Quality Gate

Run the main gate before opening a pull request:

```sh
npm run check
```

For browser E2E coverage:

```sh
npm run e2e
```

For macOS release packaging:

```sh
npm run release:package:macos
npm run release:verify:macos
```

## Pull Request Guidelines

- Keep changes focused.
- Link the issue or release task when one exists.
- Add tests for persistence, destructive actions, editor behavior, and release
  packaging changes.
- Do not commit generated build output such as `dist/`, `dist-electron/`, local
  databases, or Playwright result folders.
- Do not commit private workspaces, imported PDFs, screenshots containing
  private data, or app data from `~/Library/Application Support`.
- Update docs when behavior, commands, release packaging, or data locations
  change.

## Local-First Rules

- User content must stay in local app data unless a future feature explicitly
  asks the user to export or share it.
- Builds must not include local databases, imported PDFs, editor images, covers,
  or Studio documents.
- Destructive actions need clear confirmation and tests.

## Code Style

Follow existing patterns in `src/`, `electron/`, and `scripts/`. Prefer small
helpers over broad abstractions. Keep release scripts explicit and easy to audit.
