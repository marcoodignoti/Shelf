import XCTest
import OpenNotionCore
@testable import OpenNotionNative

@MainActor
final class OpenNotionStoreTests: XCTestCase {
    func testSavingBackgroundPageKeepsCurrentSelection() {
        let repository = RecordingPageRepository(pages: [
            Page(id: "old", title: "Old", createdAt: "2026-05-21T10:00:00.000Z", updatedAt: "2026-05-21T10:00:00.000Z"),
            Page(id: "new", title: "New", createdAt: "2026-05-21T10:01:00.000Z", updatedAt: "2026-05-21T10:01:00.000Z")
        ])
        let store = OpenNotionStore(repository: repository)
        store.load()
        store.select(repository.pages[1])

        store.save(
            pageID: "old",
            title: "Old changed",
            document: BlockDocument(blocks: [
                Block(id: "block", kind: .paragraph, text: "Changed", rawJSON: nil)
            ])
        )

        XCTAssertEqual(store.selectedPageID, "new")
        XCTAssertEqual(repository.updatedPageIDs, ["old"])
    }

    func testDraftDirtyStateTracksChangesUntilMarkedSaved() {
        let document = BlockDocument.empty
        var draft = PageEditorDraft(
            title: "",
            document: document,
            savedTitle: "Untitled",
            savedDocument: document
        )

        XCTAssertFalse(draft.isDirty)

        draft.title = "Renamed"
        XCTAssertTrue(draft.isDirty)
        XCTAssertEqual(draft.persistedTitle, "Renamed")

        draft.markSaved()
        XCTAssertFalse(draft.isDirty)

        draft.document.updateText(id: draft.document.blocks[0].id, text: "Body")
        XCTAssertTrue(draft.isDirty)
    }

    func testTogglingFavoriteUpdatesPageAndKeepsSelection() {
        let repository = RecordingPageRepository(pages: [
            Page(id: "target", title: "Target", isFavorite: 0, createdAt: "2026-05-21T10:00:00.000Z", updatedAt: "2026-05-21T10:00:00.000Z"),
            Page(id: "selected", title: "Selected", createdAt: "2026-05-21T10:01:00.000Z", updatedAt: "2026-05-21T10:01:00.000Z")
        ])
        let store = OpenNotionStore(repository: repository)
        store.load()
        store.select(repository.pages[1])

        XCTAssertTrue(store.toggleFavorite(pageID: "target"))

        XCTAssertEqual(repository.updatedPageIDs, ["target"])
        XCTAssertEqual(repository.pages.first { $0.id == "target" }?.isFavorite, 1)
        XCTAssertEqual(store.pages.first { $0.id == "target" }?.isFavorite, 1)
        XCTAssertEqual(store.selectedPageID, "selected")
    }
}

private final class RecordingPageRepository: PageRepository, @unchecked Sendable {
    var pages: [Page]
    private(set) var updatedPageIDs: [String] = []

    init(pages: [Page]) {
        self.pages = pages
    }

    var safetyStatus: DatabaseSafetyStatus { .unavailable }

    func bootstrap() throws {}

    func listPages() throws -> [Page] {
        pages
    }

    func searchPages(query: String) throws -> [Page] {
        []
    }

    func createPage(id: String, title: String, parentID: String?, createdAt: String) throws -> Page {
        let page = Page(id: id, title: title, parentID: parentID, createdAt: createdAt, updatedAt: createdAt)
        pages.insert(page, at: 0)
        return page
    }

    func updatePage(id: String, updates: PageUpdates, updatedAt: String) throws {
        updatedPageIDs.append(id)
        guard let index = pages.firstIndex(where: { $0.id == id }) else {
            return
        }

        if let title = updates.title {
            pages[index].title = title
        }
        if let content = updates.content {
            pages[index].content = content
        }
        if let searchText = updates.searchText {
            pages[index].searchText = searchText
        }
        if let isFavorite = updates.isFavorite {
            pages[index].isFavorite = isFavorite
        }
        pages[index].updatedAt = updatedAt
    }

    func deletePage(id: String) throws {
        pages.removeAll { $0.id == id }
    }
}
