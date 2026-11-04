const crypto = require("node:crypto");
const path = require("node:path");
const {
  PAGE_COLUMNS,
  PAGE_SELECT_COLUMNS,
  PAGE_METADATA_SELECT_COLUMNS,
  validatePageCreateInput,
  validatePageIdValue,
  validatePageUpdateInput,
  validateImportedPagesArray,
  sanitizeImportedPageRecord,
  normalizeOptionalString,
  rowValue,
  own,
  studioProjectIdFromPageId,
  pageSearchIndexAvailable,
  syncPageSearchIndexEntry,
  pageSearchFtsQuery,
  removeStoredStudioDocumentFile,
} = require("./backend-helpers.cjs");

const TRASH_RETENTION_DAYS = 30;
const PAGE_VERSION_LIMIT = 50;
const PAGE_VERSION_COOLDOWN_MS = 5 * 60 * 1000;
const VERSIONED_PAGE_FIELDS = [
  "title",
  "parent_id",
  "content",
  "search_text",
  "icon",
  "cover_url",
  "is_favorite",
  "is_template",
  "is_database",
  "database_schema",
  "properties",
  "sort_order",
  "page_kind",
];

const PAGE_METADATA_SELECT_FROM_PAGES =
  "pages.id, pages.title, pages.parent_id, NULL AS content, NULL AS search_text, pages.icon, pages.cover_url, pages.is_deleted, pages.is_favorite, pages.is_template, pages.is_database, pages.database_schema, pages.properties, pages.sort_order, pages.page_kind, pages.created_at, pages.updated_at, 0 AS content_loaded";

function searchPagesWithLike(db, trimmed) {
  const pattern = `%${trimmed.toLowerCase()}%`;
  return db
    .prepare(
      `
      SELECT ${PAGE_METADATA_SELECT_COLUMNS},
        CASE
          WHEN lower(coalesce(search_text, '')) LIKE ? THEN search_text
          ELSE NULL
        END AS matched_content
      FROM pages
      WHERE is_deleted = 0
        AND page_kind IN ('note', 'studio_note')
        AND (lower(coalesce(title, '')) LIKE ? OR lower(coalesce(search_text, '')) LIKE ?)
      ORDER BY
        CASE WHEN lower(coalesce(title, '')) LIKE ? THEN 0 ELSE 1 END,
        updated_at DESC
      LIMIT 50
    `,
    )
    .all(pattern, pattern, pattern, pattern);
}

function createPageBackend(context) {
  const snapshotFromPage = (page) => Object.fromEntries(
    VERSIONED_PAGE_FIELDS.map((field) => [field, page[field] ?? null]),
  );

  const snapshotJsonFromPage = (page) => JSON.stringify(snapshotFromPage(page));

  const shouldVersionPageUpdate = (current, updates) =>
    VERSIONED_PAGE_FIELDS.some(
      (field) => own(updates, field) && current[field] !== updates[field],
    );

  const pruneVersions = (pageId) => {
    context.db
      .prepare(
        `
        DELETE FROM page_versions
        WHERE page_id = ?
          AND id NOT IN (
            SELECT id FROM page_versions
            WHERE page_id = ?
            ORDER BY created_at DESC, rowid DESC
            LIMIT ?
          )
      `,
      )
      .run(pageId, pageId, PAGE_VERSION_LIMIT);
  };

  const createPageVersionSnapshot = (page, { reason = "update", createdAt, force = false } = {}) => {
    if (!page) return false;
    const created = createdAt ?? new Date().toISOString();
    const snapshotJson = snapshotJsonFromPage(page);
    const previous = context.db
      .prepare(
        `SELECT snapshot_json, created_at FROM page_versions WHERE page_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(page.id);
    const previousAt = previous?.created_at ? Date.parse(previous.created_at) : Number.NaN;
    const now = Date.parse(created);
    const withinCooldown = Number.isFinite(previousAt) && Number.isFinite(now)
      && now - previousAt < PAGE_VERSION_COOLDOWN_MS;
    if (!force && previous && (previous.snapshot_json === snapshotJson || withinCooldown)) {
      return false;
    }
    context.db
      .prepare(
        `INSERT INTO page_versions (id, page_id, snapshot_json, reason, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), page.id, snapshotJson, reason, created);
    pruneVersions(page.id);
    return true;
  };

  const activeDescendantPages = (rootId) =>
    context.db
      .prepare(
        `
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM pages WHERE id = ? AND is_deleted = 0
          UNION ALL
          SELECT pages.id
          FROM pages
          JOIN descendants ON pages.parent_id = descendants.id
          WHERE pages.is_deleted = 0
        )
        SELECT ${PAGE_SELECT_COLUMNS}
        FROM pages
        WHERE id IN (SELECT id FROM descendants)
        ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, rowid ASC
      `,
      )
      .all(rootId, rootId);

  const parentWouldCreateCycle = (pageId, parentId) => {
    if (!parentId || pageId === parentId) return Boolean(parentId);
    return Boolean(
      context.db
        .prepare(
          `
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM pages WHERE id = ? AND is_deleted = 0
            UNION ALL
            SELECT pages.id
            FROM pages
            JOIN descendants ON pages.parent_id = descendants.id
            WHERE pages.is_deleted = 0
          )
          SELECT id FROM descendants WHERE id = ? LIMIT 1
        `,
        )
        .get(pageId, parentId),
    );
  };

  const purgeTrashRoots = (rootIds) => {
    const roots = [...new Set(rootIds.filter(Boolean))];
    if (roots.length === 0) return 0;
    const placeholders = roots.map(() => "?").join(", ");
    const pages = context.db
      .prepare(
        `SELECT id FROM pages WHERE is_deleted = 1 AND trash_root_id IN (${placeholders})`,
      )
      .all(...roots);
    if (pages.length === 0) return 0;
    const pageIds = pages.map((page) => page.id);
    const pagePlaceholders = pageIds.map(() => "?").join(", ");
    const activeDocuments = context.db
      .prepare(
        `SELECT id FROM studio_documents
         WHERE note_page_id IN (${pagePlaceholders}) AND deleted_at IS NULL`,
      )
      .all(...pageIds);
    if (activeDocuments.length > 0) {
      throw new Error("cannot purge trash that contains an active Studio document");
    }
    const documents = context.db
      .prepare(
        `SELECT id, stored_file_path FROM studio_documents
         WHERE note_page_id IN (${pagePlaceholders}) AND deleted_at IS NOT NULL`,
      )
      .all(...pageIds);
    const studioProjectIds = roots
      .map((rootId) => studioProjectIdFromPageId(rootId))
      .filter(Boolean);
    const studioProjectPlaceholders = studioProjectIds.map(() => "?").join(", ");
    if (studioProjectIds.length > 0) {
      const activeStudioProjects = context.db
        .prepare(
          `SELECT id FROM studio_projects
           WHERE id IN (${studioProjectPlaceholders}) AND deleted_at IS NULL`,
        )
        .all(...studioProjectIds);
      if (activeStudioProjects.length > 0) {
        throw new Error("cannot purge trash that contains an active Studio project");
      }
    }

    context.withTransaction(() => {
      if (pageSearchIndexAvailable(context.db)) {
        context.db
          .prepare(`DELETE FROM page_search_fts WHERE page_id IN (${pagePlaceholders})`)
          .run(...pageIds);
      }
      if (documents.length > 0) {
        context.db
          .prepare(`DELETE FROM studio_documents WHERE id IN (${documents.map(() => "?").join(", ")})`)
          .run(...documents.map((document) => document.id));
      }
      if (studioProjectIds.length > 0) {
        context.db
          .prepare(
            `DELETE FROM studio_projects
             WHERE id IN (${studioProjectPlaceholders}) AND deleted_at IS NOT NULL`,
          )
          .run(...studioProjectIds);
      }
      context.db
        .prepare(`DELETE FROM trash_project_memberships WHERE trash_root_id IN (${placeholders})`)
        .run(...roots);
      context.db
        .prepare(`DELETE FROM studio_document_page_links WHERE page_id IN (${pagePlaceholders})`)
        .run(...pageIds);
      context.db
        .prepare(`DELETE FROM pages WHERE id IN (${pagePlaceholders})`)
        .run(...pageIds);
    });
    for (const document of documents) {
      try {
        removeStoredStudioDocumentFile(
          document.stored_file_path,
          path.join(context.appConfigDir, "studio-documents"),
        );
      } catch (error) {
        console.error("Failed to purge trashed Studio PDF:", error);
      }
    }
    return pageIds.length;
  };

  const pageBackend = {
    createPageVersionSnapshot(page, options) {
      return createPageVersionSnapshot(page, options);
    },

    listPages() {
      return context.db
        .prepare(
          `SELECT ${PAGE_METADATA_SELECT_COLUMNS} FROM pages WHERE is_deleted = 0 AND page_kind IN ('note', 'studio_note', 'project') ORDER BY sort_order ASC, created_at DESC`,
        )
        .all();
    },

    listAllPages() {
      return context.db
        .prepare(
          `SELECT ${PAGE_SELECT_COLUMNS}
           FROM pages
           WHERE is_deleted = 0
           ORDER BY sort_order ASC, created_at DESC`,
        )
        .all();
    },

    searchPages({ query }) {
      const trimmed = String(query ?? "").trim();
      if (!trimmed) return [];
      const ftsQuery = pageSearchFtsQuery(trimmed);
      if (!ftsQuery) return searchPagesWithLike(context.db, trimmed);
      try {
        return context.db
          .prepare(
            `
          SELECT ${PAGE_METADATA_SELECT_FROM_PAGES},
            snippet(page_search_fts, 2, '', '', ' ... ', 12) AS matched_content
          FROM page_search_fts
          JOIN pages ON pages.rowid = page_search_fts.rowid
          WHERE page_search_fts MATCH ?
            AND pages.is_deleted = 0
            AND pages.page_kind IN ('note', 'studio_note')
          ORDER BY bm25(page_search_fts), pages.updated_at DESC
          LIMIT 50
        `,
          )
          .all(ftsQuery);
      } catch {
        return searchPagesWithLike(context.db, trimmed);
      }
    },

    getPage({ id }) {
      return (
        context.db
          .prepare(`SELECT ${PAGE_SELECT_COLUMNS} FROM pages WHERE id = ?`)
          .get(id) || null
      );
    },

    createPage({ id, title, parentId, parent_id, createdAt, created_at }) {
      const parent = parentId ?? parent_id ?? null;
      const created = createdAt ?? created_at;
      validatePageCreateInput({ id, title, parent, created });
      const sortOrder = rowValue(
        context.db
          .prepare(
            `
        SELECT COALESCE(MIN(sort_order), 0) - 1 AS value
        FROM pages
        WHERE is_deleted = 0
          AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
      `,
          )
          .get(parent, parent),
        "value",
      );

      context.db
        .prepare(
          `
        INSERT INTO pages (${PAGE_COLUMNS})
        VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, ?, 'note', ?, ?)
      `,
        )
        .run(id, title, parent, sortOrder, created, created);
      syncPageSearchIndexEntry(context.db, id);
      return pageBackend.getPage({ id });
    },

    createProject({ id, title, createdAt, created_at }) {
      const created = createdAt ?? created_at;
      validatePageCreateInput({ id, title, parent: null, created });
      const trimmed = String(title ?? "").trim();
      if (!trimmed) throw new Error("project title cannot be empty");
      const sortOrder = rowValue(
        context.db
          .prepare(
            `
        SELECT COALESCE(MIN(sort_order), 0) - 1 AS value
        FROM pages
        WHERE is_deleted = 0
          AND page_kind = 'project'
      `,
          )
          .get(),
        "value",
      );

      context.db
        .prepare(
          `
        INSERT INTO pages (${PAGE_COLUMNS})
        VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, ?, 'project', ?, ?)
      `,
        )
        .run(id, trimmed, sortOrder, created, created);
      return pageBackend.getPage({ id });
    },

    updatePage({ id, updates, updatedAt, updated_at }) {
      validatePageIdValue("id", id);
      const safeUpdates = validatePageUpdateInput(updates);
      const updated = updatedAt ?? updated_at ?? new Date().toISOString();
      context.withTransaction(() => {
        const current = context.db
          .prepare(`SELECT ${PAGE_SELECT_COLUMNS} FROM pages WHERE id = ? AND is_deleted = 0`)
          .get(id);
        if (!current) throw new Error("page not found");
        if (shouldVersionPageUpdate(current, safeUpdates)) {
          createPageVersionSnapshot(current, { reason: "update", createdAt: updated });
        }
        const setClauses = [];
        const values = [];

        const hasTitle = own(safeUpdates, "title");
        const hasContent = own(safeUpdates, "content");

        if (hasTitle) {
          setClauses.push("title = ?");
          values.push(safeUpdates.title);
          const studioProjectId = studioProjectIdFromPageId(id);
          if (studioProjectId) {
            context.db
              .prepare(
                "UPDATE studio_projects SET name = ?, updated_at = ? WHERE id = ?",
              )
              .run(safeUpdates.title, updated, studioProjectId);
          }
        }

        if (own(safeUpdates, "parent_id")) {
          setClauses.push("parent_id = ?");
          values.push(safeUpdates.parent_id);
        }

        if (hasContent) {
          setClauses.push("content = ?");
          values.push(safeUpdates.content);
          const searchText = own(safeUpdates, "search_text")
            ? safeUpdates.search_text
            : safeUpdates.content;
          setClauses.push("search_text = ?");
          values.push(searchText);
        }

        for (const field of [
          "icon",
          "cover_url",
          "is_favorite",
          "is_template",
          "is_database",
          "database_schema",
          "properties",
          "page_kind",
        ]) {
          if (own(safeUpdates, field)) {
            setClauses.push(`${field} = ?`);
            values.push(safeUpdates[field]);
          }
        }

        if (setClauses.length > 0) {
          setClauses.push("updated_at = ?");
          values.push(updated);
          values.push(id);

          context.db
            .prepare(`UPDATE pages SET ${setClauses.join(", ")} WHERE id = ?`)
            .run(...values);
          syncPageSearchIndexEntry(context.db, id);
        }
      });
    },

    deletePage({ id, deletedAt, deleted_at }) {
      const deleted = deletedAt ?? deleted_at ?? new Date().toISOString();
      const root = context.db
        .prepare(`SELECT ${PAGE_SELECT_COLUMNS} FROM pages WHERE id = ? AND is_deleted = 0`)
        .get(id);
      if (!root) throw new Error("page not found");
      if (root.page_kind === "project") {
        return pageBackend.deleteProject({ id, updatedAt: deleted });
      }
      const primaryDocument = context.db
        .prepare("SELECT id FROM studio_documents WHERE note_page_id = ? AND deleted_at IS NULL")
        .get(id);
      if (primaryDocument) {
        // Keep the Studio PDF and its note tree together in the same trash
        // batch. The document backend owns its file lifecycle.
        if (typeof context.deleteStudioDocument !== "function") {
          throw new Error("Studio document deletion is unavailable");
        }
        return context.deleteStudioDocument({ id: primaryDocument.id, deletedAt: deleted });
      }

      context.withTransaction(() => {
        const descendants = activeDescendantPages(id);
        for (const page of descendants) {
          createPageVersionSnapshot(page, { reason: "trash", createdAt: deleted, force: true });
        }
        const descendantIds = descendants.map((page) => page.id);
        if (descendantIds.length === 0) throw new Error("page not found");
        context.db
          .prepare(
            `UPDATE pages
             SET is_deleted = 1, deleted_at = ?, trash_root_id = ?, updated_at = ?
             WHERE id IN (${descendantIds.map(() => "?").join(", ")})`,
          )
          .run(deleted, id, deleted, ...descendantIds);
        // A page tree can contain several imported PDFs. Keep every document
        // in the same trash batch so a later retention purge never removes an
        // apparently active document whose primary note has disappeared.
        context.db
          .prepare(
            `UPDATE studio_documents
             SET deleted_at = ?, updated_at = ?
             WHERE note_page_id IN (${descendantIds.map(() => "?").join(", ")})
               AND deleted_at IS NULL`,
          )
          .run(deleted, deleted, ...descendantIds);
        for (const descendantId of descendantIds) {
          syncPageSearchIndexEntry(context.db, descendantId);
        }
      });
    },

    deleteProject({ id, updatedAt, updated_at }) {
      const updated = updatedAt ?? updated_at ?? new Date().toISOString();
      const project = context.db
          .prepare(
          `SELECT ${PAGE_SELECT_COLUMNS} FROM pages WHERE id = ? AND is_deleted = 0 AND page_kind = 'project'`,
        )
        .get(id);
      if (!project) throw new Error("project not found");
      const studioProjectId = studioProjectIdFromPageId(id);

      context.withTransaction(() => {
        createPageVersionSnapshot(project, { reason: "trash", createdAt: updated, force: true });
        const recordMembership = context.db.prepare(
          `INSERT OR REPLACE INTO trash_project_memberships
           (trash_root_id, member_type, member_id, created_at)
           VALUES (?, ?, ?, ?)`,
        );
        context.db
          .prepare("DELETE FROM trash_project_memberships WHERE trash_root_id = ?")
          .run(id);
        const directPages = context.db
          .prepare(
            `SELECT ${PAGE_SELECT_COLUMNS}
             FROM pages
             WHERE parent_id = ? AND is_deleted = 0`,
          )
          .all(id);
        for (const childPage of directPages) {
          createPageVersionSnapshot(childPage, { reason: "update", createdAt: updated });
          recordMembership.run(id, "page", childPage.id, updated);
        }
        context.db
          .prepare(
            "UPDATE pages SET parent_id = NULL, updated_at = ? WHERE parent_id = ? AND is_deleted = 0",
          )
          .run(updated, id);
        if (studioProjectId) {
          const projectDocuments = context.db
            .prepare(
              "SELECT id FROM studio_documents WHERE project_id = ? AND deleted_at IS NULL",
            )
            .all(studioProjectId);
          const childProjects = context.db
            .prepare(
              "SELECT id FROM studio_projects WHERE parent_id = ? AND deleted_at IS NULL",
            )
            .all(studioProjectId);
          for (const document of projectDocuments) {
            recordMembership.run(id, "studio_document", document.id, updated);
          }
          for (const childProject of childProjects) {
            recordMembership.run(id, "studio_project", childProject.id, updated);
          }
          context.db
            .prepare(
              "UPDATE studio_documents SET project_id = NULL, updated_at = ? WHERE project_id = ? AND deleted_at IS NULL",
            )
            .run(updated, studioProjectId);
          context.db
            .prepare(
              "UPDATE studio_projects SET parent_id = NULL, updated_at = ? WHERE parent_id = ? AND deleted_at IS NULL",
            )
            .run(updated, studioProjectId);
          context.db
            .prepare("UPDATE studio_projects SET deleted_at = ?, updated_at = ? WHERE id = ?")
            .run(updated, updated, studioProjectId);
        }
        context.db
          .prepare(
            "UPDATE pages SET is_deleted = 1, deleted_at = ?, trash_root_id = ?, updated_at = ? WHERE id = ? AND page_kind = 'project'",
          )
          .run(updated, id, updated, id);
      });
    },

    purgeExpiredTrash({ now } = {}) {
      const nowDate = now ? new Date(now) : new Date();
      if (!Number.isFinite(nowDate.getTime())) throw new Error("invalid purge timestamp");
      const cutoff = new Date(
        nowDate.getTime() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const roots = context.db
        .prepare(
          `SELECT id FROM pages
           WHERE is_deleted = 1
             AND trash_root_id = id
             AND deleted_at IS NOT NULL
             AND julianday(deleted_at) <= julianday(?)`,
        )
        .all(cutoff)
        .map((row) => row.id);
      return purgeTrashRoots(roots);
    },

    listTrashPages({ now } = {}) {
      pageBackend.purgeExpiredTrash({ now });
      return context.db
        .prepare(
          `
          SELECT ${PAGE_SELECT_COLUMNS}, pages.deleted_at, pages.trash_root_id,
            (SELECT COUNT(*) FROM pages descendants
             WHERE descendants.is_deleted = 1
               AND descendants.trash_root_id = pages.id) AS trashed_descendant_count
          FROM pages
          WHERE pages.is_deleted = 1
            AND pages.trash_root_id = pages.id
          ORDER BY pages.deleted_at DESC, pages.updated_at DESC
        `,
        )
        .all();
    },

    restorePage({ id, restoredAt, restored_at }) {
      const restored = restoredAt ?? restored_at ?? new Date().toISOString();
      const requested = context.db
        .prepare(`SELECT id, trash_root_id FROM pages WHERE id = ? AND is_deleted = 1`)
        .get(id);
      if (!requested) throw new Error("trashed page not found");
      const rootId = requested.trash_root_id || requested.id;
      const root = context.db
        .prepare(`SELECT ${PAGE_SELECT_COLUMNS} FROM pages WHERE id = ? AND is_deleted = 1`)
        .get(rootId);
      if (!root) throw new Error("trash batch not found");
      const trashedPages = context.db
        .prepare(
          `SELECT ${PAGE_SELECT_COLUMNS} FROM pages WHERE is_deleted = 1 AND trash_root_id = ? ORDER BY rowid ASC`,
        )
        .all(rootId);
      const pageIds = trashedPages.map((page) => page.id);
      if (pageIds.length === 0) throw new Error("trash batch is empty");
      const memberships = root.page_kind === "project"
        ? context.db
          .prepare(
            `SELECT member_type, member_id
             FROM trash_project_memberships
             WHERE trash_root_id = ?`,
          )
          .all(rootId)
        : [];
      const studioProjectId = studioProjectIdFromPageId(rootId);

      context.withTransaction(() => {
        context.db
          .prepare(
            `UPDATE pages
             SET is_deleted = 0, deleted_at = NULL, trash_root_id = NULL, updated_at = ?
             WHERE id IN (${pageIds.map(() => "?").join(", ")})`,
          )
          .run(restored, ...pageIds);
        if (root.parent_id) {
          const parent = context.db
            .prepare("SELECT id FROM pages WHERE id = ? AND is_deleted = 0")
            .get(root.parent_id);
          if (!parent) {
            context.db
              .prepare("UPDATE pages SET parent_id = NULL, updated_at = ? WHERE id = ?")
              .run(restored, rootId);
          }
        }
        context.db
          .prepare(
            `UPDATE studio_documents
             SET deleted_at = NULL, updated_at = ?
             WHERE note_page_id IN (${pageIds.map(() => "?").join(", ")})
               AND deleted_at IS NOT NULL`,
          )
          .run(restored, ...pageIds);
        if (studioProjectId) {
          context.db
            .prepare("UPDATE studio_projects SET deleted_at = NULL, updated_at = ? WHERE id = ?")
            .run(restored, studioProjectId);
        }
        if (memberships.length > 0) {
          const pageMemberships = memberships.filter((member) => member.member_type === "page");
          for (const member of pageMemberships) {
            context.db
              .prepare(
                `UPDATE pages
                 SET parent_id = ?, updated_at = ?
                 WHERE id = ? AND is_deleted = 0 AND parent_id IS NULL`,
              )
              .run(rootId, restored, member.member_id);
          }
          if (studioProjectId) {
            for (const member of memberships) {
              if (member.member_type === "studio_document") {
                context.db
                  .prepare(
                    `UPDATE studio_documents
                     SET project_id = ?, updated_at = ?
                     WHERE id = ? AND deleted_at IS NULL AND project_id IS NULL`,
                  )
                  .run(studioProjectId, restored, member.member_id);
              }
              if (member.member_type === "studio_project") {
                context.db
                  .prepare(
                    `UPDATE studio_projects
                     SET parent_id = ?, updated_at = ?
                     WHERE id = ? AND deleted_at IS NULL AND parent_id IS NULL`,
                  )
                  .run(studioProjectId, restored, member.member_id);
              }
            }
          }
          context.db
            .prepare("DELETE FROM trash_project_memberships WHERE trash_root_id = ?")
            .run(rootId);
        }
        for (const pageId of pageIds) {
          syncPageSearchIndexEntry(context.db, pageId);
        }
      });
      return pageBackend.getPage({ id: rootId });
    },

    emptyTrash() {
      const roots = context.db
        .prepare("SELECT id FROM pages WHERE is_deleted = 1 AND trash_root_id = id")
        .all()
        .map((row) => row.id);
      return purgeTrashRoots(roots);
    },

    listPageVersions({ pageId, page_id }) {
      const page = pageId ?? page_id;
      return context.db
        .prepare(
          `SELECT id, page_id, snapshot_json, reason, created_at
           FROM page_versions WHERE page_id = ?
           ORDER BY created_at DESC, rowid DESC`,
        )
        .all(page)
        .map((row) => {
          let snapshot = {};
          try {
            snapshot = JSON.parse(row.snapshot_json);
          } catch {
            snapshot = {};
          }
          return {
            id: row.id,
            page_id: row.page_id,
            snapshot,
            reason: row.reason,
            created_at: row.created_at,
          };
        });
    },

    restorePageVersion({ id, restoredAt, restored_at }) {
      const restored = restoredAt ?? restored_at ?? new Date().toISOString();
      const version = context.db
        .prepare("SELECT id, page_id, snapshot_json FROM page_versions WHERE id = ?")
        .get(id);
      if (!version) throw new Error("page version not found");
      let snapshot;
      try {
        snapshot = JSON.parse(version.snapshot_json);
      } catch {
        throw new Error("page version is invalid");
      }
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        throw new Error("page version is invalid");
      }
      const current = context.db
        .prepare(`SELECT ${PAGE_SELECT_COLUMNS} FROM pages WHERE id = ? AND is_deleted = 0`)
        .get(version.page_id);
      if (!current) throw new Error("page not found");
      const restoredValues = {};
      for (const field of VERSIONED_PAGE_FIELDS) {
        if (own(snapshot, field)) restoredValues[field] = snapshot[field];
      }
      if (Object.keys(restoredValues).length === 0) throw new Error("page version is invalid");
      if (restoredValues.parent_id) {
        const parent = context.db
          .prepare("SELECT id FROM pages WHERE id = ? AND is_deleted = 0")
          .get(restoredValues.parent_id);
        if (!parent || parentWouldCreateCycle(version.page_id, restoredValues.parent_id)) {
          restoredValues.parent_id = null;
        }
      }
      const studioDocument = context.db
        .prepare(
          `SELECT id, note_page_id FROM studio_documents
           WHERE note_page_id = ? AND deleted_at IS NULL`,
        )
        .get(version.page_id);
      const studioProjectId = studioProjectIdFromPageId(version.page_id);

      context.withTransaction(() => {
        createPageVersionSnapshot(current, { reason: "restore", createdAt: restored, force: true });
        const fields = Object.keys(restoredValues);
        context.db
          .prepare(
            `UPDATE pages SET ${fields.map((field) => `${field} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
          )
          .run(...fields.map((field) => restoredValues[field]), restored, version.page_id);
        if (studioDocument) {
          if (own(restoredValues, "title")) {
            const pageTitle = String(restoredValues.title ?? "");
            const documentTitle = studioDocument.id === studioDocument.note_page_id
              ? pageTitle
              : pageTitle.endsWith(" Notes")
                ? pageTitle.slice(0, -" Notes".length)
                : pageTitle;
            context.db
              .prepare("UPDATE studio_documents SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
              .run(documentTitle, restored, studioDocument.id);
          }
          if (own(restoredValues, "parent_id")) {
            const projectId = studioProjectIdFromPageId(restoredValues.parent_id);
            context.db
              .prepare("UPDATE studio_documents SET project_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
              .run(projectId, restored, studioDocument.id);
          }
        }
        if (studioProjectId) {
          if (own(restoredValues, "title")) {
            context.db
              .prepare("UPDATE studio_projects SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
              .run(restoredValues.title, restored, studioProjectId);
          }
          if (own(restoredValues, "parent_id") || own(restoredValues, "sort_order")) {
            const projectParentId = own(restoredValues, "parent_id")
              ? studioProjectIdFromPageId(restoredValues.parent_id)
              : undefined;
            if (projectParentId !== undefined) {
              context.db
                .prepare(
                  "UPDATE studio_projects SET parent_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
                )
                .run(projectParentId, restored, studioProjectId);
            }
            if (own(restoredValues, "sort_order")) {
              context.db
                .prepare(
                  "UPDATE studio_projects SET sort_order = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
                )
                .run(restoredValues.sort_order, restored, studioProjectId);
            }
          }
        }
        syncPageSearchIndexEntry(context.db, version.page_id);
      });
      return pageBackend.getPage({ id: version.page_id });
    },

    movePage({ id, parentId, parent_id, updatedAt, updated_at }) {
      const parent = parentId ?? parent_id ?? null;
      const updated = updatedAt ?? updated_at ?? new Date().toISOString();
      const current = context.db
        .prepare(`SELECT ${PAGE_SELECT_COLUMNS} FROM pages WHERE id = ? AND is_deleted = 0`)
        .get(id);
      if (!current) throw new Error("page does not exist");
      if (parent) {
        if (parent === id) throw new Error("page cannot be moved under itself");
        const parentExists = context.db
          .prepare("SELECT id FROM pages WHERE id = ? AND is_deleted = 0")
          .get(parent);
        if (!parentExists) throw new Error("target parent page does not exist");
        if (parentWouldCreateCycle(id, parent))
          throw new Error("page cannot be moved under one of its descendants");
      }
      context.withTransaction(() => {
        if (current.parent_id !== parent) {
          createPageVersionSnapshot(current, { reason: "update", createdAt: updated });
        }
        const result = context.db
          .prepare("UPDATE pages SET parent_id = ?, updated_at = ? WHERE id = ? AND is_deleted = 0")
          .run(parent, updated, id);
        if (result.changes === 0) throw new Error("page does not exist");
      });
    },

    reorderPages({
      parentId,
      parent_id,
      orderedIds,
      ordered_ids,
      updatedAt,
      updated_at,
    }) {
      const parent = parentId ?? parent_id ?? null;
      const ordered = orderedIds ?? ordered_ids ?? [];
      const updated = updatedAt ?? updated_at ?? new Date().toISOString();
      if (ordered.length === 0) return;
      context.withTransaction(() => {
        ordered.forEach((id, index) => {
          const current = context.db
            .prepare(
              `SELECT ${PAGE_SELECT_COLUMNS}
               FROM pages
               WHERE id = ?
                 AND is_deleted = 0
                 AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)`,
            )
            .get(id, parent, parent);
          if (!current) throw new Error("page order contains invalid page");
          if (current.sort_order !== index) {
            createPageVersionSnapshot(current, { reason: "update", createdAt: updated });
          }
          const result = context.db
            .prepare(
              `
            UPDATE pages
            SET sort_order = ?, updated_at = ?
            WHERE id = ?
              AND is_deleted = 0
              AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
          `,
            )
            .run(index, updated, id, parent, parent);
          if (result.changes === 0)
            throw new Error("page order contains invalid page");
        });
      });
    },

    importPages({ pages }) {
      return pageBackend.importPageRecords(pages || []);
    },

    importPageRecords(pages, { inTransaction = false } = {}) {
      validateImportedPagesArray(pages);
      let importedCount = 0;
      const work = () => {
        const insert = context.db.prepare(`
          INSERT INTO pages (${PAGE_COLUMNS})
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const page of pages) {
          const sanitizedPage = sanitizeImportedPageRecord(page);
          importedCount += insert.run(
            sanitizedPage.id,
            sanitizedPage.title,
            normalizeOptionalString(sanitizedPage.parent_id),
            normalizeOptionalString(sanitizedPage.content),
            normalizeOptionalString(sanitizedPage.search_text),
            normalizeOptionalString(sanitizedPage.icon),
            normalizeOptionalString(sanitizedPage.cover_url),
            sanitizedPage.is_deleted,
            sanitizedPage.is_favorite,
            sanitizedPage.is_template ?? 0,
            sanitizedPage.is_database ?? 0,
            normalizeOptionalString(sanitizedPage.database_schema),
            normalizeOptionalString(sanitizedPage.properties),
            sanitizedPage.sort_order ?? 0,
            sanitizedPage.page_kind,
            sanitizedPage.created_at,
            sanitizedPage.updated_at,
          ).changes;
          syncPageSearchIndexEntry(context.db, sanitizedPage.id);
        }
      };
      if (inTransaction) {
        work();
      } else {
        context.withTransaction(work);
      }
      return importedCount;
    },

    toggleFavorite({ id, isFavorite, is_favorite }) {
      pageBackend.updatePage({
        id,
        updates: { is_favorite: (isFavorite ?? is_favorite) ? 1 : 0 },
        updatedAt: new Date().toISOString(),
      });
    },

    toggleTemplate({ id, isTemplate, is_template }) {
      pageBackend.updatePage({
        id,
        updates: { is_template: (isTemplate ?? is_template) ? 1 : 0 },
        updatedAt: new Date().toISOString(),
      });
    },

    createPageFromTemplate({
      id,
      templateId,
      template_id,
      parentId,
      parent_id,
      createdAt,
      created_at,
    }) {
      const template = pageBackend.getPage({ id: templateId ?? template_id });
      if (!template) throw new Error("template not found");
      const parent = parentId ?? parent_id ?? null;
      const created = createdAt ?? created_at;
      const sortOrder = rowValue(
        context.db
          .prepare(
            `
        SELECT COALESCE(MIN(sort_order), 0) - 1 AS value
        FROM pages
        WHERE is_deleted = 0
          AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
      `,
          )
          .get(parent, parent),
        "value",
      );
      context.db
        .prepare(
          `
        INSERT INTO pages (${PAGE_COLUMNS})
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, 'note', ?, ?)
      `,
        )
        .run(
          id,
          template.title,
          parent,
          template.content,
          template.search_text,
          template.icon,
          template.cover_url,
          template.is_database,
          template.database_schema,
          template.properties,
          sortOrder,
          created,
          created,
        );
      syncPageSearchIndexEntry(context.db, id);
      return pageBackend.getPage({ id });
    },

    duplicatePage({ id, sourceId, source_id, createdAt, created_at }) {
      const source = pageBackend.getPage({ id: sourceId ?? source_id });
      if (!source) throw new Error("source page not found");
      const created = createdAt ?? created_at;
      const title = `Copy of ${source.title}`;
      const sortOrder = rowValue(
        context.db
          .prepare(
            `
        SELECT COALESCE(MIN(sort_order), 0) - 1 AS value
        FROM pages
        WHERE is_deleted = 0
          AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
      `,
          )
          .get(source.parent_id, source.parent_id),
        "value",
      );
      context.db
        .prepare(
          `
        INSERT INTO pages (${PAGE_COLUMNS})
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, 'note', ?, ?)
      `,
        )
        .run(
          id,
          title,
          source.parent_id,
          source.content,
          source.search_text,
          source.icon,
          source.cover_url,
          source.is_database,
          source.database_schema,
          source.properties,
          sortOrder,
          created,
          created,
        );
      syncPageSearchIndexEntry(context.db, id);
      return pageBackend.getPage({ id });
    },
  };

  return pageBackend;
}

module.exports = {
  createPageBackend,
};
