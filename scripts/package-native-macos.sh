#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/native-macos"
OUTPUT_DIR="${NATIVE_RELEASE_DIR:-$ROOT_DIR/dist/native-release}"
APP_NAME="${APP_NAME:-OpenNotion}"
EXECUTABLE_NAME="${EXECUTABLE_NAME:-OpenNotionNative}"
BUNDLE_IDENTIFIER="${BUNDLE_IDENTIFIER:-org.opennotion.native}"
MIN_SYSTEM_VERSION="${MIN_SYSTEM_VERSION:-14.0}"
ENTITLEMENTS_PATH="${ENTITLEMENTS_PATH:-$ROOT_DIR/src-tauri/Entitlements.plist}"
ICON_PATH="${ICON_PATH:-$ROOT_DIR/src-tauri/icons/icon.icns}"
SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-${SIGNING_IDENTITY:--}}"
NOTARIZE="${NOTARIZE:-false}"

VERSION="$(node -p "JSON.parse(require('fs').readFileSync('$ROOT_DIR/package.json', 'utf8')).version")"
BUILD_NUMBER="${BUILD_NUMBER:-${GITHUB_RUN_NUMBER:-1}}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/opennotion-native-package.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT
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

APP_BUNDLE="$WORK_DIR/$APP_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
APP_BINARY="$APP_MACOS/$EXECUTABLE_NAME"
INFO_PLIST="$APP_CONTENTS/Info.plist"
DMG_ROOT="$WORK_DIR/dmg-root"
DMG_PATH="$WORK_DIR/${APP_NAME}_${VERSION}_${BUNDLE_ARCH}.dmg"
ZIP_PATH="$WORK_DIR/${APP_NAME}_${VERSION}_${BUNDLE_ARCH}.zip"
OUTPUT_APP_BUNDLE="$OUTPUT_DIR/$APP_NAME.app"
OUTPUT_DMG_PATH="$OUTPUT_DIR/${APP_NAME}_${VERSION}_${BUNDLE_ARCH}.dmg"

if [[ "${1:-}" == "--help" ]]; then
  cat <<EOF
usage: scripts/package-native-macos.sh

Environment:
  SIGNING_IDENTITY / APPLE_SIGNING_IDENTITY   codesign identity, defaults to ad-hoc "-"
  NOTARIZE=true                              submit DMG to Apple notarytool
  APPLE_API_KEY_PATH                         App Store Connect API key path
  APPLE_API_KEY                              App Store Connect key ID
  APPLE_API_ISSUER                           App Store Connect issuer ID
  NATIVE_RELEASE_DIR                         output directory, defaults to dist/native-release
EOF
  exit 0
fi

cleanup_xattrs() {
  local path
  for path in "$@"; do
    [[ -e "$path" ]] || continue
    xattr -cr "$path" 2>/dev/null || true
    xattr -d com.apple.FinderInfo "$path" 2>/dev/null || true
  done
}

submit_for_notarization() {
  local artifact="$1"
  : "${APPLE_API_KEY_PATH:?APPLE_API_KEY_PATH is required when NOTARIZE=true}"
  : "${APPLE_API_KEY:?APPLE_API_KEY is required when NOTARIZE=true}"
  : "${APPLE_API_ISSUER:?APPLE_API_ISSUER is required when NOTARIZE=true}"

  xcrun notarytool submit "$artifact" \
    --key "$APPLE_API_KEY_PATH" \
    --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" \
    --wait
}

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"
mkdir -p "$APP_MACOS" "$APP_RESOURCES"

swift build --configuration release --package-path "$PACKAGE_DIR" --product "$EXECUTABLE_NAME"
BUILD_BIN_DIR="$(swift build --configuration release --package-path "$PACKAGE_DIR" --show-bin-path)"
cp "$BUILD_BIN_DIR/$EXECUTABLE_NAME" "$APP_BINARY"
chmod +x "$APP_BINARY"

if [[ -f "$ICON_PATH" ]]; then
  cp "$ICON_PATH" "$APP_RESOURCES/AppIcon.icns"
fi

cat >"$INFO_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundleExecutable</key>
  <string>$EXECUTABLE_NAME</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_IDENTIFIER</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>$BUNDLE_IDENTIFIER.page</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>opennotion</string>
      </array>
    </dict>
  </array>
  <key>CFBundleVersion</key>
  <string>$BUILD_NUMBER</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.productivity</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MIN_SYSTEM_VERSION</string>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

echo "APPL????" > "$APP_CONTENTS/PkgInfo"
find "$APP_BUNDLE" -name ".DS_Store" -delete
cleanup_xattrs "$APP_BUNDLE"

if [[ "$SIGNING_IDENTITY" != "skip" ]]; then
  codesign_args=(
    --force
    --deep
    --strict
    --options runtime
    --sign "$SIGNING_IDENTITY"
  )

  if [[ "$SIGNING_IDENTITY" != "-" ]]; then
    codesign_args+=(--timestamp)
  fi

  if [[ -f "$ENTITLEMENTS_PATH" ]]; then
    codesign_args+=(--entitlements "$ENTITLEMENTS_PATH")
  fi

  codesign "${codesign_args[@]}" "$APP_BUNDLE"
fi

if [[ "$NOTARIZE" == "true" ]]; then
  ditto -c -k --keepParent "$APP_BUNDLE" "$ZIP_PATH"
  submit_for_notarization "$ZIP_PATH"
  xcrun stapler staple "$APP_BUNDLE"
  xcrun stapler validate "$APP_BUNDLE"
fi

rm -rf "$DMG_ROOT"
mkdir -p "$DMG_ROOT"
ditto --norsrc "$APP_BUNDLE" "$DMG_ROOT/$APP_NAME.app"
ln -s /Applications "$DMG_ROOT/Applications"
hdiutil create -volname "$APP_NAME" -srcfolder "$DMG_ROOT" -ov -format UDZO "$DMG_PATH"
cleanup_xattrs "$APP_BUNDLE" "$DMG_PATH"

if [[ "$NOTARIZE" == "true" ]]; then
  submit_for_notarization "$DMG_PATH"
  xcrun stapler staple "$DMG_PATH"
  xcrun stapler validate "$DMG_PATH"
fi

ditto --norsrc "$APP_BUNDLE" "$OUTPUT_APP_BUNDLE"
ditto --norsrc "$DMG_PATH" "$OUTPUT_DMG_PATH"
cleanup_xattrs "$OUTPUT_APP_BUNDLE" "$OUTPUT_DMG_PATH"

echo "app=$OUTPUT_APP_BUNDLE"
echo "dmg=$OUTPUT_DMG_PATH"
