const {
  PAGE_COLUMNS,
  STUDIO_DOCUMENT_COLUMNS,
  STUDIO_PROJECT_COLUMNS,
  rowValue,
  studioProjectPageId,
} = require("./backend-helpers.cjs");

function createStudioProjectBackend(context) {
  const isUnified = () => context.isStudioPageUnified();

  const studioProjectBackend = {
    mirrorStudioProjectPage(project, updatedAt = project.updated_at) {
      const pageId = studioProjectPageId(project.id);
      const parentPageId = project.parent_id
        ? studioProjectPageId(project.parent_id)
        : null;
      const existing = context.db
        .prepare("SELECT id FROM pages WHERE id = ?")
        .get(pageId);
      if (existing) {
        context.db
          .prepare(
            `
          UPDATE pages
          SET title = ?, parent_id = ?, is_deleted = 0, page_kind = 'project', sort_order = ?, updated_at = ?
          WHERE id = ?
        `,
          )
          .run(project.name, parentPageId, project.sort_order, updatedAt, pageId);
        return pageId;
      }

      context.db
        .prepare(
          `
        INSERT INTO pages (${PAGE_COLUMNS})
        VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, ?, 'project', ?, ?)
      `,
        )
        .run(
          pageId,
          project.name,
          parentPageId,
          project.sort_order,
          project.created_at,
          updatedAt,
        );
      return pageId;
    },

    mirrorStudioDocumentPageParent(documentId, projectId, updatedAt) {
      if (!isUnified()) return;
      const document = context.db
        .prepare(
          `SELECT ${STUDIO_DOCUMENT_COLUMNS} FROM studio_documents WHERE id = ?`,
        )
        .get(documentId);
      if (!document) return;
      const parentPageId = projectId ? studioProjectPageId(projectId) : null;
      context.db
        .prepare(
          `
        UPDATE pages
        SET parent_id = ?, page_kind = 'note', updated_at = ?
        WHERE id = ?
      `,
        )
        .run(parentPageId, updatedAt, document.note_page_id);
    },

    listStudioProjects() {
      return context.db
        .prepare(
          `SELECT ${STUDIO_PROJECT_COLUMNS} FROM studio_projects ORDER BY sort_order ASC, name ASC`,
        )
        .all();
    },

    createStudioProject({
      id,
      name,
      parentId,
      parent_id,
      createdAt,
      created_at,
    }) {
      const parent = parentId ?? parent_id ?? null;
      const created = createdAt ?? created_at;
      const trimmed = String(name ?? "").trim();
      if (!trimmed) throw new Error("project name cannot be empty");
      if (parent) {
        const count = rowValue(
          context.db
            .prepare("SELECT COUNT(*) AS value FROM studio_projects WHERE id = ?")
            .get(parent),
          "value",
        );
        if (count === 0) throw new Error("parent project not found");
      }
      const sortOrder = rowValue(
        context.db
          .prepare(
            `
        SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
        FROM studio_projects
        WHERE (? IS NULL AND parent_id IS NULL) OR parent_id = ?
      `,
          )
          .get(parent, parent),
        "value",
      );
      context.db
        .prepare(
          "INSERT INTO studio_projects (id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, trimmed, parent, sortOrder, created, created);
      if (isUnified()) {
        studioProjectBackend.mirrorStudioProjectPage(
          {
            id,
            name: trimmed,
            parent_id: parent,
            sort_order: sortOrder,
            created_at: created,
            updated_at: created,
          },
          created,
        );
      }
      return context.db
        .prepare(
          `SELECT ${STUDIO_PROJECT_COLUMNS} FROM studio_projects WHERE id = ?`,
        )
        .get(id);
    },

    renameStudioProject({ id, name, updatedAt, updated_at }) {
      const trimmed = String(name ?? "").trim();
      if (!trimmed) throw new Error("project name cannot be empty");
      const updated = updatedAt ?? updated_at;
      const result = context.db
        .prepare(
          "UPDATE studio_projects SET name = ?, updated_at = ? WHERE id = ?",
        )
        .run(trimmed, updated, id);
      if (result.changes === 0) throw new Error("project not found");
      if (isUnified()) {
        context.db
          .prepare("UPDATE pages SET title = ?, updated_at = ? WHERE id = ?")
          .run(trimmed, updated, studioProjectPageId(id));
      }
    },

    updateStudioProjectParent({
      id,
      parentId,
      parent_id,
      updatedAt,
      updated_at,
    }) {
      const parent = parentId ?? parent_id ?? null;
      const updated = updatedAt ?? updated_at;
      if (parent === id) throw new Error("project cannot be its own parent");
      if (parent) {
        const parentExists = rowValue(
          context.db
            .prepare("SELECT COUNT(*) AS value FROM studio_projects WHERE id = ?")
            .get(parent),
          "value",
        );
        if (parentExists === 0) throw new Error("parent project not found");
        const wouldCycle = rowValue(
          context.db
            .prepare(
              `
          WITH RECURSIVE ancestors(id, parent_id) AS (
            SELECT id, parent_id FROM studio_projects WHERE id = ?
            UNION ALL
            SELECT studio_projects.id, studio_projects.parent_id
            FROM studio_projects
            INNER JOIN ancestors ON studio_projects.id = ancestors.parent_id
          )
          SELECT COUNT(*) AS value FROM ancestors WHERE id = ?
        `,
            )
            .get(parent, id),
          "value",
        );
        if (wouldCycle > 0) throw new Error("project cycle not allowed");
      }
      const projectExists = rowValue(
        context.db
          .prepare("SELECT COUNT(*) AS value FROM studio_projects WHERE id = ?")
          .get(id),
        "value",
      );
      if (projectExists === 0) throw new Error("project not found");
      const sortOrder = rowValue(
        context.db
          .prepare(
            `
        SELECT COALESCE(MAX(sort_order), -1) + 1 AS value
        FROM studio_projects
        WHERE (? IS NULL AND parent_id IS NULL) OR parent_id = ?
      `,
          )
          .get(parent, parent),
        "value",
      );
      const result = context.db
        .prepare(
          "UPDATE studio_projects SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?",
        )
        .run(parent, sortOrder, updated, id);
      if (result.changes === 0) throw new Error("project not found");
      if (isUnified()) {
        context.db
          .prepare(
            "UPDATE pages SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?",
          )
          .run(
            parent ? studioProjectPageId(parent) : null,
            sortOrder,
            updated,
            studioProjectPageId(id),
          );
      }
    },

    deleteStudioProject({ id, updatedAt, updated_at }) {
      const updated = updatedAt ?? updated_at;
      let deleted = 0;
      context.withTransaction(() => {
        context.db
          .prepare(
            "UPDATE studio_documents SET project_id = NULL, updated_at = ? WHERE project_id = ?",
          )
          .run(updated, id);
        if (isUnified()) {
          context.db
            .prepare(
              `
            UPDATE pages
            SET parent_id = NULL, updated_at = ?
            WHERE id IN (SELECT note_page_id FROM studio_documents WHERE project_id IS NULL)
          `,
            )
            .run(updated);
        }
        context.db
          .prepare(
            "UPDATE studio_projects SET parent_id = NULL, updated_at = ? WHERE parent_id = ?",
          )
          .run(updated, id);
        if (isUnified()) {
          context.db
            .prepare(
              "UPDATE pages SET parent_id = NULL, updated_at = ? WHERE parent_id = ?",
            )
            .run(updated, studioProjectPageId(id));
          context.db
            .prepare(
              "UPDATE pages SET is_deleted = 1, updated_at = ? WHERE id = ?",
            )
            .run(updated, studioProjectPageId(id));
        }
        deleted = context.db
          .prepare("DELETE FROM studio_projects WHERE id = ?")
          .run(id).changes;
      });
      if (deleted === 0) throw new Error("project not found");
    },

    updateStudioDocumentProject({
      id,
      projectId,
      project_id,
      updatedAt,
      updated_at,
    }) {
      const project = projectId ?? project_id ?? null;
      if (project) {
        const projectExists = rowValue(
          context.db
            .prepare("SELECT COUNT(*) AS value FROM studio_projects WHERE id = ?")
            .get(project),
          "value",
        );
        if (projectExists === 0) throw new Error("project not found");
      }
      const updated = updatedAt ?? updated_at;
      const result = context.db
        .prepare(
          "UPDATE studio_documents SET project_id = ?, updated_at = ? WHERE id = ?",
        )
        .run(project, updated, id);
      if (result.changes === 0) throw new Error("document not found");
      studioProjectBackend.mirrorStudioDocumentPageParent(id, project, updated);
    },
  };

  return studioProjectBackend;
}

module.exports = {
  createStudioProjectBackend,
};
