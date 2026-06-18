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
} = require("./backend-helpers.cjs");

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
  const pageBackend = {
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
          `SELECT ${PAGE_SELECT_COLUMNS} FROM pages ORDER BY sort_order ASC, created_at DESC`,
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
      const updated = updatedAt ?? updated_at;
      context.withTransaction(() => {
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
          "is_deleted",
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

    deletePage({ id }) {
      const studioDocumentMatch = context.db
        .prepare(
          `
        WITH RECURSIVE descendants(id) AS (
          SELECT id FROM pages WHERE id = ?
          UNION ALL
          SELECT pages.id FROM pages
          JOIN descendants ON pages.parent_id = descendants.id
        )
        SELECT studio_documents.id
        FROM studio_documents
        JOIN descendants ON descendants.id = studio_documents.note_page_id
        LIMIT 1
      `,
        )
        .get(id);
      if (studioDocumentMatch) {
        throw new Error(
          "delete the Studio document before deleting its primary note",
        );
      }

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
            .run(id);
        }
        context.db
          .prepare(
            `
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM pages WHERE id = ?
            UNION ALL
            SELECT pages.id FROM pages
            JOIN descendants ON pages.parent_id = descendants.id
          )
          DELETE FROM studio_document_page_links
          WHERE page_id IN (SELECT id FROM descendants)
        `,
          )
          .run(id);
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
          .run(id);
      });
    },

    deleteProject({ id, updatedAt, updated_at }) {
      const updated = updatedAt ?? updated_at;
      const project = context.db
          .prepare(
          `SELECT ${PAGE_SELECT_COLUMNS} FROM pages WHERE id = ? AND is_deleted = 0 AND page_kind = 'project'`,
        )
        .get(id);
      if (!project) throw new Error("project not found");
      const studioProjectId = studioProjectIdFromPageId(id);

      context.withTransaction(() => {
        context.db
          .prepare(
            "UPDATE pages SET parent_id = NULL, updated_at = ? WHERE parent_id = ?",
          )
          .run(updated, id);
        if (studioProjectId) {
          context.db
            .prepare(
              "UPDATE studio_documents SET project_id = NULL, updated_at = ? WHERE project_id = ?",
            )
            .run(updated, studioProjectId);
          context.db
            .prepare(
              "UPDATE studio_projects SET parent_id = NULL, updated_at = ? WHERE parent_id = ?",
            )
            .run(updated, studioProjectId);
          context.db
            .prepare("DELETE FROM studio_projects WHERE id = ?")
            .run(studioProjectId);
        }
        context.db
          .prepare("DELETE FROM studio_document_page_links WHERE page_id = ?")
          .run(id);
        context.db
          .prepare("DELETE FROM pages WHERE id = ? AND page_kind = 'project'")
          .run(id);
      });
    },

    movePage({ id, parentId, parent_id, updatedAt, updated_at }) {
      const parent = parentId ?? parent_id ?? null;
      const updated = updatedAt ?? updated_at;
      if (parent) {
        if (parent === id) throw new Error("page cannot be moved under itself");
        const parentExists = context.db
          .prepare("SELECT id FROM pages WHERE id = ? AND is_deleted = 0")
          .get(parent);
        if (!parentExists) throw new Error("target parent page does not exist");
        const descendantMatch = context.db
          .prepare(
            `
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM pages WHERE parent_id = ?
            UNION ALL
            SELECT pages.id FROM pages
            JOIN descendants ON pages.parent_id = descendants.id
          )
          SELECT id FROM descendants WHERE id = ? LIMIT 1
        `,
          )
          .get(id, parent);
        if (descendantMatch)
          throw new Error("page cannot be moved under one of its descendants");
      }
      const result = context.db
        .prepare("UPDATE pages SET parent_id = ?, updated_at = ? WHERE id = ?")
        .run(parent, updated, id);
      if (result.changes === 0) throw new Error("page does not exist");
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
      const updated = updatedAt ?? updated_at;
      if (ordered.length === 0) return;
      context.withTransaction(() => {
        ordered.forEach((id, index) => {
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
      context.db
        .prepare(
          "UPDATE pages SET is_favorite = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .run(isFavorite ?? is_favorite ? 1 : 0, id);
    },

    toggleTemplate({ id, isTemplate, is_template }) {
      context.db
        .prepare(
          "UPDATE pages SET is_template = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .run(isTemplate ?? is_template ? 1 : 0, id);
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
