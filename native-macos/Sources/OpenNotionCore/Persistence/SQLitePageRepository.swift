import Foundation
import GRDB

public enum SQLitePageRepositoryError: Error, Equatable {
    case invalidMove(String)
}

public final class SQLitePageRepository: PageRepository, @unchecked Sendable {
    private let databasePool: DatabasePool
    private let databasePath: String
    private let safetyOptions: DatabaseSafetyOptions
    private let backupLock = NSLock()
    private var backupPath: String?
    private var didEvaluateBackup = false

    public init(databasePath: String, safetyOptions: DatabaseSafetyOptions = .disabled) throws {
        self.databasePath = DatabaseSafety.standardizedPath(databasePath)
        self.safetyOptions = safetyOptions
        databasePool = try DatabasePool(path: databasePath)
    }

    public var safetyStatus: DatabaseSafetyStatus {
        backupLock.lock()
        let currentBackupPath = backupPath
        backupLock.unlock()

        if let session = safetyOptions.session {
            return DatabaseSafetyStatus(
                activeDatabasePath: session.activeDatabasePath,
                sourceDatabasePath: session.sourceDatabasePath,
                isLiveDatabase: session.isLiveDatabase,
                isTestingCopy: session.isTestingCopy,
                warningMessage: session.warningMessage,
                backupPath: currentBackupPath
            )
        }

        let livePath = safetyOptions.liveDatabasePath.map(DatabaseSafety.standardizedPath)
        let isLive = livePath == databasePath && safetyOptions.backupBeforeWrites
        return DatabaseSafetyStatus(
            activeDatabasePath: databasePath,
            sourceDatabasePath: livePath,
            isLiveDatabase: isLive,
            isTestingCopy: false,
            warningMessage: isLive ? "Native app is writing to its local database. A backup is created before the first write." : nil,
            backupPath: currentBackupPath
        )
    }

    public func bootstrap() throws {
        try backupBeforeFirstLiveWriteIfNeeded()

        try databasePool.writeWithoutTransaction { db in
            try db.execute(sql: "PRAGMA journal_mode = WAL")
            try db.execute(sql: "PRAGMA synchronous = NORMAL")
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS app_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                """)
            try db.execute(
                sql: """
                    INSERT INTO app_metadata (key, value)
                    VALUES ('schema_version', '1')
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value
                    """)
            try db.execute(sql: """
                CREATE TABLE IF NOT EXISTS pages (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    parent_id TEXT,
                    content TEXT,
                    icon TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                """)

            let columns = try String.fetchAll(db, sql: "SELECT name FROM pragma_table_info('pages')")
            try addColumnIfNeeded(db, columns: columns, name: "cover_url", definition: "TEXT")
            try addColumnIfNeeded(db, columns: columns, name: "search_text", definition: "TEXT")
            try addColumnIfNeeded(db, columns: columns, name: "is_deleted", definition: "INTEGER DEFAULT 0")
            try addColumnIfNeeded(db, columns: columns, name: "is_favorite", definition: "INTEGER DEFAULT 0")
            try addColumnIfNeeded(db, columns: columns, name: "sort_order", definition: "INTEGER DEFAULT 0")
            try addColumnIfNeeded(db, columns: columns, name: "is_template", definition: "INTEGER DEFAULT 0")
            try addColumnIfNeeded(db, columns: columns, name: "is_database", definition: "INTEGER DEFAULT 0")
            try addColumnIfNeeded(db, columns: columns, name: "database_schema", definition: "TEXT")
            try addColumnIfNeeded(db, columns: columns, name: "properties", definition: "TEXT")
            try db.execute(sql: """
                CREATE INDEX IF NOT EXISTS idx_pages_active_parent_sort
                ON pages (is_deleted, parent_id, sort_order)
                """)
            try db.execute(sql: """
                CREATE INDEX IF NOT EXISTS idx_pages_active_updated_at
                ON pages (is_deleted, updated_at)
                """)
        }
    }

    public func listPages() throws -> [Page] {
        try databasePool.read { db in
            try Row.fetchAll(db, sql: Self.pageMetadataSelectSQL + """
                WHERE is_deleted = 0
                ORDER BY sort_order ASC, created_at DESC
                """)
            .map(Page.init(row:))
        }
    }

    public func listDeletedPages() throws -> [Page] {
        try databasePool.read { db in
            try Row.fetchAll(db, sql: Self.pageMetadataSelectSQL + """
                WHERE is_deleted = 1
                ORDER BY updated_at DESC
                """)
            .map(Page.init(row:))
        }
    }

    public func page(id: String) throws -> Page? {
        try databasePool.read { db in
            try Row.fetchOne(
                db,
                sql: Self.pageSelectSQL + """
                    WHERE id = ?
                    """,
                arguments: [id])
            .map(Page.init(row:))
        }
    }

    public func searchPages(query: String) throws -> [Page] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return []
        }

        let pattern = "%\(trimmed.lowercased())%"
        return try databasePool.read { db in
            try Row.fetchAll(
                db,
                sql: Self.pageMetadataSelectSQL + """
                    WHERE is_deleted = 0
                      AND (lower(coalesce(title, '')) LIKE ? OR lower(coalesce(search_text, '')) LIKE ?)
                    ORDER BY
                      CASE WHEN lower(coalesce(title, '')) LIKE ? THEN 0 ELSE 1 END,
                      updated_at DESC
                    LIMIT 50
                    """,
                arguments: [pattern, pattern, pattern])
            .map(Page.init(row:))
        }
    }

    public func createPage(id: String, title: String, parentID: String?, createdAt: String) throws -> Page {
        try backupBeforeFirstLiveWriteIfNeeded()

        return try databasePool.write { db in
            let sortOrder = try Int.fetchOne(
                db,
                sql: """
                    SELECT COALESCE(MIN(sort_order), 0) - 1
                    FROM pages
                    WHERE is_deleted = 0
                      AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
                    """,
                arguments: [parentID, parentID]) ?? -1

            try db.execute(
                sql: """
                    INSERT INTO pages (
                        id, title, parent_id, content, search_text, icon, cover_url,
                        is_deleted, is_favorite, is_template, is_database,
                        database_schema, properties, sort_order, created_at, updated_at
                    )
                    VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 0, 0, 0, 0, NULL, NULL, ?, ?, ?)
                    """,
                arguments: [id, title, parentID, sortOrder, createdAt, createdAt])

            return Page(
                id: id,
                title: title,
                parentID: parentID,
                sortOrder: sortOrder,
                createdAt: createdAt,
                updatedAt: createdAt
            )
        }
    }

    public func duplicatePage(sourceID: String, id: String, createdAt: String) throws -> Page {
        try backupBeforeFirstLiveWriteIfNeeded()

        return try databasePool.write { db in
            guard let sourceRow = try Row.fetchOne(
                db,
                sql: Self.pageSelectSQL + "WHERE id = ? AND is_deleted = 0",
                arguments: [sourceID]
            ) else {
                throw PageRepositoryError.pageNotFound
            }

            let source = Page(row: sourceRow)
            let sortOrder = try Int.fetchOne(
                db,
                sql: """
                    SELECT COALESCE(MIN(sort_order), 0) - 1
                    FROM pages
                    WHERE is_deleted = 0
                      AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
                    """,
                arguments: [source.parentID, source.parentID]) ?? -1
            let title = "Copy of \(source.title)"

            try db.execute(
                sql: """
                    INSERT INTO pages (
                        id, title, parent_id, content, search_text, icon, cover_url,
                        is_deleted, is_favorite, is_template, is_database,
                        database_schema, properties, sort_order, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?)
                    """,
                arguments: [
                    id,
                    title,
                    source.parentID,
                    source.content,
                    source.searchText,
                    source.icon,
                    source.coverURL,
                    source.isDatabase,
                    source.databaseSchema,
                    source.properties,
                    sortOrder,
                    createdAt,
                    createdAt
                ])

            return Page(
                id: id,
                title: title,
                parentID: source.parentID,
                content: source.content,
                searchText: source.searchText,
                icon: source.icon,
                coverURL: source.coverURL,
                isFavorite: 0,
                isTemplate: 0,
                isDatabase: source.isDatabase,
                databaseSchema: source.databaseSchema,
                properties: source.properties,
                sortOrder: sortOrder,
                createdAt: createdAt,
                updatedAt: createdAt
            )
        }
    }

    public func movePage(id: String, parentID: String?, updatedAt: String) throws {
        try backupBeforeFirstLiveWriteIfNeeded()

        try databasePool.write { db in
            if let parentID {
                guard parentID != id else {
                    throw SQLitePageRepositoryError.invalidMove("page cannot be moved under itself")
                }

                let parentExists = try String.fetchOne(
                    db,
                    sql: "SELECT id FROM pages WHERE id = ? AND is_deleted = 0",
                    arguments: [parentID])
                guard parentExists != nil else {
                    throw SQLitePageRepositoryError.invalidMove("target parent page does not exist")
                }

                let descendantMatch = try String.fetchOne(
                    db,
                    sql: """
                        WITH RECURSIVE descendants(id) AS (
                            SELECT id FROM pages WHERE parent_id = ?
                            UNION ALL
                            SELECT pages.id FROM pages
                            JOIN descendants ON pages.parent_id = descendants.id
                        )
                        SELECT id FROM descendants WHERE id = ? LIMIT 1
                        """,
                    arguments: [id, parentID])
                guard descendantMatch == nil else {
                    throw SQLitePageRepositoryError.invalidMove("page cannot be moved under one of its descendants")
                }
            }

            try db.execute(
                sql: "UPDATE pages SET parent_id = ?, updated_at = ? WHERE id = ?",
                arguments: StatementArguments([
                    parentID?.databaseValue ?? DatabaseValue.null,
                    updatedAt.databaseValue,
                    id.databaseValue
                ]))

            guard db.changesCount > 0 else {
                throw SQLitePageRepositoryError.invalidMove("page does not exist")
            }
        }
    }

    public func updatePage(id: String, updates: PageUpdates, updatedAt: String) throws {
        try backupBeforeFirstLiveWriteIfNeeded()

        try databasePool.write { db in
            if let title = updates.title {
                try update(db, id: id, column: "title", value: title, updatedAt: updatedAt)
            }
            if let parentID = updates.parentID {
                try update(db, id: id, column: "parent_id", value: parentID, updatedAt: updatedAt)
            }
            if let content = updates.content {
                let searchText = updates.searchText ?? content
                try db.execute(
                    sql: "UPDATE pages SET content = ?, search_text = ?, updated_at = ? WHERE id = ?",
                    arguments: [content, searchText, updatedAt, id])
            }
            if let icon = updates.icon {
                try update(db, id: id, column: "icon", value: icon, updatedAt: updatedAt)
            }
            if let coverURL = updates.coverURL {
                try update(db, id: id, column: "cover_url", value: coverURL, updatedAt: updatedAt)
            }
            if let isDeleted = updates.isDeleted {
                try update(db, id: id, column: "is_deleted", value: isDeleted, updatedAt: updatedAt)
            }
            if let isFavorite = updates.isFavorite {
                try update(db, id: id, column: "is_favorite", value: isFavorite, updatedAt: updatedAt)
            }
            if let isTemplate = updates.isTemplate {
                try update(db, id: id, column: "is_template", value: isTemplate, updatedAt: updatedAt)
            }
            if let isDatabase = updates.isDatabase {
                try update(db, id: id, column: "is_database", value: isDatabase, updatedAt: updatedAt)
            }
            if let databaseSchema = updates.databaseSchema {
                try update(db, id: id, column: "database_schema", value: databaseSchema, updatedAt: updatedAt)
            }
            if let properties = updates.properties {
                try update(db, id: id, column: "properties", value: properties, updatedAt: updatedAt)
            }
        }
    }

    public func deletePage(id: String) throws {
        try backupBeforeFirstLiveWriteIfNeeded()

        try databasePool.write { db in
            try db.execute(
                sql: """
                    WITH RECURSIVE descendants(id) AS (
                        SELECT id FROM pages WHERE id = ?
                        UNION
                        SELECT pages.id FROM pages
                        JOIN descendants ON pages.parent_id = descendants.id
                    )
                    UPDATE pages
                    SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
                    WHERE id IN (SELECT id FROM descendants)
                    """,
                arguments: [id])
        }
    }

    public func restorePage(id: String) throws {
        try backupBeforeFirstLiveWriteIfNeeded()

        try databasePool.write { db in
            try db.execute(
                sql: """
                    WITH RECURSIVE descendants(id) AS (
                        SELECT id FROM pages WHERE id = ?
                        UNION
                        SELECT pages.id FROM pages
                        JOIN descendants ON pages.parent_id = descendants.id
                    )
                    UPDATE pages
                    SET is_deleted = 0, updated_at = CURRENT_TIMESTAMP
                    WHERE id IN (SELECT id FROM descendants)
                    """,
                arguments: [id])
        }
    }

    public func permanentlyDeletePage(id: String) throws {
        try backupBeforeFirstLiveWriteIfNeeded()

        try databasePool.write { db in
            try db.execute(
                sql: """
                    WITH RECURSIVE descendants(id) AS (
                        SELECT id FROM pages WHERE id = ?
                        UNION
                        SELECT pages.id FROM pages
                        JOIN descendants ON pages.parent_id = descendants.id
                    )
                    DELETE FROM pages
                    WHERE id IN (SELECT id FROM descendants)
                    """,
                arguments: [id])
        }
    }

    private func backupBeforeFirstLiveWriteIfNeeded() throws {
        backupLock.lock()
        defer { backupLock.unlock() }

        guard !didEvaluateBackup else {
            return
        }

        guard safetyOptions.backupBeforeWrites,
              let liveDatabasePath = safetyOptions.liveDatabasePath.map(DatabaseSafety.standardizedPath),
              liveDatabasePath == databasePath,
              FileManager.default.fileExists(atPath: databasePath) else {
            didEvaluateBackup = true
            return
        }

        let backupDirectory = safetyOptions.backupDirectory
            ?? DatabaseSafety.defaultBackupDirectory(for: databasePath)
        try FileManager.default.createDirectory(
            atPath: backupDirectory,
            withIntermediateDirectories: true
        )
        let destinationPath = DatabaseSafety.backupPath(for: databasePath, in: backupDirectory)
        let destination = try DatabaseQueue(path: destinationPath)
        try databasePool.backup(to: destination)
        backupPath = destinationPath
        didEvaluateBackup = true
    }

    private static let pageSelectSQL = """
        SELECT id, title, parent_id, content, search_text, icon, cover_url,
               is_deleted, is_favorite, is_template, is_database,
               database_schema, properties, sort_order, created_at, updated_at
        FROM pages

        """

    private static let pageMetadataSelectSQL = """
        SELECT id, title, parent_id, NULL AS content, search_text, icon, cover_url,
               is_deleted, is_favorite, is_template, is_database,
               database_schema, properties, sort_order, created_at, updated_at
        FROM pages

        """

    private func addColumnIfNeeded(_ db: Database, columns: [String], name: String, definition: String) throws {
        guard !columns.contains(name) else {
            return
        }
        try db.execute(sql: "ALTER TABLE pages ADD COLUMN \(name) \(definition)")
        if name == "search_text" {
            try db.execute(sql: "UPDATE pages SET search_text = content WHERE search_text IS NULL")
        }
        if name == "sort_order" {
            try db.execute(sql: "UPDATE pages SET sort_order = rowid WHERE sort_order = 0")
        }
    }

    private func update(_ db: Database, id: String, column: String, value: DatabaseValueConvertible, updatedAt: String) throws {
        try db.execute(
            sql: "UPDATE pages SET \(column) = ?, updated_at = ? WHERE id = ?",
            arguments: StatementArguments([value.databaseValue, updatedAt.databaseValue, id.databaseValue]))
    }
}

private extension Page {
    init(row: Row) {
        self.init(
            id: row["id"],
            title: (row["title"] as String?) ?? "Untitled",
            parentID: row["parent_id"],
            content: row["content"],
            searchText: row["search_text"],
            icon: row["icon"],
            coverURL: row["cover_url"],
            isDeleted: row["is_deleted"],
            isFavorite: row["is_favorite"],
            isTemplate: row["is_template"],
            isDatabase: row["is_database"],
            databaseSchema: row["database_schema"],
            properties: row["properties"],
            sortOrder: row["sort_order"],
            createdAt: (row["created_at"] as String?) ?? "",
            updatedAt: (row["updated_at"] as String?) ?? ""
        )
    }
}
