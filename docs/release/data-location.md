# Data Location

OpenNotion stores local app data in per-user Application Support directories.
The native macOS app and the legacy Tauri app are separate products and must not
share persistence defaults.

## Native macOS App

Bundle identifier:

```text
org.opennotion.native
```

Default data directory:

```sh
~/Library/Application Support/org.opennotion.native/
```

Main files:

```text
opennotion-native.db
native-backups/
```

The native app creates a backup before the first live write to an existing
native database.

## Legacy Tauri App

Bundle identifier:

```text
org.opennotion.desktop
```

Default data directory:

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

Existing local development data under the old identifier is not automatically
migrated.

## Migration Rule

Native and Tauri data migration must be explicit. Do not copy or import legacy
Tauri data at native startup.
