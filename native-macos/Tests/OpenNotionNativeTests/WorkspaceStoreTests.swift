import XCTest
import OpenNotionCore
@testable import OpenNotionNative

@MainActor
final class WorkspaceStoreTests: XCTestCase {
    func testOpeningURLCreatesPageAndLinkedNote() throws {
        let repository = RecordingResearchRepository(data: .defaultData(createdAt: "2026-05-27T09:00:00Z"))
        let store = WorkspaceStore(repository: repository)
        store.load()

        store.urlText = "docs.ros.org/en/jazzy/p/sensor_msgs/msg/JointState.html"
        XCTAssertTrue(store.openAddressBarURL())

        let page = try XCTUnwrap(store.currentPage)
        XCTAssertEqual(page.workspaceID, store.selectedWorkspaceID)
        XCTAssertEqual(page.urlString, "https://docs.ros.org/en/jazzy/p/sensor_msgs/msg/JointState.html")
        XCTAssertNotNil(store.currentNote)
        XCTAssertEqual(repository.data.pages.map(\.id), [page.id])
        XCTAssertEqual(repository.data.notes.map(\.pageID), [page.id])
    }

    func testSearchMatchesNotesTitlesAndURLs() throws {
        let repository = RecordingResearchRepository(data: .defaultData(createdAt: "2026-05-27T09:00:00Z"))
        let store = WorkspaceStore(repository: repository)
        store.load()

        store.urlText = "https://docs.ros.org/en/jazzy/p/sensor_msgs/msg/JointState.html"
        XCTAssertTrue(store.openAddressBarURL())
        store.updateCurrentPageTitle("JointState message")
        store.updateCurrentNoteBody("joint_states maps names to positions")
        store.updateCurrentNoteTags("robotics, ros")

        store.searchQuery = "joint_states"
        XCTAssertEqual(store.searchResults.map(\.id), [store.currentPage?.id])

        store.searchQuery = "sensor_msgs"
        XCTAssertEqual(store.searchResults.map(\.id), [store.currentPage?.id])

        store.searchQuery = "robotics"
        XCTAssertEqual(store.searchResults.map(\.id), [store.currentPage?.id])
    }

    func testRelatedPagesUseSharedTags() throws {
        let repository = RecordingResearchRepository(data: .defaultData(createdAt: "2026-05-27T09:00:00Z"))
        let store = WorkspaceStore(repository: repository)
        store.load()

        store.urlText = "https://example.com/first"
        XCTAssertTrue(store.openAddressBarURL())
        let firstPageID = try XCTUnwrap(store.currentPage?.id)
        store.updateCurrentNoteTags("physics, paper")

        store.urlText = "https://example.com/second"
        XCTAssertTrue(store.openAddressBarURL())
        store.updateCurrentNoteTags("paper")

        let currentNote = try XCTUnwrap(store.currentNote)
        XCTAssertEqual(store.relatedPages(for: currentNote).map(\.id), [firstPageID])
    }
}

private final class RecordingResearchRepository: ResearchRepository, @unchecked Sendable {
    var data: ResearchWorkspaceData
    private(set) var saveCount = 0

    init(data: ResearchWorkspaceData) {
        self.data = data
    }

    func load() throws -> ResearchWorkspaceData {
        data
    }

    func save(_ data: ResearchWorkspaceData) throws {
        self.data = data
        saveCount += 1
    }
}
