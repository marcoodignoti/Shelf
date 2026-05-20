#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Release gate failed: node is required to read package.json version." >&2
  exit 1
fi

if ! VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"; then
  echo "Release gate failed: could not extract version from package.json." >&2
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9]+[.][0-9]+[.][0-9]+([-.+][0-9A-Za-z.-]+)?$ ]]; then
  echo "Release gate failed: package.json version is invalid: $VERSION" >&2
  exit 1
fi

RAW_ARCH="$(uname -m)"

case "$RAW_ARCH" in
  arm64 | aarch64)
    BUNDLE_ARCH="aarch64"
    ;;
  x86_64 | amd64)
    BUNDLE_ARCH="x64"
    ;;
  *)
    BUNDLE_ARCH="$RAW_ARCH"
    ;;
esac

APP_PATH="${1:-src-tauri/target/release/bundle/macos/OpenNotion.app}"
DMG_PATH="${2:-src-tauri/target/release/bundle/dmg/OpenNotion_${VERSION}_${BUNDLE_ARCH}.dmg}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "Missing app bundle: $APP_PATH" >&2
  exit 1
fi

set +e
CODESIGN_VERIFY_OUTPUT="$(codesign --verify --deep --strict --verbose=2 "$APP_PATH" 2>&1)"
CODESIGN_VERIFY_STATUS=$?
set -e

SIGNING_INFO="$(codesign -dv --verbose=4 "$APP_PATH" 2>&1)"
echo "$SIGNING_INFO"

if echo "$SIGNING_INFO" | grep -q "Signature=adhoc"; then
  echo "Release gate failed: app is ad-hoc signed." >&2
  exit 1
fi

if echo "$SIGNING_INFO" | grep -q "TeamIdentifier=not set"; then
  echo "Release gate failed: app has no TeamIdentifier." >&2
  exit 1
fi

if [[ "$CODESIGN_VERIFY_STATUS" -ne 0 ]]; then
  echo "$CODESIGN_VERIFY_OUTPUT" >&2
  echo "Release gate failed: app signature verification failed." >&2
  exit 1
fi

spctl --assess --type execute --verbose=4 "$APP_PATH"

if [[ -f "$DMG_PATH" ]]; then
  spctl --assess --type open --verbose=4 "$DMG_PATH"
else
  echo "DMG not found, skipping DMG assessment: $DMG_PATH" >&2
fi
