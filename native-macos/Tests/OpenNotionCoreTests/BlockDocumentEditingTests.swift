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

    func testSplittingForEditingFocusesNewBlockAtStart() {
        var document = BlockDocument(blocks: [
            Block(id: "a", kind: .paragraph, text: "HelloWorld", rawJSON: nil)
        ])

        let focus = document.splitBlockForEditing(id: "a", at: 5, newID: "b")

        XCTAssertEqual(focus, BlockFocusTarget(blockID: "b", utf16Offset: 0))
        XCTAssertEqual(document.blocks.map(\.id), ["a", "b"])
        XCTAssertEqual(document.blocks.map(\.text), ["Hello", "World"])
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

    func testHeadingKindNormalizesToSupportedRange() {
        var document = BlockDocument(blocks: [
            Block(id: "a", kind: .paragraph, text: "Title", rawJSON: nil),
            Block(id: "b", kind: .paragraph, text: "Tiny", rawJSON: nil)
        ])

        document.replaceKind(id: "a", with: .heading(level: 4))
        document.replaceKind(id: "b", with: .heading(level: 12))

        XCTAssertEqual(document.blocks.map(\.kind), [.heading(level: 4), .heading(level: 4)])
    }

    func testSlashMenuPreviewOffsetStaysInsideVisibleMenu() {
        XCTAssertEqual(
            SlashMenuLayout.previewTopOffset(selectedIndex: 0, rowHeight: 43, maxVisibleOffset: 172),
            40
        )
        XCTAssertEqual(
            SlashMenuLayout.previewTopOffset(selectedIndex: 9, rowHeight: 43, maxVisibleOffset: 172),
            172
        )
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

    func testMarkdownHeadingShortcutConvertsCurrentBlock() {
        var document = BlockDocument(blocks: [
            Block(id: "a", kind: .paragraph, text: "##", rawJSON: nil)
        ])

        XCTAssertTrue(document.applyMarkdownShortcut(id: "a"))

        XCTAssertEqual(document.blocks[0], Block(id: "a", kind: .heading(level: 2), text: "", rawJSON: nil))
    }

    func testMarkdownListAndDividerShortcutsConvertCurrentBlock() {
        var bulletDocument = BlockDocument(blocks: [
            Block(id: "bullet", kind: .paragraph, text: "-", rawJSON: nil)
        ])
        var numberedDocument = BlockDocument(blocks: [
            Block(id: "numbered", kind: .paragraph, text: "1.", rawJSON: nil)
        ])
        var checklistDocument = BlockDocument(blocks: [
            Block(id: "checklist", kind: .paragraph, text: "[]", rawJSON: nil)
        ])
        var codeDocument = BlockDocument(blocks: [
            Block(id: "code", kind: .paragraph, text: "```", rawJSON: nil)
        ])
        var dividerDocument = BlockDocument(blocks: [
            Block(id: "divider", kind: .paragraph, text: "---", rawJSON: nil)
        ])

        XCTAssertTrue(bulletDocument.applyMarkdownShortcut(id: "bullet"))
        XCTAssertTrue(numberedDocument.applyMarkdownShortcut(id: "numbered"))
        XCTAssertTrue(checklistDocument.applyMarkdownShortcut(id: "checklist"))
        XCTAssertTrue(codeDocument.applyMarkdownShortcut(id: "code"))
        XCTAssertTrue(dividerDocument.applyMarkdownShortcut(id: "divider"))

        XCTAssertEqual(bulletDocument.blocks[0], Block(id: "bullet", kind: .bulletListItem, text: "", rawJSON: nil))
        XCTAssertEqual(numberedDocument.blocks[0], Block(id: "numbered", kind: .numberedListItem, text: "", rawJSON: nil))
        XCTAssertEqual(checklistDocument.blocks[0], Block(id: "checklist", kind: .checkListItem(checked: false), text: "", rawJSON: nil))
        XCTAssertEqual(codeDocument.blocks[0], Block(id: "code", kind: .code, text: "", rawJSON: nil))
        XCTAssertEqual(dividerDocument.blocks[0], Block(id: "divider", kind: .divider, text: "", rawJSON: nil))
    }

    func testMergingBlockWithPreviousAppendsTextAndReturnsCaretOffset() {
        var document = BlockDocument(blocks: [
            Block(id: "a", kind: .paragraph, text: "Hello", rawJSON: nil),
            Block(id: "b", kind: .paragraph, text: " world", rawJSON: nil)
        ])

        let focus = document.mergeBlockWithPrevious(id: "b")

        XCTAssertEqual(focus, BlockFocusTarget(blockID: "a", utf16Offset: 5))
        XCTAssertEqual(document.blocks, [
            Block(id: "a", kind: .paragraph, text: "Hello world", rawJSON: nil)
        ])
    }

    func testMergingEmptyBlockWithPreviousDeletesBlockAndFocusesPreviousEnd() {
        var document = BlockDocument(blocks: [
            Block(id: "a", kind: .paragraph, text: "Previous", rawJSON: nil),
            Block(id: "b", kind: .paragraph, text: "", rawJSON: nil)
        ])

        let focus = document.mergeBlockWithPrevious(id: "b")

        XCTAssertEqual(focus, BlockFocusTarget(blockID: "a", utf16Offset: 8))
        XCTAssertEqual(document.blocks, [
            Block(id: "a", kind: .paragraph, text: "Previous", rawJSON: nil)
        ])
    }
}
