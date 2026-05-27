# Data Location

OpenNotion stores local app data in the Tauri Application Support directory.

## Tauri Desktop App

Bundle identifier:

```text
org.opennotion.desktop
```

Default macOS data directory:

```sh
~/Library/Application Support/org.opennotion.desktop/
```

Main files and folders:

```text
opennotion.db
covers/
editor-images/
studio-documents/
```

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
