const fs = require("node:fs");
const path = require("node:path");
const {
  BACKUP_MAX_BYTES,
  PROFILE_TEXT_MAX_LENGTH,
  PROFILE_METADATA_KEYS,
  validateBackupExportDestination,
  readImportedBackup,
  parseImportedBackup,
  prepareImportedBackupPages,
} = require("./backend-helpers.cjs");

function createBackupBackend(context) {
  const backupBackend = {
    exportBackup({ path: filePath, exportedAt, exported_at }) {
      const exported = exportedAt ?? exported_at;
      validateBackupExportDestination(filePath);
      const pages = context.listAllPages();
      const profile = (() => {
        const p = context.getWorkspaceProfile();
        return { name: p.name, workspaceName: p.workspaceName };
      })();
      const raw = JSON.stringify(
        { version: 1, exported_at: exported, profile, pages },
        null,
        2,
      );
      if (Buffer.byteLength(raw, "utf8") > BACKUP_MAX_BYTES)
        throw new Error("Backup export is too large");
      // Write-to-temp-then-rename so an interrupted write (disk full, crash)
      // cannot leave a truncated backup at the destination.
      const tempPath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${process.pid}.tmp`,
      );
      try {
        fs.writeFileSync(tempPath, raw);
        fs.renameSync(tempPath, filePath);
      } catch (error) {
        fs.rmSync(tempPath, { force: true });
        throw error;
      }
      return pages.length;
    },

    importBackup({ path: filePath, importedAt, imported_at }) {
      const imported = importedAt ?? imported_at;
      const backup = readImportedBackup(filePath);
      return backupBackend.importBackupData(backup, imported);
    },

    importBackupContent({ content, importedAt, imported_at }) {
      const imported = importedAt ?? imported_at;
      if (typeof content !== "string")
        throw new Error("backup content is required");
      return backupBackend.importBackupData(parseImportedBackup(content), imported);
    },

    backupProfilePatch(backup) {
      if (
        !backup.profile ||
        typeof backup.profile !== "object" ||
        Array.isArray(backup.profile)
      )
        return null;
      const patch = {};
      const { name, workspaceName } = backup.profile;
      if (name !== undefined) {
        if (typeof name !== "string" || name.length > PROFILE_TEXT_MAX_LENGTH) {
          throw new Error("backup profile name too long or invalid");
        }
        patch.name = name;
      }
      if (workspaceName !== undefined) {
        if (
          typeof workspaceName !== "string" ||
          workspaceName.length > PROFILE_TEXT_MAX_LENGTH
        ) {
          throw new Error("backup workspace name too long or invalid");
        }
        patch.workspaceName = workspaceName;
      }
      return patch;
    },

    importBackupData(backup, imported) {
      const profilePatch = backupBackend.backupProfilePatch(backup);
      const importedPages = prepareImportedBackupPages(backup.pages, imported);
      let importedCount = 0;
      context.withTransaction(() => {
        importedCount = context.importPageRecords(importedPages, {
          inTransaction: true,
        });
        if (profilePatch) {
          const current = context.getWorkspaceProfile();
          if (current.name === "" && current.workspaceName === "Shelf") {
            if (profilePatch.name !== undefined) {
              context.writeMetadataValue(
                PROFILE_METADATA_KEYS.name,
                profilePatch.name,
              );
            }
            if (profilePatch.workspaceName !== undefined) {
              context.writeMetadataValue(
                PROFILE_METADATA_KEYS.workspaceName,
                profilePatch.workspaceName,
              );
            }
          }
        }
      });
      return importedCount;
    },
  };

  return backupBackend;
}

module.exports = { createBackupBackend };
