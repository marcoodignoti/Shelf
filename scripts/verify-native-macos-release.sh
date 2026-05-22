#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${APP_NAME:-OpenNotion}"
EXECUTABLE_NAME="${EXECUTABLE_NAME:-OpenNotionNative}"
BUNDLE_IDENTIFIER="${BUNDLE_IDENTIFIER:-org.opennotion.native}"
DIST_DIR="${NATIVE_RELEASE_DIR:-$ROOT_DIR/dist/native-release}"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$ROOT_DIR/package.json', 'utf8')).version")"
REQUIRE_DEVELOPER_ID="${REQUIRE_DEVELOPER_ID:-false}"
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

APP_PATH="${1:-$DIST_DIR/$APP_NAME.app}"
DMG_PATH="${2:-$DIST_DIR/${APP_NAME}_${VERSION}_${BUNDLE_ARCH}.dmg}"
INFO_PLIST="$APP_PATH/Contents/Info.plist"
APP_BINARY="$APP_PATH/Contents/MacOS/$EXECUTABLE_NAME"
VERIFY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/opennotion-native-release-verify.XXXXXX")"
VERIFY_APP_PATH="$VERIFY_ROOT/$APP_NAME.app"
VERIFY_APP_BINARY="$VERIFY_APP_PATH/Contents/MacOS/$EXECUTABLE_NAME"
trap 'rm -rf "$VERIFY_ROOT"' EXIT

fail() {
  echo "native macOS release verification failed: $*" >&2
  exit 1
}

[[ -d "$APP_PATH" ]] || fail "missing app bundle: $APP_PATH"
[[ -f "$INFO_PLIST" ]] || fail "missing Info.plist: $INFO_PLIST"
[[ -x "$APP_BINARY" ]] || fail "missing executable: $APP_BINARY"

[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundlePackageType' "$INFO_PLIST")" == "APPL" ]] || fail "CFBundlePackageType is not APPL"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$INFO_PLIST")" == "$EXECUTABLE_NAME" ]] || fail "CFBundleExecutable mismatch"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$INFO_PLIST")" == "$BUNDLE_IDENTIFIER" ]] || fail "CFBundleIdentifier mismatch"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST")" == "$VERSION" ]] || fail "version mismatch"
/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' "$INFO_PLIST" | grep -qx "opennotion" || fail "missing opennotion URL scheme"

ditto --norsrc "$APP_PATH" "$VERIFY_APP_PATH"
file "$VERIFY_APP_BINARY"
codesign --verify --deep --strict --verbose=2 "$VERIFY_APP_PATH"
SIGNING_INFO="$(codesign -dv --verbose=4 "$VERIFY_APP_PATH" 2>&1)"
echo "$SIGNING_INFO"

if [[ "$REQUIRE_DEVELOPER_ID" == "true" || "$REQUIRE_DEVELOPER_ID" == "1" ]]; then
  if echo "$SIGNING_INFO" | grep -q "Signature=adhoc"; then
    fail "app is ad-hoc signed"
  fi

  if echo "$SIGNING_INFO" | grep -q "TeamIdentifier=not set"; then
    fail "app has no TeamIdentifier"
  fi

  if ! echo "$SIGNING_INFO" | grep -q "Runtime Version"; then
    fail "app is not signed with hardened runtime"
  fi

  spctl --assess --type execute --verbose=4 "$VERIFY_APP_PATH"
fi

if [[ -f "$DMG_PATH" ]]; then
  hdiutil imageinfo "$DMG_PATH" >/dev/null
  if [[ "$REQUIRE_DEVELOPER_ID" == "true" || "$REQUIRE_DEVELOPER_ID" == "1" ]]; then
    spctl --assess --type open --verbose=4 "$DMG_PATH"
  fi
else
  fail "missing DMG: $DMG_PATH"
fi

echo "native macOS release verification ok"
