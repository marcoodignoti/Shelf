const {
  APP_SCHEMA_VERSION,
  STUDIO_PAGE_UNIFICATION_SCHEMA_VERSION,
  STUDIO_DOCUMENT_COLUMNS,
  STUDIO_PROJECT_COLUMNS,
  rowValue,
  studioProjectPageId,
  numericSchemaVersion,
} = require("./backend-helpers.cjs");

function createStudioUnificationBackend(context) {
  const studioUnificationBackend = {
    schemaVersion() {
      return String(
        rowValue(
          context.db
            .prepare(
              "SELECT value FROM app_metadata WHERE key = 'schema_version'",
            )
            .get(),
          "value",
          "1",
        ),
      );
    },

    isStudioPageUnified() {
      return (
        numericSchemaVersion(studioUnificationBackend.schemaVersion()) >= 2
      );
    },

    autoMigrateStudioPageUnification() {
      if (studioUnificationBackend.isStudioPageUnified()) return;
      const preview = studioUnificationBackend.previewStudioPageUnification();
      if (!preview.can_migrate) return;
      studioUnificationBackend.migrateStudioPageUnification({
        migratedAt: new Date().toISOString(),
      });
    },

    previewStudioPageUnification() {
      const schemaVersion = String(
        rowValue(
          context.db
            .prepare(
              "SELECT value FROM app_metadata WHERE key = 'schema_version'",
            )
            .get(),
          "value",
          APP_SCHEMA_VERSION,
        ),
      );
      const scalar = (sql) =>
        Number(rowValue(context.db.prepare(sql).get(), "value"));
      const missingPrimaryPages = scalar(`
        SELECT COUNT(*) AS value
        FROM studio_documents documents
        LEFT JOIN pages ON pages.id = documents.note_page_id AND pages.is_deleted = 0
        WHERE pages.id IS NULL
      `);
      const missingPrimaryLinks = scalar(`
        SELECT COUNT(*) AS value
        FROM studio_documents documents
        LEFT JOIN studio_document_page_links links
          ON links.document_id = documents.id
         AND links.page_id = documents.note_page_id
        WHERE links.id IS NULL
      `);
      const orphanLinks = scalar(`
        SELECT COUNT(*) AS value
        FROM studio_document_page_links links
        LEFT JOIN studio_documents documents ON documents.id = links.document_id
        LEFT JOIN pages ON pages.id = links.page_id AND pages.is_deleted = 0
        WHERE documents.id IS NULL OR pages.id IS NULL
      `);
      const blockers = [];
      if (missingPrimaryPages > 0) blockers.push("missing_primary_pages");
      if (missingPrimaryLinks > 0) blockers.push("missing_primary_links");
      if (orphanLinks > 0) blockers.push("orphan_links");

      return {
        schema_version: schemaVersion,
        project_count: scalar("SELECT COUNT(*) AS value FROM studio_projects"),
        nested_project_count: scalar(
          "SELECT COUNT(*) AS value FROM studio_projects WHERE parent_id IS NOT NULL",
        ),
        document_count: scalar(
          "SELECT COUNT(*) AS value FROM studio_documents",
        ),
        document_without_project_count: scalar(
          "SELECT COUNT(*) AS value FROM studio_documents WHERE project_id IS NULL",
        ),
        link_count: scalar(
          "SELECT COUNT(*) AS value FROM studio_document_page_links",
        ),
        linked_regular_page_count: scalar(`
          SELECT COUNT(*) AS value
          FROM studio_document_page_links links
          JOIN pages ON pages.id = links.page_id
          WHERE pages.is_deleted = 0 AND pages.page_kind = 'note'
        `),
        linked_studio_note_count: scalar(`
          SELECT COUNT(*) AS value
          FROM studio_document_page_links links
          JOIN pages ON pages.id = links.page_id
          WHERE pages.is_deleted = 0 AND pages.page_kind = 'studio_note'
        `),
        missing_primary_page_count: missingPrimaryPages,
        missing_primary_link_count: missingPrimaryLinks,
        orphan_link_count: orphanLinks,
        blockers,
        can_migrate: blockers.length === 0,
      };
    },

    backupStudioPageUnificationTables() {
      context.db.exec(`
        CREATE TABLE IF NOT EXISTS studio_documents_backup_page_unification AS
          SELECT * FROM studio_documents WHERE 0;
        CREATE TABLE IF NOT EXISTS studio_projects_backup_page_unification AS
          SELECT * FROM studio_projects WHERE 0;
        CREATE TABLE IF NOT EXISTS studio_document_page_links_backup_page_unification AS
          SELECT * FROM studio_document_page_links WHERE 0;
      `);
      if (
        rowValue(
          context.db
            .prepare(
              "SELECT COUNT(*) AS value FROM studio_documents_backup_page_unification",
            )
            .get(),
          "value",
        ) === 0
      ) {
        context.db.exec(
          "INSERT INTO studio_documents_backup_page_unification SELECT * FROM studio_documents",
        );
      }
      if (
        rowValue(
          context.db
            .prepare(
              "SELECT COUNT(*) AS value FROM studio_projects_backup_page_unification",
            )
            .get(),
          "value",
        ) === 0
      ) {
        context.db.exec(
          "INSERT INTO studio_projects_backup_page_unification SELECT * FROM studio_projects",
        );
      }
      if (
        rowValue(
          context.db
            .prepare(
              "SELECT COUNT(*) AS value FROM studio_document_page_links_backup_page_unification",
            )
            .get(),
          "value",
        ) === 0
      ) {
        context.db.exec(
          "INSERT INTO studio_document_page_links_backup_page_unification SELECT * FROM studio_document_page_links",
        );
      }
    },

    migrateStudioPageUnification({ migratedAt, migrated_at } = {}) {
      const migrated = migratedAt ?? migrated_at ?? new Date().toISOString();
      const before = studioUnificationBackend.previewStudioPageUnification();
      if (!before.can_migrate) {
        throw new Error(
          `cannot migrate Studio pages: ${before.blockers.join(", ")}`,
        );
      }

      context.withTransaction(() => {
        studioUnificationBackend.backupStudioPageUnificationTables();

        const projects = context.db
          .prepare(
            `SELECT ${STUDIO_PROJECT_COLUMNS} FROM studio_projects ORDER BY sort_order ASC, name ASC`,
          )
          .all();
        for (const project of projects) {
          context.mirrorStudioProjectPage(project, migrated);
        }

        const documents = context.db
          .prepare(
            `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents ORDER BY created_at ASC`,
          )
          .all();
        for (const document of documents) {
          const parentPageId = document.project_id
            ? studioProjectPageId(document.project_id)
            : null;
          context.db
            .prepare(
              `
            UPDATE pages
            SET title = ?, parent_id = ?, page_kind = 'note', updated_at = ?
            WHERE id = ?
          `,
            )
            .run(document.title, parentPageId, migrated, document.note_page_id);
        }

        for (const document of documents) {
          if (document.id === document.note_page_id) continue;
          const temporaryId = `__page_unification__${document.id}`;
          context.db
            .prepare("UPDATE studio_documents SET id = ? WHERE id = ?")
            .run(temporaryId, document.id);
          context.db
            .prepare(
              "UPDATE studio_document_page_links SET document_id = ? WHERE document_id = ?",
            )
            .run(temporaryId, document.id);
        }

        for (const document of documents) {
          if (document.id === document.note_page_id) continue;
          const temporaryId = `__page_unification__${document.id}`;
          context.db
            .prepare(
              "UPDATE studio_documents SET id = ?, updated_at = ? WHERE id = ?",
            )
            .run(document.note_page_id, migrated, temporaryId);
          context.db
            .prepare(
              "UPDATE studio_document_page_links SET document_id = ?, updated_at = ? WHERE document_id = ?",
            )
            .run(document.note_page_id, migrated, temporaryId);
        }

        context.db
          .prepare(
            `
          INSERT INTO app_metadata (key, value)
          VALUES ('schema_version', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `,
          )
          .run(STUDIO_PAGE_UNIFICATION_SCHEMA_VERSION);
      });

      return studioUnificationBackend.previewStudioPageUnification();
    },
  };

  return studioUnificationBackend;
}

module.exports = { createStudioUnificationBackend };
