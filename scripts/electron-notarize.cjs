const { spawnSync } = require("node:child_process");

function env(name, fallback = "") {
  return process.env[name] && process.env[name].trim() ? process.env[name].trim() : fallback;
}

function hasAppleCredentials() {
  return Boolean(
    env("SHELF_APPLE_ID") &&
    env("SHELF_APPLE_APP_SPECIFIC_PASSWORD") &&
    env("SHELF_APPLE_TEAM_ID")
  );
}

function hasDeveloperIdIdentity() {
  const identity = env("SHELF_MAC_CODESIGN_IDENTITY", env("OPENNOTION_MAC_CODESIGN_IDENTITY"));
  return Boolean(identity) && identity !== "-";
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

// Notarization is dormant by default: it only runs when an Apple ID, app-specific
// password, team id, AND a real (non ad-hoc) codesign identity are present. With
// none of those, this returns { skipped: true } and touches nothing. The day a
// Developer ID is configured, notarization + stapling activate with no code change.
//
// Synchronous on purpose: it only uses spawnSync (no real async work), so the
// caller in electron-package-dmg.cjs can treat it like the other run() steps.
function notarizeApp({ appPath, dmgPath }) {
  if (!hasAppleCredentials() || !hasDeveloperIdIdentity()) {
    console.log("Skipping notarization (no Apple credentials or Developer ID).");
    return { skipped: true };
  }

  const appleId = env("SHELF_APPLE_ID");
  const password = env("SHELF_APPLE_APP_SPECIFIC_PASSWORD");
  const teamId = env("SHELF_APPLE_TEAM_ID");

  // Pass secrets as explicit args, never via a shell. spawnSync with an arg
  // array does not invoke /bin/sh, so the password is not visible in a shell
  // process list.
  run("xcrun", [
    "notarytool", "submit", dmgPath,
    "--apple-id", appleId,
    "--team-id", teamId,
    "--password", password,
    "--wait",
  ]);
  run("xcrun", ["stapler", "staple", dmgPath]);
  run("xcrun", ["stapler", "staple", appPath]);

  console.log(`Notarized and stapled ${dmgPath} and ${appPath}`);
  return { skipped: false };
}

module.exports = { notarizeApp, hasAppleCredentials, hasDeveloperIdIdentity };
