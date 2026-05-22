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
