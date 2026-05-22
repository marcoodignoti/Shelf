#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  echo "native release pipeline contract failed: $*" >&2
  exit 1
}

assert_file() {
  [[ -f "$ROOT_DIR/$1" ]] || fail "missing $1"
}

assert_executable() {
  [[ -x "$ROOT_DIR/$1" ]] || fail "$1 is not executable"
}

assert_contains() {
  local path="$1"
  local pattern="$2"
  grep -Eq -- "$pattern" "$ROOT_DIR/$path" || fail "$path does not contain pattern: $pattern"
}

assert_not_contains() {
  local path="$1"
  local pattern="$2"
  if grep -Eq -- "$pattern" "$ROOT_DIR/$path"; then
    fail "$path still contains forbidden pattern: $pattern"
  fi
}

assert_file "scripts/package-native-macos.sh"
assert_file "scripts/verify-native-macos-release.sh"
assert_executable "scripts/package-native-macos.sh"
assert_executable "scripts/verify-native-macos-release.sh"

assert_contains "scripts/package-native-macos.sh" "swift build --configuration release"
assert_contains "scripts/package-native-macos.sh" 'APP_NAME.*OpenNotion'
assert_contains "scripts/package-native-macos.sh" 'APP_BUNDLE=.*APP_NAME.*\.app'
assert_contains "scripts/package-native-macos.sh" "codesign"
assert_contains "scripts/package-native-macos.sh" "hdiutil create"
assert_contains "scripts/package-native-macos.sh" "notarytool submit"

assert_contains "scripts/verify-native-macos-release.sh" "codesign --verify"
assert_contains "scripts/verify-native-macos-release.sh" "REQUIRE_DEVELOPER_ID"
assert_contains "scripts/verify-native-macos-release.sh" "spctl --assess"
assert_contains "scripts/verify-native-macos-release.sh" "OpenNotionNative"

assert_contains "package.json" "\"release:package:macos\""
assert_contains "package.json" "\"release:verify:macos\""

assert_contains ".github/workflows/macos-release.yml" "scripts/package-native-macos.sh"
assert_contains ".github/workflows/macos-release.yml" "scripts/verify-native-macos-release.sh"
assert_not_contains ".github/workflows/macos-release.yml" "npm run tauri build"

assert_contains ".github/workflows/unsigned-beta-release.yml" "scripts/package-native-macos.sh"
assert_contains ".github/workflows/unsigned-beta-release.yml" "OpenNotion_.*\\.dmg"
assert_not_contains ".github/workflows/unsigned-beta-release.yml" "windows-latest|nsis|msi|npm run tauri build"

assert_contains ".github/workflows/ci.yml" "scripts/package-native-macos.sh"
assert_contains ".github/workflows/ci.yml" "Native release contract"

echo "native release pipeline contract ok"
