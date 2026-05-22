import AppKit
import OpenNotionCore
import SwiftUI
import UniformTypeIdentifiers

struct PageEditorView: View {
    let page: Page
    let onSave: (String, BlockDocument) -> Bool
    let onToggleFavorite: () -> Bool
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
        onDelete: @escaping () -> Void
    ) {
        let decodedDocument = (try? BlockNoteCodec.decode(page.content)) ?? .empty
        let isUntitledEmptyPage = page.title == "Untitled"
            && decodedDocument.blocks.allSatisfy { $0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let initialTitle = isUntitledEmptyPage ? "" : page.title
        self.page = page
        self.onSave = onSave
        self.onToggleFavorite = onToggleFavorite
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

private enum BlockDropLocation: Equatable {
    case before(String)
    case end
}

private enum BlockDragPasteboard {
    static let type = UTType(exportedAs: "com.opennotion.native.block-id")
    static let typeIdentifiers = [type.identifier]

    static func provider(for blockID: String) -> NSItemProvider {
        let provider = NSItemProvider()
        provider.registerDataRepresentation(forTypeIdentifier: type.identifier, visibility: .ownProcess) { completion in
            completion(blockID.data(using: .utf8), nil)
            return nil
        }
        return provider
    }
}

private struct BlockDropIndicator: View {
    let isActive: Bool

    var body: some View {
        Capsule()
            .fill(isActive ? Color.accentColor : Color.clear)
            .frame(height: 2)
            .padding(.leading, 54)
            .padding(.trailing, 4)
            .padding(.vertical, 2)
            .animation(.easeOut(duration: 0.12), value: isActive)
    }
}

private struct BlockRowDropDelegate: DropDelegate {
    let targetID: String
    @Binding var document: BlockDocument
    @Binding var focusedBlockID: String?
    @Binding var draggingBlockID: String?
    @Binding var activeDropLocation: BlockDropLocation?

    func validateDrop(info: DropInfo) -> Bool {
        guard info.hasItemsConforming(to: BlockDragPasteboard.typeIdentifiers),
              let draggingBlockID else {
            return false
        }
        return draggingBlockID != targetID
    }

    func dropEntered(info: DropInfo) {
        guard let draggingBlockID,
              draggingBlockID != targetID else {
            return
        }
        activeDropLocation = .before(targetID)
    }

    func dropExited(info: DropInfo) {
        if activeDropLocation == .before(targetID) {
            activeDropLocation = nil
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        defer {
            activeDropLocation = nil
            draggingBlockID = nil
        }

        guard let draggedID = draggingBlockID,
              draggedID != targetID else {
            return false
        }

        document.moveBlock(id: draggedID, before: targetID)
        focusedBlockID = draggedID
        return true
    }
}

private struct BlockEndDropDelegate: DropDelegate {
    @Binding var document: BlockDocument
    @Binding var focusedBlockID: String?
    @Binding var draggingBlockID: String?
    @Binding var activeDropLocation: BlockDropLocation?

    func validateDrop(info: DropInfo) -> Bool {
        info.hasItemsConforming(to: BlockDragPasteboard.typeIdentifiers) && draggingBlockID != nil
    }

    func dropEntered(info: DropInfo) {
        if draggingBlockID != nil {
            activeDropLocation = .end
        }
    }

    func dropExited(info: DropInfo) {
        if activeDropLocation == .end {
            activeDropLocation = nil
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        defer {
            activeDropLocation = nil
            draggingBlockID = nil
        }

        guard let draggedID = draggingBlockID else {
            return false
        }

        document.moveBlockToEnd(id: draggedID)
        focusedBlockID = draggedID
        return true
    }
}

private struct BlockRowView: View {
    @Binding var block: Block
    @Binding var document: BlockDocument
    @Binding var focusedBlockID: String?
    @Binding var draggingBlockID: String?
    @Binding var activeDropLocation: BlockDropLocation?
    let prefix: EditorBlockPrefix
    let onRequestScroll: (String, UnitPoint) -> Void
    @State private var isHovering = false
    @State private var selectedSlashIndex = 0
    @State private var dismissedSlashText: String?
    @State private var measuredTextHeight: CGFloat = 30

    private var isFocused: Bool {
        focusedBlockID == block.id
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top, spacing: 8) {
                selectionButton
                    .frame(width: 20, height: rowHeight, alignment: .top)

                prefixView
                    .frame(width: 26, height: rowHeight, alignment: .topTrailing)

                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .background(rowBackground)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .onDrop(
                of: BlockDragPasteboard.typeIdentifiers,
                delegate: BlockRowDropDelegate(
                    targetID: block.id,
                    document: $document,
                    focusedBlockID: $focusedBlockID,
                    draggingBlockID: $draggingBlockID,
                    activeDropLocation: $activeDropLocation
                )
            )
            .onTapGesture {
                focusedBlockID = block.id
            }
            .onHover { isHovering = $0 }

            if shouldShowSlashMenu {
                VStack(alignment: .leading, spacing: 0) {
                    SlashCommandMenu(
                        styles: slashStyles,
                        selectedStyleID: selectedSlashStyle?.id,
                        onHover: selectSlashStyle
                    ) { style in
                        applySlashCommand(style)
                    }

                    Color.clear
                        .frame(height: 18)
                        .id(slashMenuBottomID)
                }
                .padding(.top, 2)
                .padding(.leading, 58)
            }
        }
        .onChange(of: block.text) { _, _ in
            dismissedSlashText = nil
            selectedSlashIndex = 0
        }
        .onChange(of: measuredTextHeight) { oldHeight, newHeight in
            guard isFocused,
                  abs(newHeight - oldHeight) > 1 else {
                return
            }
            onRequestScroll(block.id, .bottom)
        }
        .onChange(of: shouldShowSlashMenu) { _, isShowing in
            guard isShowing else {
                return
            }
            onRequestScroll(slashMenuBottomID, .bottom)
        }
    }

    private var slashMenuBottomID: String {
        "\(block.id)-slash-menu-bottom"
    }

    private var selectionButton: some View {
        Button {
            focusedBlockID = block.id
        } label: {
            Image(systemName: "circle.grid.2x3.fill")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary.opacity(0.75))
                .frame(width: 18, height: 18)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.top, 7)
        .opacity(isFocused || isHovering ? 1 : 0)
        .onDrag {
            draggingBlockID = block.id
            activeDropLocation = nil
            return BlockDragPasteboard.provider(for: block.id)
        }
        .help("Select or drag block")
        .accessibilityLabel("Select block")
    }

    private var rowBackground: some View {
        RoundedRectangle(cornerRadius: 6)
            .fill(isHovering ? Color.primary.opacity(0.035) : Color.clear)
    }

    private var shouldShowSlashMenu: Bool {
        guard isFocused,
              block.kind.acceptsText,
              block.kind != .code else {
            return false
        }

        let trimmed = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.hasPrefix("/") && trimmed.count <= 24 && dismissedSlashText != trimmed
    }

    private var slashQuery: String {
        let trimmed = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("/") else {
            return ""
        }
        return String(trimmed.dropFirst()).lowercased()
    }

    private var slashStyles: [EditorBlockStyle] {
        EditorBlockStyle.filtered(by: slashQuery)
    }

    private var selectedSlashStyle: EditorBlockStyle? {
        guard !slashStyles.isEmpty else {
            return nil
        }
        let clampedIndex = min(max(selectedSlashIndex, 0), slashStyles.count - 1)
        return slashStyles[clampedIndex]
    }

    private func selectSlashStyle(_ style: EditorBlockStyle) {
        guard let index = slashStyles.firstIndex(of: style) else {
            return
        }
        selectedSlashIndex = index
        onRequestScroll(block.id, .center)
    }

    private func applySlashCommand(_ style: EditorBlockStyle) {
        document.replaceKind(id: block.id, with: style.kind)
        if block.kind.acceptsText {
            document.updateText(id: block.id, text: "")
        }
        focusedBlockID = block.id
        dismissedSlashText = nil
        selectedSlashIndex = 0
    }

    @ViewBuilder
    private var prefixView: some View {
        switch prefix {
        case .none:
            Color.clear
        case .bullet:
            Text("•")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(.secondary)
                .padding(.top, 6)
        case let .number(value):
            Text("\(value).")
                .font(.system(size: 14, weight: .medium, design: .monospaced))
                .foregroundStyle(.secondary)
                .padding(.top, 8)
        case let .checklist(checked):
            Button {
                document.toggleCheck(id: block.id)
                focusedBlockID = block.id
            } label: {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .symbolRenderingMode(.hierarchical)
            }
            .buttonStyle(.plain)
            .foregroundStyle(checked ? Color.accentColor : .secondary)
            .padding(.top, 6)
            .help(checked ? "Mark incomplete" : "Mark complete")
        }
    }

    @ViewBuilder
    private var content: some View {
        switch block.kind {
        case .divider:
            Button {
                focusedBlockID = block.id
            } label: {
                Rectangle()
                    .fill(Color(nsColor: .separatorColor))
                    .frame(height: 1)
                    .padding(.vertical, 15)
            }
            .buttonStyle(.plain)
            .frame(height: rowHeight)
        case let .unknown(type):
            HStack(spacing: 8) {
                Image(systemName: "lock.doc")
                Text(type)
                    .font(.callout)
                if !block.text.isEmpty {
                    Text(block.text)
                        .lineLimit(1)
                }
            }
            .foregroundStyle(.secondary)
            .frame(height: rowHeight, alignment: .center)
        default:
            ZStack(alignment: .topLeading) {
                if block.text.isEmpty {
                    Text(placeholderText)
                        .font(placeholderFont)
                        .foregroundStyle(.tertiary)
                        .padding(.top, 4)
                        .allowsHitTesting(false)
                }

                BlockTextView(
                    text: Binding(
                        get: { block.text },
                        set: { document.updateText(id: block.id, text: $0) }
                    ),
                    measuredHeight: $measuredTextHeight,
                    isFocused: isFocused,
                    font: textFont,
                    textColor: .labelColor,
                    isEditable: block.kind.acceptsText,
                    onFocus: {
                        focusedBlockID = block.id
                    },
                    onCommand: handleCommand
                )
            }
            .padding(block.kind == .code ? EdgeInsets(top: 6, leading: 8, bottom: 6, trailing: 8) : EdgeInsets())
            .background(block.kind == .code ? Color(nsColor: .controlBackgroundColor).opacity(0.72) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: block.kind == .code ? 6 : 0))
            .frame(minHeight: rowHeight)
        }
    }

    private var textFont: NSFont {
        switch block.kind {
        case let .heading(level):
            return .systemFont(ofSize: headingFontSize(for: level), weight: .bold)
        case .code:
            return .monospacedSystemFont(ofSize: 14, weight: .regular)
        default:
            return .systemFont(ofSize: 16, weight: .regular)
        }
    }

    private var placeholderText: String {
        switch block.kind {
        case let .heading(level):
            return "Heading \(level)"
        case .bulletListItem, .numberedListItem, .checkListItem:
            return "List item"
        case .code:
            return "Type code"
        default:
            return "Type '/' for commands"
        }
    }

    private var placeholderFont: Font {
        switch block.kind {
        case let .heading(level):
            return .system(size: headingFontSize(for: level), weight: .bold)
        case .code:
            return .system(size: 14, design: .monospaced)
        default:
            return .system(size: 16)
        }
    }

    private var rowHeight: CGFloat {
        switch block.kind {
        case .heading(level: 1):
            return 44
        case .heading(level: 2):
            return 36
        case .heading:
            return 32
        case .divider:
            return 32
        default:
            return max(minimumTextRowHeight, measuredTextHeight + textVerticalChrome)
        }
    }

    private var minimumTextRowHeight: CGFloat {
        switch block.kind {
        case .code:
            return 40
        default:
            return 30
        }
    }

    private var textVerticalChrome: CGFloat {
        switch block.kind {
        case .code:
            return 12
        default:
            return 0
        }
    }

    private func headingFontSize(for level: Int) -> CGFloat {
        switch level {
        case 1:
            return 28
        case 2:
            return 22
        case 3:
            return 19
        default:
            return 17
        }
    }

    private func handleCommand(_ command: BlockTextCommand) -> Bool {
        switch command {
        case let .insertNewline(location):
            if shouldShowSlashMenu {
                guard let selectedSlashStyle else {
                    return true
                }
                applySlashCommand(selectedSlashStyle)
                return true
            }

            if case .code = block.kind {
                return false
            }
            guard let focusID = document.splitBlock(id: block.id, at: location) else {
                return false
            }
            focusedBlockID = focusID
            return true
        case .deleteBackwardAtBeginning:
            guard block.text.isEmpty,
                  let focusID = document.deleteBlock(id: block.id),
                  focusID != block.id else {
                return false
            }
            focusedBlockID = focusID
            return true
        case .moveToPreviousBlock:
            guard let previousID = document.previousBlockID(before: block.id) else {
                return false
            }
            focusedBlockID = previousID
            return true
        case .moveToNextBlock:
            guard let nextID = document.nextBlockID(after: block.id) else {
                return false
            }
            focusedBlockID = nextID
            return true
        case .moveToPreviousMenuItem:
            guard shouldShowSlashMenu,
                  !slashStyles.isEmpty else {
                return false
            }
            selectedSlashIndex = max(0, selectedSlashIndex - 1)
            onRequestScroll(block.id, .center)
            return true
        case .moveToNextMenuItem:
            guard shouldShowSlashMenu,
                  !slashStyles.isEmpty else {
                return false
            }
            selectedSlashIndex = min(slashStyles.count - 1, selectedSlashIndex + 1)
            onRequestScroll(block.id, .center)
            return true
        case .cancelMenu:
            guard shouldShowSlashMenu else {
                return false
            }
            dismissedSlashText = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
            selectedSlashIndex = 0
            return true
        }
    }
}

private enum EditorBlockPrefix {
    case none
    case bullet
    case number(Int)
    case checklist(Bool)
}
