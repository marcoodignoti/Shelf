# Data Location

OpenNotion stores local app data in the per-user application support directory.

## Current Bundle Identifier

```text
org.opennotion.desktop
```

On macOS, data is stored here:

```sh
~/Library/Application Support/org.opennotion.desktop/
```

Main files:

```text
opennotion.db
covers/
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

The identifier was changed before public beta use to avoid personal naming in the app bundle. Existing local development data under the old identifier is not automatically migrated.

To migrate manually:

```sh
mkdir -p "$HOME/Library/Application Support/org.opennotion.desktop"
cp -R "$HOME/Library/Application Support/com.marcodignoti.opennotion/"* "$HOME/Library/Application Support/org.opennotion.desktop/"
```

To start from a clean database, do nothing. The app creates a new database on first launch.
