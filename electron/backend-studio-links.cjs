const crypto = require("node:crypto");
const {
  STUDIO_DOCUMENT_PAGE_LINK_COLUMNS,
  normalizeOptionalString,
  rowValue,
} = require("./backend-helpers.cjs");

function createStudioLinkBackend(context) {
  const studioLinkBackend = {
    studioDocumentPageLinkFromRow(row) {
      if (!row) return null;
      return {
        id: row.link_id,
        document_id: row.document_id,
        page_id: row.page_id,
        pdf_page: row.pdf_page,
        label: row.label,
        sort_order: row.link_sort_order,
        created_at: row.link_created_at,
        updated_at: row.link_updated_at,
        page: {
          id: row.page_id,
          title: row.title,
          parent_id: row.parent_id,
          content: row.content,
          search_text: row.search_text,
          icon: row.icon,
          cover_url: row.cover_url,
          is_deleted: row.is_deleted,
          is_favorite: row.is_favorite,
          is_template: row.is_template,
          is_database: row.is_database,
          database_schema: row.database_schema,
          properties: row.properties,
          sort_order: row.page_sort_order,
          page_kind: row.page_kind,
          created_at: row.page_created_at,
          updated_at: row.page_updated_at,
          content_loaded: row.page_content_loaded,
        },
      };
    },

    studioDocumentPageLinkSelectSql() {
      return `
        SELECT
          links.id AS link_id,
          links.document_id,
          links.page_id,
          links.pdf_page,
          links.label,
          links.sort_order AS link_sort_order,
          links.created_at AS link_created_at,
          links.updated_at AS link_updated_at,
          pages.id AS page_id,
          pages.title,
          pages.parent_id,
          NULL AS content,
          NULL AS search_text,
          pages.icon,
          pages.cover_url,
          pages.is_deleted,
          pages.is_favorite,
          pages.is_template,
          pages.is_database,
          pages.database_schema,
          pages.properties,
          pages.sort_order AS page_sort_order,
          pages.page_kind,
          pages.created_at AS page_created_at,
          pages.updated_at AS page_updated_at,
          0 AS page_content_loaded
        FROM studio_document_page_links links
        JOIN pages ON pages.id = links.page_id
      `;
    },

    listStudioDocumentPageLinks({ documentId, document_id }) {
      const document = documentId ?? document_id;
      return context.db
        .prepare(
          `
        ${studioLinkBackend.studioDocumentPageLinkSelectSql()}
        WHERE links.document_id = ?
          AND pages.is_deleted = 0
        ORDER BY links.sort_order ASC, links.created_at ASC
      `,
        )
        .all(document)
        .map((row) => studioLinkBackend.studioDocumentPageLinkFromRow(row));
    },

    listAllStudioDocumentPageLinks() {
      return context.db
        .prepare(
          `
        ${studioLinkBackend.studioDocumentPageLinkSelectSql()}
        JOIN studio_documents documents ON documents.id = links.document_id
        WHERE pages.is_deleted = 0
        ORDER BY documents.title COLLATE NOCASE ASC, links.sort_order ASC, links.created_at ASC
      `,
        )
        .all()
        .map((row) => studioLinkBackend.studioDocumentPageLinkFromRow(row));
    },

    linkStudioDocumentPage({
      id,
      documentId,
      document_id,
      pageId,
      page_id,
      pdfPage,
      pdf_page,
      label,
      createdAt,
      created_at,
    }) {
      const linkId = id || crypto.randomUUID();
      const document = documentId ?? document_id;
      const page = pageId ?? page_id;
      const created = createdAt ?? created_at;
      const pdfPageValue = Number.isFinite(Number(pdfPage ?? pdf_page))
        ? Math.max(1, Math.round(Number(pdfPage ?? pdf_page)))
        : null;
      const labelValue = normalizeOptionalString(label);
      const documentExists = rowValue(
        context.db
          .prepare("SELECT COUNT(*) AS value FROM studio_documents WHERE id = ?")
          .get(document),
        "value",
      );
      if (documentExists === 0) throw new Error("document not found");
      const pageExists = rowValue(
        context.db
          .prepare(
            "SELECT COUNT(*) AS value FROM pages WHERE id = ? AND is_deleted = 0",
          )
          .get(page),
        "value",
      );
      if (pageExists === 0) throw new Error("page not found");
      const sortOrder = rowValue(
        context.db
          .prepare(
            `
        SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
        FROM studio_document_page_links
        WHERE document_id = ?
      `,
          )
          .get(document),
        "value",
      );

      context.db
        .prepare(
          `
        INSERT INTO studio_document_page_links (${STUDIO_DOCUMENT_PAGE_LINK_COLUMNS})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(document_id, page_id) DO UPDATE SET
          pdf_page = excluded.pdf_page,
          label = excluded.label,
          updated_at = excluded.updated_at
      `,
        )
        .run(
          linkId,
          document,
          page,
          pdfPageValue,
          labelValue,
          sortOrder,
          created,
          created,
        );

      const row = context.db
        .prepare(
          `
        ${studioLinkBackend.studioDocumentPageLinkSelectSql()}
        WHERE links.document_id = ?
          AND links.page_id = ?
          AND pages.is_deleted = 0
      `,
        )
        .get(document, page);
      return studioLinkBackend.studioDocumentPageLinkFromRow(row);
    },

    updateStudioDocumentPageLink({
      id,
      pdfPage,
      pdf_page,
      label,
      updatedAt,
      updated_at,
    }) {
      const pdfPageInput = pdfPage ?? pdf_page;
      const pdfPageValue =
        pdfPageInput === null ||
        pdfPageInput === undefined ||
        pdfPageInput === ""
          ? null
          : Math.max(1, Math.round(Number(pdfPageInput)));
      if (pdfPageValue !== null && !Number.isFinite(pdfPageValue))
        throw new Error("invalid PDF page");
      const result = context.db
        .prepare(
          `
        UPDATE studio_document_page_links
        SET pdf_page = ?, label = ?, updated_at = ?
        WHERE id = ?
      `,
        )
        .run(
          pdfPageValue,
          normalizeOptionalString(label),
          updatedAt ?? updated_at,
          id,
        );
      if (result.changes === 0) throw new Error("link not found");
    },

    unlinkStudioDocumentPage({ id }) {
      const result = context.db
        .prepare("DELETE FROM studio_document_page_links WHERE id = ?")
        .run(id);
      if (result.changes === 0) throw new Error("link not found");
    },
  };

  return studioLinkBackend;
}

module.exports = { createStudioLinkBackend };
