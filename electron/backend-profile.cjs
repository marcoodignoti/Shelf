const fs = require("node:fs");
const path = require("node:path");
const {
  PROFILE_METADATA_KEYS,
  PROFILE_TEXT_MAX_LENGTH,
} = require("./backend-helpers.cjs");

function createProfileBackend(context) {
  const profileBackend = {
    readMetadataValue(key) {
      const row = context.db
        .prepare("SELECT value FROM app_metadata WHERE key = ?")
        .get(key);
      return row ? row.value : null;
    },

    writeMetadataValue(key, value) {
      if (value === null) {
        context.db.prepare("DELETE FROM app_metadata WHERE key = ?").run(key);
        return;
      }
      context.db
        .prepare(
          "INSERT INTO app_metadata (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(key, value);
    },

    getWorkspaceProfile() {
      return {
        name: profileBackend.readMetadataValue(PROFILE_METADATA_KEYS.name) || "",
        workspaceName:
          profileBackend.readMetadataValue(PROFILE_METADATA_KEYS.workspaceName) ||
          "Shelf",
        avatarPath: profileBackend.readMetadataValue(
          PROFILE_METADATA_KEYS.avatarPath,
        ),
      };
    },

    updateWorkspaceProfile(args = {}) {
      if (args.name !== undefined) {
        if (
          typeof args.name !== "string" ||
          args.name.length > PROFILE_TEXT_MAX_LENGTH
        ) {
          throw new Error("profile name too long or invalid");
        }
        profileBackend.writeMetadataValue(PROFILE_METADATA_KEYS.name, args.name);
      }
      if (args.workspaceName !== undefined) {
        if (
          typeof args.workspaceName !== "string" ||
          args.workspaceName.length > PROFILE_TEXT_MAX_LENGTH
        ) {
          throw new Error("workspace name too long or invalid");
        }
        profileBackend.writeMetadataValue(
          PROFILE_METADATA_KEYS.workspaceName,
          args.workspaceName,
        );
      }
      if (args.avatarPath === null) {
        const avatarsDir = path.join(context.appConfigDir, "avatars");
        const existingPath = profileBackend.readMetadataValue(
          PROFILE_METADATA_KEYS.avatarPath,
        );
        if (existingPath) {
          try {
            const resolved = path.resolve(existingPath);
            if (
              resolved.startsWith(avatarsDir + path.sep) ||
              resolved === avatarsDir
            ) {
              fs.rmSync(resolved, { force: true });
            }
          } catch {
            // Best effort cleanup only; clearing metadata must still succeed.
          }
        }
        profileBackend.writeMetadataValue(PROFILE_METADATA_KEYS.avatarPath, null);
      }
      return profileBackend.getWorkspaceProfile();
    },
  };

  return profileBackend;
}

module.exports = {
  createProfileBackend,
};
