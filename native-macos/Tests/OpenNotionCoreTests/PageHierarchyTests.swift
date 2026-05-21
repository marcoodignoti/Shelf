import XCTest
@testable import OpenNotionCore

final class PageHierarchyTests: XCTestCase {
    func testBuildsNestedPageTreeInRepositoryOrder() {
        let pages = [
            page(id: "root-a", title: "Root A"),
            page(id: "child-a", title: "Child A", parentID: "root-a"),
            page(id: "grandchild-a", title: "Grandchild A", parentID: "child-a"),
            page(id: "root-b", title: "Root B"),
            page(id: "child-b", title: "Child B", parentID: "root-b")
        ]

        let roots = PageHierarchy.tree(from: pages)

        XCTAssertEqual(roots.map(\.page.id), ["root-a", "root-b"])
        XCTAssertEqual(roots[0].children.map(\.page.id), ["child-a"])
        XCTAssertEqual(roots[0].children[0].children.map(\.page.id), ["grandchild-a"])
        XCTAssertEqual(roots[1].children.map(\.page.id), ["child-b"])
    }

    func testOrphanedPagesFallBackToRootLevel() {
        let pages = [
            page(id: "orphan", title: "Orphan", parentID: "missing-parent"),
            page(id: "root", title: "Root")
        ]

        let roots = PageHierarchy.tree(from: pages)

        XCTAssertEqual(roots.map(\.page.id), ["orphan", "root"])
    }

    func testCyclicParentLinksFallBackToRootLevel() {
        let pages = [
            page(id: "cycle-a", title: "Cycle A", parentID: "cycle-b"),
            page(id: "cycle-b", title: "Cycle B", parentID: "cycle-a")
        ]

        let roots = PageHierarchy.tree(from: pages)

        XCTAssertEqual(roots.map(\.page.id), ["cycle-a", "cycle-b"])
        XCTAssertTrue(roots.allSatisfy(\.children.isEmpty))
    }

    private func page(id: String, title: String, parentID: String? = nil) -> Page {
        Page(id: id, title: title, parentID: parentID, createdAt: "2026-05-21T10:00:00.000Z", updatedAt: "2026-05-21T10:00:00.000Z")
    }
}
