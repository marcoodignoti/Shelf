import AppKit
import OpenNotionCore
import SwiftUI

struct PageEditorView: View {
    let page: Page
    let onSave: (String, BlockDocument) -> Bool
    let onToggleFavorite: () -> Bool
    let onDuplicate: () -> Bool
    let onCreateSubpage: () -> Void
    let onDelete: () -> Void

    @State private var draft: PageEditorDraft
    @State private var focusedBlockID: String?
    @State private var autosaveTask: Task<Void, Never>?
    @State private var saveState = PageEditorSaveState.saved
    @State private var didCopyLink = false
    @FocusState private var isTitleFocused: Bool

    private let startsAsUntitledEmptyPage: Bool

    private var hasUnsupportedBlocks: Bool {
        draft.document.blocks.contains { $0.kind.isUnsupported }
    }

    init(
        page: Page,
        onSave: @escaping (String, BlockDocument) -> Bool,
        onToggleFavorite: @escaping () -> Bool,
        onDuplicate: @escaping () -> Bool,
        onCreateSubpage: @escaping () -> Void,
        onDelete: @escaping () -> Void
    ) {
        let decodedDocument = (try? BlockNoteCodec.decode(page.content)) ?? .empty
        let isUntitledEmptyPage = page.title == "Untitled"
            && decodedDocument.blocks.allSatisfy { $0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let initialTitle = isUntitledEmptyPage ? "" : page.title
        self.page = page
        self.onSave = onSave
        self.onToggleFavorite = onToggleFavorite
        self.onDuplicate = onDuplicate
        self.onCreateSubpage = onCreateSubpage
        self.onDelete = onDelete
        self.startsAsUntitledEmptyPage = isUntitledEmptyPage
        _draft = State(initialValue: PageEditorDraft(
            title: initialTitle,
            document: decodedDocument,
            savedTitle: page.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Untitled" : page.title,
            savedDocument: decodedDocument
        ))
        _focusedBlockID = State(initialValue: isUntitledEmptyPage ? nil : decodedDocument.blocks.first?.id)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                ZStack(alignment: .leading) {
                    if draft.title.isEmpty {
                        Text(startsAsUntitledEmptyPage ? "New page" : "Untitled")
                            .font(.system(size: 44, weight: .bold, design: .default))
                            .foregroundStyle(Color.primary.opacity(0.12))
                            .allowsHitTesting(false)
                    }

                    TextField("", text: $draft.title)
                        .textFieldStyle(.plain)
                        .font(.system(size: 44, weight: .bold, design: .default))
                        .focused($isTitleFocused)
                        .onSubmit {
                            focusFirstBodyBlock()
                        }
                        .onTapGesture {
                            focusedBlockID = nil
                        }
                }

                if page.isDatabase == 1 {
                    Label("Database view comes in phase 2. Page content and metadata are safe to edit here.", systemImage: "tablecells")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                if hasUnsupportedBlocks {
                    Label("Unsupported blocks are preserved and locked in place.", systemImage: "lock.doc")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .padding(.horizontal, 48)
            .padding(.top, 128)
            .padding(.bottom, 18)
            .frame(maxWidth: .infinity, alignment: .center)

            BlockEditorView(document: $draft.document, focusedBlockID: $focusedBlockID)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onChange(of: draft.title) { _, _ in
            scheduleAutosave()
        }
        .onChange(of: draft.document) { _, _ in
            scheduleAutosave()
        }
        .onDisappear {
            autosaveTask?.cancel()
            saveNow()
        }
        .onAppear {
            if startsAsUntitledEmptyPage {
                focusedBlockID = nil
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    focusedBlockID = nil
                    isTitleFocused = true
                }
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    saveNow()
                } label: {
                    Label("Save", systemImage: "square.and.arrow.down")
                }
                .keyboardShortcut("s")

                Text(saveState.label)
                    .font(.caption)
                    .foregroundStyle(saveState == .failed ? Color.red : Color.secondary)

                Button {
                    copyPageLink()
                } label: {
                    Label(didCopyLink ? "Copied" : "Copy Link", systemImage: didCopyLink ? "checkmark" : "link")
                }
                .help("Copy link")

                Button {
                    _ = onToggleFavorite()
                } label: {
                    Label(page.isFavorite == 1 ? "Remove Favorite" : "Favorite", systemImage: page.isFavorite == 1 ? "star.fill" : "star")
                }
                .help(page.isFavorite == 1 ? "Remove from favorites" : "Add to favorites")

                Menu {
                    Button("New Subpage") {
                        onCreateSubpage()
                    }

                    Button("Duplicate") {
                        _ = onDuplicate()
                    }

                    Divider()

                    Button("Move to Trash", role: .destructive) {
                        onDelete()
                    }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
                .help("More")
            }
        }
    }

    private func scheduleAutosave() {
        autosaveTask?.cancel()
        guard draft.isDirty else {
            saveState = .saved
            return
        }

        saveState = .unsaved
        autosaveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 700_000_000)
            guard !Task.isCancelled else {
                return
            }
            saveNow()
        }
    }

    private func saveNow() {
        autosaveTask?.cancel()
        guard draft.isDirty else {
            saveState = .saved
            return
        }

        saveState = .saving
        if onSave(draft.persistedTitle, draft.document) {
            draft.markSaved()
            saveState = .saved
        } else {
            saveState = .failed
        }
    }

    private func copyPageLink() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("opennotion://page/\(page.id)", forType: .string)
        didCopyLink = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            didCopyLink = false
        }
    }

    private func focusFirstBodyBlock() {
        isTitleFocused = false
        focusedBlockID = PageEditorFocus.firstEditableBlockID(in: draft.document)
    }
}

private enum PageEditorSaveState {
    case saved
    case unsaved
    case saving
    case failed

    var label: String {
        switch self {
        case .saved:
            return "Saved"
        case .unsaved:
            return "Unsaved"
        case .saving:
            return "Saving..."
        case .failed:
            return "Save failed"
        }
    }
}

private struct BlockEditorView: View {
    @Binding var document: BlockDocument
    @Binding var focusedBlockID: String?
    @State private var draggingBlockID: String?
    @State private var activeDropLocation: BlockDropLocation?
    @State private var selectionOffsets: [String: Int] = [:]
    @State private var undoStack = BlockEditorUndoStack()

    var body: some View {
        ScrollViewReader { scrollProxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(document.blocks) { block in
                        VStack(alignment: .leading, spacing: 0) {
                            BlockDropIndicator(isActive: activeDropLocation == .before(block.id))

                            BlockRowView(
                                block: binding(for: block.id),
                                document: $document,
                                focusedBlockID: $focusedBlockID,
                                draggingBlockID: $draggingBlockID,
                                activeDropLocation: $activeDropLocation,
                                selectionOffsets: $selectionOffsets,
                                undoStack: $undoStack,
                                prefix: prefix(for: block)
                            ) { id, anchor in
                                requestScroll(to: id, anchor: anchor, using: scrollProxy)
                            }
                        }
                        .id(block.id)
                    }

                    BlockDropIndicator(isActive: activeDropLocation == .end)

                    Color.clear
                        .frame(height: 24)
                        .onDrop(
                            of: BlockDragPasteboard.typeIdentifiers,
                            delegate: BlockEndDropDelegate(
                                document: $document,
                                focusedBlockID: $focusedBlockID,
                                draggingBlockID: $draggingBlockID,
                                activeDropLocation: $activeDropLocation
                            )
                        )
                }
                .padding(.horizontal, 40)
                .padding(.bottom, activeSlashBlockID == nil ? 48 : 220)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
            }
            .background(Color(nsColor: .textBackgroundColor))
            .onChange(of: focusedBlockID) { _, id in
                guard let id else {
                    return
                }
                requestScroll(to: id, anchor: .center, using: scrollProxy)
            }
            .onChange(of: activeSlashBlockID) { _, id in
                guard let id else {
                    return
                }
                requestScroll(to: id, anchor: .center, using: scrollProxy)
            }
        }
    }

    private func binding(for id: String) -> Binding<Block> {
        Binding(
            get: {
                document.blocks.first { $0.id == id }
                    ?? Block(id: id, kind: .paragraph, text: "", rawJSON: nil)
            },
            set: { newValue in
                guard let index = document.blocks.firstIndex(where: { $0.id == id }) else {
                    return
                }
                document.blocks[index] = newValue
            }
        )
    }

    private func prefix(for block: Block) -> EditorBlockPrefix {
        switch block.kind {
        case .bulletListItem:
            return .bullet
        case .numberedListItem:
            return .number(numberedOrdinal(for: block.id))
        case let .checkListItem(checked):
            return .checklist(checked)
        default:
            return .none
        }
    }

    private func numberedOrdinal(for id: String) -> Int {
        guard let index = document.blocks.firstIndex(where: { $0.id == id }) else {
            return 1
        }

        var ordinal = 1
        var cursor = index - 1
        while cursor >= 0 {
            guard case .numberedListItem = document.blocks[cursor].kind else {
                break
            }
            ordinal += 1
            cursor -= 1
        }
        return ordinal
    }

    private var activeSlashBlockID: String? {
        guard let focusedBlockID,
              let block = document.blocks.first(where: { $0.id == focusedBlockID }),
              block.kind.acceptsText,
              block.kind != .code else {
            return nil
        }

        let trimmed = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("/"),
              trimmed.count <= 24 else {
            return nil
        }
        return focusedBlockID
    }

    private func requestScroll(to id: String, anchor: UnitPoint, using proxy: ScrollViewProxy) {
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.16)) {
                proxy.scrollTo(id, anchor: anchor)
            }
        }
    }
}
