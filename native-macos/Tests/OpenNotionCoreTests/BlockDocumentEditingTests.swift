import XCTest
@testable import OpenNotionCore

final class BlockDocumentEditingTests: XCTestCase {
    func testSplittingNonEmptyListItemContinuesTheList() {
        var document = BlockDocument(blocks: [
            Block(id: "a", kind: .bulletListItem, text: "First item", rawJSON: nil)
        ])

        let focusID = document.splitBlock(id: "a", at: 5, newID: "b")

        XCTAssertEqual(focusID, "b")
        XCTAssertEqual(document.blocks.map(\.id), ["a", "b"])
        XCTAssertEqual(document.blocks.map(\.kind), [.bulletListItem, .bulletListItem])
        XCTAssertEqual(document.blocks.map(\.text), ["First", " item"])
    }

    func testSplittingEmptyListItemExitsToParagraph() {
        var document = BlockDocument(blocks: [
            Block(id: "a", kind: .numberedListItem, text: "", rawJSON: nil)
        ])

        let focusID = document.splitBlock(id: "a", at: 0, newID: "b")

        XCTAssertEqual(focusID, "a")
        XCTAssertEqual(document.blocks, [
            Block(id: "a", kind: .paragraph, text: "", rawJSON: nil)
        ])
    }

    func testHeadingSplitCreatesParagraphAfterHeading() {
        var document = BlockDocument(blocks: [
            Block(id: "a", kind: .heading(level: 2), text: "Roadmap", rawJSON: nil)
        ])

        let focusID = document.splitBlock(id: "a", at: 7, newID: "b")

        XCTAssertEqual(focusID, "b")
        XCTAssertEqual(document.blocks.map(\.kind), [.heading(level: 2), .paragraph])
    }

    func testChangingKindToDividerClearsText() {
        var document = BlockDocument(blocks: [
            Block(id: "a", kind: .paragraph, text: "----", rawJSON: nil)
        ])

        document.replaceKind(id: "a", with: .divider)

        XCTAssertEqual(document.blocks[0], Block(id: "a", kind: .divider, text: "", rawJSON: nil))
    }

    func testTogglingChecklistOnlyChangesChecklistBlocks() {
        var document = BlockDocument(blocks: [
            Block(id: "a", kind: .checkListItem(checked: false), text: "Task", rawJSON: nil),
            Block(id: "b", kind: .paragraph, text: "Note", rawJSON: nil)
        ])

        document.toggleCheck(id: "a")
        document.toggleCheck(id: "b")

        XCTAssertEqual(document.blocks[0].kind, .checkListItem(checked: true))
        XCTAssertEqual(document.blocks[1].kind, .paragraph)
    }

    func testMovingBlockBeforeAnotherBlockReordersDocument() {
        var document = BlockDocument(blocks: [
            Block(id: "a", kind: .paragraph, text: "A", rawJSON: nil),
            Block(id: "b", kind: .paragraph, text: "B", rawJSON: nil),
            Block(id: "c", kind: .paragraph, text: "C", rawJSON: nil)
        ])

        document.moveBlock(id: "c", before: "a")

        XCTAssertEqual(document.blocks.map(\.id), ["c", "a", "b"])
    }

    func testMovingBlockToEndReordersDocument() {
        var document = BlockDocument(blocks: [
            Block(id: "a", kind: .paragraph, text: "A", rawJSON: nil),
            Block(id: "b", kind: .paragraph, text: "B", rawJSON: nil),
            Block(id: "c", kind: .paragraph, text: "C", rawJSON: nil)
        ])

        document.moveBlockToEnd(id: "a")

        XCTAssertEqual(document.blocks.map(\.id), ["b", "c", "a"])
    }

    func testMovingMissingBlockDoesNothing() {
        var document = BlockDocument(blocks: [
            Block(id: "a", kind: .paragraph, text: "A", rawJSON: nil),
            Block(id: "b", kind: .paragraph, text: "B", rawJSON: nil)
        ])

        document.moveBlock(id: "x", before: "a")
        document.moveBlock(id: "a", before: "x")

        XCTAssertEqual(document.blocks.map(\.id), ["a", "b"])
    }
}
