# Homebrew Beta Distribution

OpenNotion can offer macOS testers a guided Homebrew path without changing the
unsigned DMG release model.

## Tester Flow

```sh
brew tap marcoodignoti/opennotion
brew install --cask opennotion-beta
```

For later beta updates:

```sh
brew update
brew upgrade --cask opennotion-beta
```

This is not a silent in-app updater. Homebrew downloads the DMG, installs the
app into `/Applications`, and keeps the update action explicit.

## Tap Layout

Publish the cask in a dedicated tap repository:

```text
marcoodignoti/homebrew-opennotion
└── Casks
    └── opennotion-beta.rb
```

The source template lives at:

```text
packaging/homebrew/Casks/opennotion-beta.rb
```

## Release Checklist

1. Build and upload `OpenNotion_<version>_arm64.dmg`.
2. Compute SHA-256:

   ```sh
   shasum -a 256 dist-electron/OpenNotion_<version>_arm64.dmg
   ```

3. Update `version` and `sha256` in the cask.
4. Validate style:

   ```sh
   brew style --cask packaging/homebrew/Casks/opennotion-beta.rb
   ```

5. Copy the cask into the tap repository and push.

## Limits

- macOS only.
- Apple Silicon only until an Intel artifact exists.
- Unsigned builds can still trigger Gatekeeper warnings.
- Windows testers keep using the guided ZIP download flow.
