# Data Location

Shelf stores local app data in the Electron Application Support directory.

## Electron Desktop App

Bundle identifier:

```text
com.marcodignoti.shelf
```

Default macOS data directory:

```sh
~/Library/Application Support/org.opennotion.desktop/
```

Shelf intentionally keeps the legacy `org.opennotion.desktop` data directory so
existing beta databases, covers, editor images, and Studio PDFs keep working
after the product rename.

Main files and folders:

```text
opennotion.db
covers/
editor-images/
studio-documents/
```

## Local Development

`npm run electron:dev` uses a separate project-local data directory by default:

```sh
.shelf-dev/user-data/
```

Set `SHELF_USER_DATA_DIR` to override that location for one-off debugging.

## Previous Beta Identifier

Early beta builds used:

```text
com.marcodignoti.opennotion
```

Those builds stored data here:

```sh
~/Library/Application Support/com.marcodignoti.opennotion/
```

Existing local development data under the old identifier is not automatically
migrated.

## Cleanup Rule

Deleting a Studio document should remove its linked note record and copied PDF.
Deleting editor images or covers needs explicit cleanup logic before public
release if orphaned files become measurable.
