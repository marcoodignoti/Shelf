const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  PAGE_COLUMNS,
  STUDIO_DOCUMENT_COLUMNS,
  STUDIO_DOCUMENT_PAGE_LINK_COLUMNS,
  ensurePrivateDirectory,
  validatePageIdValue,
  validatedPdfFile,
  safeStorageId,
  validateManagedStudioDocumentPath,
  removeStoredStudioDocumentFile,
  pageSearchIndexAvailable,
  syncPageSearchIndexEntry,
} = require("./backend-helpers.cjs");

function createStudioDocumentBackend(context) {
  const studioDocumentBackend = {
    listStudioDocuments() {
      return context.db
        .prepare(
          `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents ORDER BY last_opened_at DESC, created_at DESC`,
        )
        .all();
    },

    studioPdfDestination(documentId) {
      const directory = path.join(
        context.appConfigDir,
        "studio-documents",
        safeStorageId(documentId),
      );
      ensurePrivateDirectory(directory);
      return path.join(directory, "source.pdf");
    },

    async importStudioDocument({
      documentId,
      document_id,
      notePageId,
      note_page_id,
      sourcePath,
      source_path,
      importedAt,
      imported_at,
    }) {
      const requestedDocumentId = documentId ?? document_id;
      const requestedNotePageId =
        notePageId ?? note_page_id ?? requestedDocumentId;
      const documentIdValue = context.isStudioPageUnified()
        ? requestedNotePageId
        : requestedDocumentId;
      const notePageIdValue = requestedNotePageId;
      const source = sourcePath ?? source_path;
      const imported = importedAt ?? imported_at;
      validatePageIdValue("document id", documentIdValue);
      validatePageIdValue("note page id", notePageIdValue);
      validatedPdfFile(source);
      const parsed = path.parse(source);
      const originalFilename = path.basename(source);
      const title = parsed.name || "Imported PDF";
      if (
        context.db
          .prepare("SELECT id FROM studio_documents WHERE id = ?")
          .get(documentIdValue)
      ) {
        throw new Error("document already exists");
      }
      if (
        context.db.prepare("SELECT id FROM pages WHERE id = ?").get(notePageIdValue)
      ) {
        throw new Error("note page already exists");
      }
      const destination =
        studioDocumentBackend.studioPdfDestination(documentIdValue);
      if (fs.existsSync(destination))
        throw new Error("Studio PDF destination already exists");
      const tempDestination = path.join(
        path.dirname(destination),
        `.source.${process.pid}.${Date.now()}.tmp`,
      );
      await fs.promises.copyFile(
        source,
        tempDestination,
        fs.constants.COPYFILE_EXCL,
      );
      fs.renameSync(tempDestination, destination);
      const storedFilePath = destination;

      try {
        context.withTransaction(() => {
          const pageTitle =
            documentIdValue === notePageIdValue ? title : `${title} Notes`;
          const pageKind =
            documentIdValue === notePageIdValue ? "note" : "studio_note";
          context.db
            .prepare(
              `
            INSERT INTO pages (${PAGE_COLUMNS})
            VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, 0, ?, ?, ?)
          `,
            )
            .run(notePageIdValue, pageTitle, pageKind, imported, imported);
          context.db
            .prepare(
              `
            INSERT INTO studio_documents (id, title, original_filename, stored_file_path, note_page_id, last_opened_at, viewer_zoom, viewer_page, panel_layout, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 100, 1, 'pdf-left', ?, ?)
          `,
            )
            .run(
              documentIdValue,
              title,
              originalFilename,
              storedFilePath,
              notePageIdValue,
              imported,
              imported,
              imported,
            );
          context.db
            .prepare(
              `
            INSERT INTO studio_document_page_links (${STUDIO_DOCUMENT_PAGE_LINK_COLUMNS})
            VALUES (?, ?, ?, NULL, 'Primary note', 0, ?, ?)
          `,
            )
            .run(
              crypto.randomUUID(),
              documentIdValue,
              notePageIdValue,
              imported,
              imported,
            );
          syncPageSearchIndexEntry(context.db, notePageIdValue);
        });
      } catch (error) {
        fs.rmSync(destination, { force: true });
        fs.rmSync(tempDestination, { force: true });
        throw error;
      }

      return context.db
        .prepare(
          `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`,
        )
        .get(documentIdValue);
    },

    async replaceStudioDocumentFile({
      id,
      sourcePath,
      source_path,
      updatedAt,
      updated_at,
    }) {
      validatePageIdValue("document id", id);
      const current = context.db
        .prepare(
          `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`,
        )
        .get(id);
      if (!current) throw new Error("document not found");
      const source = fs.realpathSync(sourcePath ?? source_path);
      validatedPdfFile(source);
      const destination = validateManagedStudioDocumentPath(
        current.stored_file_path,
        studioDocumentBackend.studioDocumentsRoot(),
      );
      const shouldCopy = fs.realpathSync(destination) !== source;
      if (shouldCopy) {
        const tempDestination = path.join(
          path.dirname(destination),
          `.source.${process.pid}.${Date.now()}.tmp`,
        );
        try {
          await fs.promises.copyFile(
            source,
            tempDestination,
            fs.constants.COPYFILE_EXCL,
          );
          fs.renameSync(tempDestination, destination);
        } catch (error) {
          fs.rmSync(tempDestination, { force: true });
          throw error;
        }
      }
      context.db
        .prepare(
          "UPDATE studio_documents SET original_filename = ?, stored_file_path = ?, updated_at = ? WHERE id = ?",
        )
        .run(path.basename(source), destination, updatedAt ?? updated_at, id);
      return context.db
        .prepare(
          `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`,
        )
        .get(id);
    },

    updateStudioDocumentViewerState({ id, updates, updatedAt, updated_at }) {
      const current = context.db
        .prepare(
          `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`,
        )
        .get(id);
      if (!current) throw new Error("document not found");
      const viewerZoom = Math.max(
        25,
        Math.min(300, updates.viewer_zoom ?? current.viewer_zoom),
      );
      const viewerPage = Math.max(1, updates.viewer_page ?? current.viewer_page);
      const panelLayout =
        updates.panel_layout === "note-left" ||
        updates.panel_layout === "pdf-left"
          ? updates.panel_layout
          : current.panel_layout;
      const lastOpenedAt = updates.last_opened_at ?? current.last_opened_at;
      context.db
        .prepare(
          `
        UPDATE studio_documents
        SET viewer_zoom = ?, viewer_page = ?, panel_layout = ?, last_opened_at = ?, updated_at = ?
        WHERE id = ?
      `,
        )
        .run(
          viewerZoom,
          viewerPage,
          panelLayout,
          lastOpenedAt,
          updatedAt ?? updated_at,
          id,
        );
    },

    renameStudioDocument({ id, title, updatedAt, updated_at }) {
      const trimmed = String(title ?? "").trim();
      if (!trimmed) throw new Error("title cannot be empty");
      const current = context.db
        .prepare(
          `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`,
        )
        .get(id);
      if (!current) throw new Error("document not found");
      const updated = updatedAt ?? updated_at;
      context.withTransaction(() => {
        context.db
          .prepare(
            "UPDATE studio_documents SET title = ?, updated_at = ? WHERE id = ?",
          )
          .run(trimmed, updated, id);
        const pageTitle =
          current.id === current.note_page_id ? trimmed : `${trimmed} Notes`;
        context.db
          .prepare("UPDATE pages SET title = ?, updated_at = ? WHERE id = ?")
          .run(pageTitle, updated, current.note_page_id);
        syncPageSearchIndexEntry(context.db, current.note_page_id);
      });
    },

    getStudioDocumentStoredFilePath(id) {
      const row = context.db
        .prepare("SELECT stored_file_path FROM studio_documents WHERE id = ?")
        .get(id);
      if (!row) throw new Error("document not found");
      return row.stored_file_path;
    },

    studioDocumentsRoot() {
      return path.join(context.appConfigDir, "studio-documents");
    },

    resolveStudioDocumentPdfPath(id) {
      return validateManagedStudioDocumentPath(
        studioDocumentBackend.getStudioDocumentStoredFilePath(id),
        studioDocumentBackend.studioDocumentsRoot(),
      );
    },

    async openStudioDocumentFile({ id }) {
      const storedPath = studioDocumentBackend.resolveStudioDocumentPdfPath(id);
      const error = await context.openPath(storedPath);
      if (error) throw new Error(error);
    },

    revealStudioDocumentFile({ id }) {
      const storedPath = studioDocumentBackend.resolveStudioDocumentPdfPath(id);
      context.revealPath(storedPath);
    },

    deleteStudioDocument({ id }) {
      const current = context.db
        .prepare(
          `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`,
        )
        .get(id);
      if (!current) throw new Error("document not found");
      context.withTransaction(() => {
        if (pageSearchIndexAvailable(context.db)) {
          context.db
            .prepare(
              `
            WITH RECURSIVE descendants(id) AS (
              SELECT id FROM pages WHERE id = ?
              UNION ALL
              SELECT pages.id FROM pages
              JOIN descendants ON pages.parent_id = descendants.id
            )
            DELETE FROM page_search_fts
            WHERE page_id IN (SELECT id FROM descendants)
          `,
            )
            .run(current.note_page_id);
        }
        context.db
          .prepare("DELETE FROM studio_document_page_links WHERE document_id = ?")
          .run(id);
        context.db.prepare("DELETE FROM studio_documents WHERE id = ?").run(id);
        context.db
          .prepare(
            `
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM pages WHERE id = ?
            UNION ALL
            SELECT pages.id FROM pages
            JOIN descendants ON pages.parent_id = descendants.id
          )
          DELETE FROM pages
          WHERE id IN (SELECT id FROM descendants)
        `,
          )
          .run(current.note_page_id);
      });
      removeStoredStudioDocumentFile(
        current.stored_file_path,
        studioDocumentBackend.studioDocumentsRoot(),
      );
    },
  };

  return studioDocumentBackend;
}

module.exports = { createStudioDocumentBackend };
