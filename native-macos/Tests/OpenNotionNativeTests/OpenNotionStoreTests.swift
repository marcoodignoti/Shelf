import XCTest
import AppKit
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

    func testDuplicatingPageSelectsDuplicateAndLoadsDetail() {
        let repository = RecordingPageRepository(pages: [
            Page(id: "one", title: "One", content: "body", createdAt: "2026-05-21T10:00:00.000Z", updatedAt: "2026-05-21T10:00:00.000Z")
        ])
        let store = OpenNotionStore(repository: repository)
        store.load()

        XCTAssertTrue(store.duplicatePage(pageID: "one"))

        XCTAssertEqual(repository.duplicatedPageIDs, ["one"])
        XCTAssertEqual(store.selectedPageID, "copy-one")
        XCTAssertEqual(store.selectedPage?.id, "copy-one")
    }

    func testCreatingSubpageSelectsChildAndSetsParent() {
        let repository = RecordingPageRepository(pages: [
            Page(id: "parent", title: "Parent", createdAt: "2026-05-21T10:00:00.000Z", updatedAt: "2026-05-21T10:00:00.000Z")
        ])
        let store = OpenNotionStore(repository: repository)
        store.load()

        store.createPage(parentID: "parent")

        XCTAssertEqual(store.selectedPage?.parentID, "parent")
        XCTAssertEqual(repository.pages.first?.parentID, "parent")
    }

    func testMovingPageUpdatesParentAndKeepsSelection() {
        let repository = RecordingPageRepository(pages: [
            Page(id: "target", title: "Target", createdAt: "2026-05-21T10:00:00.000Z", updatedAt: "2026-05-21T10:00:00.000Z"),
            Page(id: "selected", title: "Selected", createdAt: "2026-05-21T10:01:00.000Z", updatedAt: "2026-05-21T10:01:00.000Z")
        ])
        let store = OpenNotionStore(repository: repository)
        store.load()
        store.select(repository.pages[1])

        XCTAssertTrue(store.movePage(pageID: "selected", parentID: "target"))

        XCTAssertEqual(repository.movedPages, [MovedPage(id: "selected", parentID: "target")])
        XCTAssertEqual(store.pages.first { $0.id == "selected" }?.parentID, "target")
        XCTAssertEqual(store.selectedPageID, "selected")
    }

    func testMovingPageToRootClearsParent() {
        let repository = RecordingPageRepository(pages: [
            Page(id: "parent", title: "Parent", createdAt: "2026-05-21T10:00:00.000Z", updatedAt: "2026-05-21T10:00:00.000Z"),
            Page(id: "child", title: "Child", parentID: "parent", createdAt: "2026-05-21T10:01:00.000Z", updatedAt: "2026-05-21T10:01:00.000Z")
        ])
        let store = OpenNotionStore(repository: repository)
        store.load()
        store.select(repository.pages[1])

        XCTAssertTrue(store.movePage(pageID: "child", parentID: nil))

        XCTAssertEqual(repository.movedPages, [MovedPage(id: "child", parentID: nil)])
        XCTAssertNil(store.pages.first { $0.id == "child" }?.parentID)
        XCTAssertEqual(store.selectedPageID, "child")
    }

    func testLoadFetchesSelectedPageBodyAfterMetadata() {
        let repository = RecordingPageRepository(pages: [
            Page(
                id: "target",
                title: "Target",
                content: "[{\"type\":\"paragraph\",\"content\":\"Body\"}]",
                searchText: "Body",
                createdAt: "2026-05-21T10:00:00.000Z",
                updatedAt: "2026-05-21T10:00:00.000Z"
            )
        ])
        let store = OpenNotionStore(repository: repository)

        store.load()

        XCTAssertEqual(store.pages.first?.content, nil)
        XCTAssertEqual(store.selectedPage?.content, "[{\"type\":\"paragraph\",\"content\":\"Body\"}]")
        XCTAssertEqual(repository.fetchedPageIDs, ["target"])
    }

    func testRequestingSelectedPageDeletionWaitsForConfirmation() {
        let repository = RecordingPageRepository(pages: [
            Page(id: "target", title: "Target", createdAt: "2026-05-21T10:00:00.000Z", updatedAt: "2026-05-21T10:00:00.000Z")
        ])
        let store = OpenNotionStore(repository: repository)
        store.load()

        store.requestDeleteSelectedPage()

        XCTAssertEqual(store.pendingDeletePageID, "target")
        XCTAssertEqual(repository.deletedPageIDs, [])
        XCTAssertEqual(store.pages.map(\.id), ["target"])
    }

    func testConfirmingPendingDeletionMovesPageToTrash() {
        let repository = RecordingPageRepository(pages: [
            Page(id: "target", title: "Target", createdAt: "2026-05-21T10:00:00.000Z", updatedAt: "2026-05-21T10:00:00.000Z")
        ])
        let store = OpenNotionStore(repository: repository)
        store.load()
        store.requestDeletePage(pageID: "target")

        XCTAssertTrue(store.confirmPendingPageDeletion())

        XCTAssertNil(store.pendingDeletePageID)
        XCTAssertEqual(repository.deletedPageIDs, ["target"])
        XCTAssertEqual(store.pages, [])
        XCTAssertEqual(store.deletedPages.map(\.id), ["target"])
    }

    func testRestoringPageMovesItBackToActivePages() {
        let repository = RecordingPageRepository(pages: [
            Page(id: "target", title: "Target", createdAt: "2026-05-21T10:00:00.000Z", updatedAt: "2026-05-21T10:00:00.000Z")
        ])
        let store = OpenNotionStore(repository: repository)
        store.load()
        store.requestDeletePage(pageID: "target")
        _ = store.confirmPendingPageDeletion()

        XCTAssertTrue(store.restorePage(pageID: "target"))

        XCTAssertEqual(repository.restoredPageIDs, ["target"])
        XCTAssertEqual(store.deletedPages, [])
        XCTAssertEqual(store.pages.map(\.id), ["target"])
    }

    func testConfirmingPermanentDeletionRemovesPageFromTrash() {
        let repository = RecordingPageRepository(pages: [
            Page(id: "target", title: "Target", createdAt: "2026-05-21T10:00:00.000Z", updatedAt: "2026-05-21T10:00:00.000Z")
        ])
        let store = OpenNotionStore(repository: repository)
        store.load()
        store.requestDeletePage(pageID: "target")
        _ = store.confirmPendingPageDeletion()
        store.requestPermanentDeletePage(pageID: "target")

        XCTAssertTrue(store.confirmPendingPermanentPageDeletion())

        XCTAssertNil(store.pendingPermanentDeletePageID)
        XCTAssertEqual(repository.permanentlyDeletedPageIDs, ["target"])
        XCTAssertEqual(store.deletedPages, [])
    }

    func testOpeningPageDeepLinkSelectsExistingPage() {
        let repository = RecordingPageRepository(pages: [
            Page(id: "one", title: "One", createdAt: "2026-05-21T10:00:00.000Z", updatedAt: "2026-05-21T10:00:00.000Z"),
            Page(id: "two", title: "Two", createdAt: "2026-05-21T10:01:00.000Z", updatedAt: "2026-05-21T10:01:00.000Z")
        ])
        let store = OpenNotionStore(repository: repository)
        store.load()

        XCTAssertTrue(store.openPageLink(URL(string: "opennotion://page/two")!))

        XCTAssertEqual(store.selectedPageID, "two")
    }

    func testEditorTextViewLayoutHandlerReceivesCurrentTextView() {
        let textView = EditorNSTextView(frame: .zero)
        var receivedTextView: EditorNSTextView?

        textView.setLayoutHandler { textView in
            receivedTextView = textView
        }
        textView.layout()

        XCTAssertTrue(receivedTextView === textView)
    }

    func testEditorTextViewSpaceTriggersMarkdownShortcutCommand() {
        let textView = EditorNSTextView(frame: .zero)
        var commands: [BlockTextCommand] = []
        textView.string = "#"
        textView.setSelectedRange(NSRange(location: 1, length: 0))
        textView.commandHandler = { command in
            commands.append(command)
            return true
        }

        textView.insertText(" ", replacementRange: NSRange(location: NSNotFound, length: 0))

        XCTAssertEqual(commands, [.applyMarkdownShortcut])
        XCTAssertEqual(textView.string, "#")
    }

    func testEditorTextViewCommandZTriggersStructuralUndoCommand() throws {
        let textView = EditorNSTextView(frame: .zero)
        var commands: [BlockTextCommand] = []
        textView.commandHandler = { command in
            commands.append(command)
            return true
        }
        let event = try XCTUnwrap(NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: .command,
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            characters: "z",
            charactersIgnoringModifiers: "z",
            isARepeat: false,
            keyCode: 6
        ))

        XCTAssertTrue(textView.performKeyEquivalent(with: event))
        XCTAssertEqual(commands, [.undoStructuralEdit])
    }

    func testEditorTextViewCommandShiftZDoesNotTriggerStructuralUndoCommand() throws {
        let textView = EditorNSTextView(frame: .zero)
        var commands: [BlockTextCommand] = []
        textView.commandHandler = { command in
            commands.append(command)
            return true
        }
        let event = try XCTUnwrap(NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: [.command, .shift],
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            characters: "Z",
            charactersIgnoringModifiers: "z",
            isARepeat: false,
            keyCode: 6
        ))

        XCTAssertFalse(textView.performKeyEquivalent(with: event))
        XCTAssertEqual(commands, [])
    }

    func testEditorTextViewCommandZKeepsTextUndoPriority() throws {
        let textView = EditorNSTextView(frame: .zero)
        textView.allowsUndo = true
        textView.string = ""
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 200, height: 120), styleMask: [], backing: .buffered, defer: false)
        window.contentView = textView
        window.makeFirstResponder(textView)
        var commands: [BlockTextCommand] = []
        textView.commandHandler = { command in
            commands.append(command)
            return true
        }
        textView.insertText("x", replacementRange: NSRange(location: NSNotFound, length: 0))
        XCTAssertEqual(textView.string, "x")
        XCTAssertEqual(textView.undoManager?.canUndo, true)
        let event = try XCTUnwrap(NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: .command,
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            characters: "z",
            charactersIgnoringModifiers: "z",
            isARepeat: false,
            keyCode: 6
        ))

        XCTAssertFalse(textView.performKeyEquivalent(with: event))
        XCTAssertEqual(commands, [])
    }

    func testEditorTextViewClampsSelectionOffset() {
        let textView = EditorNSTextView(frame: .zero)
        textView.string = "Hello"

        textView.setSelectedUTF16Offset(99)

        XCTAssertEqual(textView.selectedRange(), NSRange(location: 5, length: 0))
    }

    func testTitleSubmitFocusesFirstEditableBodyBlock() {
        let document = BlockDocument(blocks: [
            Block(id: "divider", kind: .divider, text: "", rawJSON: nil),
            Block(id: "body", kind: .paragraph, text: "", rawJSON: nil)
        ])

        XCTAssertEqual(PageEditorFocus.firstEditableBlockID(in: document), "body")
    }

    func testBlockEditorUndoStackRestoresDocumentFocusAndSelection() {
        var document = BlockDocument(blocks: [
            Block(id: "a", kind: .paragraph, text: "Hello", rawJSON: nil),
            Block(id: "b", kind: .paragraph, text: "World", rawJSON: nil)
        ])
        var focusedBlockID: String? = "b"
        var selectionOffsets = ["b": 0]
        var undoStack = BlockEditorUndoStack()

        undoStack.record(document: document, focusedBlockID: focusedBlockID, selectionOffsets: selectionOffsets)
        document = BlockDocument(blocks: [
            Block(id: "a", kind: .paragraph, text: "HelloWorld", rawJSON: nil)
        ])
        focusedBlockID = "a"
        selectionOffsets = ["a": 5]

        XCTAssertTrue(undoStack.restorePrevious(document: &document, focusedBlockID: &focusedBlockID, selectionOffsets: &selectionOffsets))
        XCTAssertEqual(document.blocks.map(\.id), ["a", "b"])
        XCTAssertEqual(document.blocks.map(\.text), ["Hello", "World"])
        XCTAssertEqual(focusedBlockID, "b")
        XCTAssertEqual(selectionOffsets, ["b": 0])
    }
}

private struct MovedPage: Equatable {
    let id: String
    let parentID: String?
}

private final class RecordingPageRepository: PageRepository, @unchecked Sendable {
    var pages: [Page]
    private(set) var updatedPageIDs: [String] = []
    private(set) var deletedPageIDs: [String] = []
    private(set) var restoredPageIDs: [String] = []
    private(set) var permanentlyDeletedPageIDs: [String] = []
    private(set) var fetchedPageIDs: [String] = []
    private(set) var duplicatedPageIDs: [String] = []
    private(set) var movedPages: [MovedPage] = []

    init(pages: [Page]) {
        self.pages = pages
    }

    var safetyStatus: DatabaseSafetyStatus { .unavailable }

    func bootstrap() throws {}

    func listPages() throws -> [Page] {
        pages.filter { $0.isDeleted == 0 }.map(\.withoutContent)
    }

    func listDeletedPages() throws -> [Page] {
        pages.filter { $0.isDeleted == 1 }
    }

    func searchPages(query: String) throws -> [Page] {
        []
    }

    func page(id: String) throws -> Page? {
        fetchedPageIDs.append(id)
        return pages.first { $0.id == id }
    }

    func createPage(id: String, title: String, parentID: String?, createdAt: String) throws -> Page {
        let page = Page(id: id, title: title, parentID: parentID, createdAt: createdAt, updatedAt: createdAt)
        pages.insert(page, at: 0)
        return page
    }

    func duplicatePage(sourceID: String, id: String, createdAt: String) throws -> Page {
        duplicatedPageIDs.append(sourceID)
        guard let source = pages.first(where: { $0.id == sourceID }) else {
            throw PageRepositoryError.pageNotFound
        }
        let page = Page(
            id: "copy-\(source.id)",
            title: "Copy of \(source.title)",
            parentID: source.parentID,
            content: source.content,
            searchText: source.searchText,
            icon: source.icon,
            coverURL: source.coverURL,
            isDatabase: source.isDatabase,
            databaseSchema: source.databaseSchema,
            properties: source.properties,
            createdAt: createdAt,
            updatedAt: createdAt
        )
        pages.insert(page, at: 0)
        return page
    }

    func movePage(id: String, parentID: String?, updatedAt: String) throws {
        movedPages.append(MovedPage(id: id, parentID: parentID))
        guard let index = pages.firstIndex(where: { $0.id == id }) else {
            return
        }
        pages[index].parentID = parentID
        pages[index].updatedAt = updatedAt
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
        if let isDeleted = updates.isDeleted {
            pages[index].isDeleted = isDeleted
        }
        pages[index].updatedAt = updatedAt
    }

    func deletePage(id: String) throws {
        deletedPageIDs.append(id)
        guard let index = pages.firstIndex(where: { $0.id == id }) else {
            return
        }
        pages[index].isDeleted = 1
    }

    func restorePage(id: String) throws {
        restoredPageIDs.append(id)
        guard let index = pages.firstIndex(where: { $0.id == id }) else {
            return
        }
        pages[index].isDeleted = 0
    }

    func permanentlyDeletePage(id: String) throws {
        permanentlyDeletedPageIDs.append(id)
        pages.removeAll { $0.id == id }
    }
}

private extension Page {
    var withoutContent: Page {
        var page = self
        page.content = nil
        return page
    }
}
