import Foundation
import GRDB
import XCTest
@testable import OpenNotionCore

final class SQLitePageRepositoryTests: XCTestCase {
    func testBootstrapsCompatiblePagesTableAndRoundTripsPage() throws {
        let repository = try SQLitePageRepository(databasePath: temporaryDatabasePath())
        try repository.bootstrap()

        let created = try repository.createPage(
            id: "page-1",
            title: "First page",
            parentID: nil,
            createdAt: "2026-05-21T10:00:00.000Z"
        )

        XCTAssertEqual(created.id, "page-1")
        XCTAssertEqual(created.title, "First page")
        XCTAssertEqual(created.isDeleted, 0)
        XCTAssertEqual(created.sortOrder, -1)

        let pages = try repository.listPages()
        XCTAssertEqual(pages.map(\.id), ["page-1"])
        XCTAssertEqual(pages.first?.createdAt, "2026-05-21T10:00:00.000Z")
    }

    func testSearchMatchesTitleAndSearchText() throws {
        let repository = try SQLitePageRepository(databasePath: temporaryDatabasePath())
        try repository.bootstrap()
        _ = try repository.createPage(
            id: "page-1",
            title: "Roadmap",
            parentID: nil,
            createdAt: "2026-05-21T10:00:00.000Z"
        )
        try repository.updatePage(
            id: "page-1",
            updates: PageUpdates(content: "[]", searchText: "native swift rewrite"),
            updatedAt: "2026-05-21T10:01:00.000Z"
        )

        XCTAssertEqual(try repository.searchPages(query: "road").map(\.id), ["page-1"])
        XCTAssertEqual(try repository.searchPages(query: "swift").map(\.id), ["page-1"])
        XCTAssertEqual(try repository.searchPages(query: "missing"), [])
    }

    func testListPagesOmitsContentButPageLoadsContent() throws {
        let repository = try SQLitePageRepository(databasePath: temporaryDatabasePath())
        try repository.bootstrap()
        _ = try repository.createPage(
            id: "page-1",
            title: "Large body",
            parentID: nil,
            createdAt: "2026-05-21T10:00:00.000Z"
        )
        try repository.updatePage(
            id: "page-1",
            updates: PageUpdates(content: "[{\"type\":\"paragraph\",\"content\":\"Body\"}]", searchText: "Body"),
            updatedAt: "2026-05-21T10:01:00.000Z"
        )

        let metadata = try XCTUnwrap(repository.listPages().first)
        let detail = try XCTUnwrap(repository.page(id: "page-1"))

        XCTAssertNil(metadata.content)
        XCTAssertEqual(metadata.searchText, "Body")
        XCTAssertEqual(detail.content, "[{\"type\":\"paragraph\",\"content\":\"Body\"}]")
    }

    func testDuplicatePageCopiesContentMetadataAndParentOnly() throws {
        let repository = try SQLitePageRepository(databasePath: temporaryDatabasePath())
        try repository.bootstrap()
        _ = try repository.createPage(
            id: "parent",
            title: "Parent",
            parentID: nil,
            createdAt: "2026-05-21T09:00:00.000Z"
        )
        _ = try repository.createPage(
            id: "source",
            title: "Original",
            parentID: "parent",
            createdAt: "2026-05-21T10:00:00.000Z"
        )
        try repository.updatePage(
            id: "source",
            updates: PageUpdates(
                content: "source content",
                searchText: "source search",
                icon: "pin",
                coverURL: "asset://cover.png",
                isFavorite: 1,
                isTemplate: 1,
                isDatabase: 1,
                databaseSchema: "{\"columns\":[]}",
                properties: "{\"status\":\"todo\"}"
            ),
            updatedAt: "2026-05-21T10:01:00.000Z"
        )

        let duplicate = try repository.duplicatePage(
            sourceID: "source",
            id: "copy",
            createdAt: "2026-05-21T10:02:00.000Z"
        )

        XCTAssertEqual(duplicate.id, "copy")
        XCTAssertEqual(duplicate.title, "Copy of Original")
        XCTAssertEqual(duplicate.parentID, "parent")
        XCTAssertEqual(duplicate.content, "source content")
        XCTAssertEqual(duplicate.searchText, "source search")
        XCTAssertEqual(duplicate.icon, "pin")
        XCTAssertEqual(duplicate.coverURL, "asset://cover.png")
        XCTAssertEqual(duplicate.isFavorite, 0)
        XCTAssertEqual(duplicate.isTemplate, 0)
        XCTAssertEqual(duplicate.isDatabase, 1)
        XCTAssertEqual(duplicate.databaseSchema, "{\"columns\":[]}")
        XCTAssertEqual(duplicate.properties, "{\"status\":\"todo\"}")
    }

    func testDeletePageMovesPageTreeToTrash() throws {
        let databasePath = temporaryDatabasePath()
        let repository = try SQLitePageRepository(databasePath: databasePath)
        try repository.bootstrap()
        _ = try repository.createPage(
            id: "parent",
            title: "Parent",
            parentID: nil,
            createdAt: "2026-05-21T10:00:00.000Z"
        )
        _ = try repository.createPage(
            id: "child",
            title: "Child",
            parentID: "parent",
            createdAt: "2026-05-21T10:01:00.000Z"
        )

        try repository.deletePage(id: "parent")

        XCTAssertEqual(try repository.listPages(), [])
        XCTAssertEqual(try repository.listDeletedPages().map(\.id), ["child", "parent"])
    }

    func testMovePageReparentsToTargetAndRoot() throws {
        let repository = try SQLitePageRepository(databasePath: temporaryDatabasePath())
        try repository.bootstrap()
        _ = try repository.createPage(
            id: "parent",
            title: "Parent",
            parentID: nil,
            createdAt: "2026-05-21T10:00:00.000Z"
        )
        _ = try repository.createPage(
            id: "child",
            title: "Child",
            parentID: "parent",
            createdAt: "2026-05-21T10:01:00.000Z"
        )
        _ = try repository.createPage(
            id: "target",
            title: "Target",
            parentID: nil,
            createdAt: "2026-05-21T10:02:00.000Z"
        )

        try repository.movePage(id: "child", parentID: "target", updatedAt: "2026-05-21T10:03:00.000Z")
        XCTAssertEqual(try repository.page(id: "child")?.parentID, "target")

        try repository.movePage(id: "child", parentID: nil, updatedAt: "2026-05-21T10:04:00.000Z")
        XCTAssertNil(try repository.page(id: "child")?.parentID)
    }

    func testMovePageRejectsSelfAndDescendantTargets() throws {
        let repository = try SQLitePageRepository(databasePath: temporaryDatabasePath())
        try repository.bootstrap()
        _ = try repository.createPage(
            id: "parent",
            title: "Parent",
            parentID: nil,
            createdAt: "2026-05-21T10:00:00.000Z"
        )
        _ = try repository.createPage(
            id: "child",
            title: "Child",
            parentID: "parent",
            createdAt: "2026-05-21T10:01:00.000Z"
        )
        _ = try repository.createPage(
            id: "grandchild",
            title: "Grandchild",
            parentID: "child",
            createdAt: "2026-05-21T10:02:00.000Z"
        )

        XCTAssertThrowsError(try repository.movePage(id: "child", parentID: "child", updatedAt: "2026-05-21T10:03:00.000Z"))
        XCTAssertThrowsError(try repository.movePage(id: "child", parentID: "grandchild", updatedAt: "2026-05-21T10:04:00.000Z"))
    }

    func testRestorePageReturnsPageTreeToActivePages() throws {
        let repository = try SQLitePageRepository(databasePath: temporaryDatabasePath())
        try repository.bootstrap()
        _ = try repository.createPage(
            id: "parent",
            title: "Parent",
            parentID: nil,
            createdAt: "2026-05-21T10:00:00.000Z"
        )
        _ = try repository.createPage(
            id: "child",
            title: "Child",
            parentID: "parent",
            createdAt: "2026-05-21T10:01:00.000Z"
        )
        try repository.deletePage(id: "parent")

        try repository.restorePage(id: "parent")

        XCTAssertEqual(try repository.listDeletedPages(), [])
        XCTAssertEqual(try repository.listPages().map(\.id), ["child", "parent"])
    }

    func testPermanentlyDeletePageRemovesPageTreeFromTrash() throws {
        let databasePath = temporaryDatabasePath()
        let repository = try SQLitePageRepository(databasePath: databasePath)
        try repository.bootstrap()
        _ = try repository.createPage(
            id: "parent",
            title: "Parent",
            parentID: nil,
            createdAt: "2026-05-21T10:00:00.000Z"
        )
        _ = try repository.createPage(
            id: "child",
            title: "Child",
            parentID: "parent",
            createdAt: "2026-05-21T10:01:00.000Z"
        )
        try repository.deletePage(id: "parent")

        try repository.permanentlyDeletePage(id: "parent")

        let database = try DatabaseQueue(path: databasePath)
        let remainingIDs = try database.read { db in
            try String.fetchAll(db, sql: "SELECT id FROM pages ORDER BY id")
        }
        XCTAssertEqual(remainingIDs, [])
    }

    private func temporaryDatabasePath() -> String {
        let directory = FileManager.default.temporaryDirectory
        let filename = "opennotion-native-\(UUID().uuidString).sqlite"
        return directory.appendingPathComponent(filename).path
    }
}
