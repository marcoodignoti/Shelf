import AppKit
import OpenNotionCore
import SwiftUI
import UniformTypeIdentifiers

struct PageEditorView: View {
    let page: Page
    let onSave: (String, BlockDocument) -> Void

    @State private var title: String
    @State private var document: BlockDocument
    @State private var focusedBlockID: String?

    private let startsAsUntitledEmptyPage: Bool

    private var hasUnsupportedBlocks: Bool {
        document.blocks.contains { $0.kind.isUnsupported }
    }

    init(page: Page, onSave: @escaping (String, BlockDocument) -> Void) {
        let decodedDocument = (try? BlockNoteCodec.decode(page.content)) ?? .empty
        let isUntitledEmptyPage = page.title == "Untitled"
            && decodedDocument.blocks.allSatisfy { $0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        self.page = page
        self.onSave = onSave
        self.startsAsUntitledEmptyPage = isUntitledEmptyPage
        _title = State(initialValue: isUntitledEmptyPage ? "" : page.title)
        _document = State(initialValue: decodedDocument)
        _focusedBlockID = State(initialValue: decodedDocument.blocks.first?.id)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                PageActionStrip()

                ZStack(alignment: .leading) {
                    if title.isEmpty {
                        Text(startsAsUntitledEmptyPage ? "New page" : "Untitled")
                            .font(.system(size: 44, weight: .bold, design: .default))
                            .foregroundStyle(Color.primary.opacity(0.12))
                            .allowsHitTesting(false)
                    }

                    TextField("", text: $title)
                        .textFieldStyle(.plain)
                        .font(.system(size: 44, weight: .bold, design: .default))
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

            BlockEditorView(document: $document, focusedBlockID: $focusedBlockID)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    onSave(persistedTitle, document)
                } label: {
                    Label("Save", systemImage: "square.and.arrow.down")
                }
                .keyboardShortcut("s")

                Button {} label: {
                    Label("Copy Link", systemImage: "link")
                }
                .help("Copy link")

                Button {} label: {
                    Label("Favorite", systemImage: "star")
                }
                .help("Favorite")

                Button {} label: {
                    Label("More", systemImage: "ellipsis")
                }
                .help("More")
            }
        }
    }

    private var persistedTitle: String {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedTitle.isEmpty ? "Untitled" : trimmedTitle
    }
}

private struct PageActionStrip: View {
    var body: some View {
        HStack(spacing: 16) {
            PageActionButton(title: "Add icon", systemImage: "face.smiling")
            PageActionButton(title: "Add cover", systemImage: "photo")
            PageActionButton(title: "Add comment", systemImage: "text.bubble")
        }
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(.secondary.opacity(0.8))
    }
}

private struct PageActionButton: View {
    let title: String
    let systemImage: String

    var body: some View {
        Button {} label: {
            Label(title, systemImage: systemImage)
                .labelStyle(.titleAndIcon)
        }
        .buttonStyle(.plain)
        .help(title)
    }
}

private struct BlockEditorView: View {
    @Binding var document: BlockDocument
    @Binding var focusedBlockID: String?
    @State private var draggingBlockID: String?
    @State private var activeDropLocation: BlockDropLocation?

    var body: some View {
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
                        )
                    }
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
            .padding(.bottom, 48)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(Color(nsColor: .textBackgroundColor))
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
    @State private var isHovering = false
    @State private var selectedSlashIndex = 0
    @State private var dismissedSlashText: String?

    private var isFocused: Bool {
        focusedBlockID == block.id
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            selectionButton
                .frame(width: 20, height: rowHeight, alignment: .top)

            prefixView
                .frame(width: 26, height: rowHeight, alignment: .topTrailing)

            VStack(alignment: .leading, spacing: 4) {
                content

                if shouldShowSlashMenu {
                    SlashCommandMenu(
                        styles: slashStyles,
                        selectedStyleID: selectedSlashStyle?.id,
                        onHover: selectSlashStyle
                    ) { style in
                        applySlashCommand(style)
                    }
                    .padding(.top, 2)
                }
            }
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
        .onChange(of: block.text) { _, _ in
            dismissedSlashText = nil
            selectedSlashIndex = 0
        }
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
            .frame(height: rowHeight)
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
            let lineCount = max(1, block.text.components(separatedBy: .newlines).count)
            return max(30, CGFloat(lineCount) * (textFont.pointSize + 8) + 8)
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
            return true
        case .moveToNextMenuItem:
            guard shouldShowSlashMenu,
                  !slashStyles.isEmpty else {
                return false
            }
            selectedSlashIndex = min(slashStyles.count - 1, selectedSlashIndex + 1)
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

private struct SlashCommandMenu: View {
    let styles: [EditorBlockStyle]
    let selectedStyleID: EditorBlockStyle.ID?
    let onHover: (EditorBlockStyle) -> Void
    let onSelect: (EditorBlockStyle) -> Void

    private var selectedIndex: Int? {
        guard let selectedStyleID else {
            return nil
        }
        return styles.firstIndex { $0.id == selectedStyleID }
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Basic blocks")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
                    .padding(.bottom, 8)

                if styles.isEmpty {
                    Text("No commands")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                } else {
                    ForEach(styles) { style in
                        SlashCommandRow(
                            style: style,
                            isSelected: style.id == selectedStyleID,
                            onHover: onHover,
                            onSelect: onSelect
                        )
                    }
                }

                Divider()
                    .padding(.top, 6)

                HStack {
                    Text("Close menu")
                    Spacer()
                    Text("esc")
                        .foregroundStyle(.secondary)
                }
                .font(.system(size: 15))
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
            .frame(width: 326)
            .background(Color(nsColor: .windowBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay {
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.75), lineWidth: 1)
            }
            .shadow(color: .black.opacity(0.12), radius: 18, y: 8)

            if let selectedIndex,
               styles.indices.contains(selectedIndex) {
                SlashCommandPreview(style: styles[selectedIndex])
                    .offset(x: 334, y: 40 + CGFloat(selectedIndex) * 43)
            }
        }
    }
}

private struct SlashCommandRow: View {
    let style: EditorBlockStyle
    let isSelected: Bool
    let onHover: (EditorBlockStyle) -> Void
    let onSelect: (EditorBlockStyle) -> Void

    var body: some View {
        Button {
            onSelect(style)
        } label: {
            HStack(spacing: 14) {
                Text(style.menuSymbol)
                    .font(.system(size: 18, weight: .medium, design: style == .code ? .monospaced : .default))
                    .foregroundStyle(.primary.opacity(0.85))
                    .frame(width: 28, alignment: .center)
                Text(style.title)
                    .font(.system(size: 15))
                    .foregroundStyle(.primary)
                Spacer(minLength: 0)
                Text(style.shortcutHint)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary.opacity(0.75))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background {
                RoundedRectangle(cornerRadius: 7)
                    .fill(isSelected ? Color.primary.opacity(0.065) : Color.clear)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 7)
                    .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 1.5)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 8)
        .onHover { hovering in
            if hovering {
                onHover(style)
            }
        }
    }
}

private struct SlashCommandPreview: View {
    let style: EditorBlockStyle

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 8) {
                Text(previewTitle)
                    .font(previewTitleFont)
                    .fontWeight(.bold)
                    .foregroundStyle(.primary)

                if style.isListPreview {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("•  Ownership")
                        Text("•  Altruism")
                    }
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                } else if style == .code {
                    Text("let value = true")
                        .font(.system(size: 12, design: .monospaced))
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.primary.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                } else if style == .divider {
                    Rectangle()
                        .fill(Color.primary.opacity(0.18))
                        .frame(height: 1)
                        .padding(.vertical, 12)
                } else {
                    Text("Clean writing block")
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(14)
            .frame(width: 154, alignment: .topLeading)
            .frame(minHeight: 112, alignment: .topLeading)
            .background(Color(nsColor: .windowBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 6))

            Text(style.previewCaption)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(2)
        }
        .padding(10)
        .background(Color.black.opacity(0.82))
        .clipShape(RoundedRectangle(cornerRadius: 7))
        .shadow(color: .black.opacity(0.18), radius: 16, y: 8)
    }

    private var previewTitle: String {
        switch style {
        case .paragraph:
            return "Text"
        case .heading1:
            return "Main title"
        case .heading2, .heading3, .heading4:
            return "Our Values"
        case .bullet, .numbered, .checklist:
            return "Tasks"
        case .code:
            return "Code"
        case .divider:
            return "Divider"
        }
    }

    private var previewTitleFont: Font {
        switch style {
        case .heading1:
            return .system(size: 22)
        case .heading2:
            return .system(size: 19)
        case .heading3:
            return .system(size: 16)
        case .heading4:
            return .system(size: 14)
        default:
            return .system(size: 15)
        }
    }
}

private enum EditorBlockPrefix {
    case none
    case bullet
    case number(Int)
    case checklist(Bool)
}

private enum EditorBlockStyle: String, CaseIterable, Identifiable {
    case paragraph
    case heading1
    case heading2
    case heading3
    case heading4
    case bullet
    case numbered
    case checklist
    case code
    case divider

    var id: String { rawValue }

    static func filtered(by query: String) -> [EditorBlockStyle] {
        guard !query.isEmpty else {
            return allCases
        }
        return allCases.filter { $0.matches(query) }
    }

    var title: String {
        switch self {
        case .paragraph:
            return "Text"
        case .heading1:
            return "Heading 1"
        case .heading2:
            return "Heading 2"
        case .heading3:
            return "Heading 3"
        case .heading4:
            return "Heading 4"
        case .bullet:
            return "Bullet list"
        case .numbered:
            return "Numbered list"
        case .checklist:
            return "Checklist"
        case .code:
            return "Code"
        case .divider:
            return "Divider"
        }
    }

    var shortcutHint: String {
        switch self {
        case .paragraph:
            return ""
        case .heading1:
            return "#"
        case .heading2:
            return "##"
        case .heading3:
            return "###"
        case .heading4:
            return "####"
        case .bullet:
            return "-"
        case .numbered:
            return "1."
        case .checklist:
            return "[]"
        case .code:
            return "```"
        case .divider:
            return "---"
        }
    }

    var menuSymbol: String {
        switch self {
        case .paragraph:
            return "T"
        case .heading1:
            return "H1"
        case .heading2:
            return "H2"
        case .heading3:
            return "H3"
        case .heading4:
            return "H4"
        case .bullet:
            return "•"
        case .numbered:
            return "1."
        case .checklist:
            return "✓"
        case .code:
            return "</>"
        case .divider:
            return "-"
        }
    }

    func matches(_ query: String) -> Bool {
        let needle = query.lowercased()
        return title.lowercased().contains(needle)
            || rawValue.lowercased().contains(needle)
            || shortcutHint.lowercased().contains(needle)
            || menuSymbol.lowercased().contains(needle)
    }

    var systemImage: String {
        switch self {
        case .paragraph:
            return "text.alignleft"
        case .heading1:
            return "h.square"
        case .heading2, .heading3, .heading4:
            return "h.square.fill"
        case .bullet:
            return "list.bullet"
        case .numbered:
            return "list.number"
        case .checklist:
            return "checklist"
        case .code:
            return "chevron.left.forwardslash.chevron.right"
        case .divider:
            return "minus"
        }
    }

    var kind: BlockKind {
        switch self {
        case .paragraph:
            return .paragraph
        case .heading1:
            return .heading(level: 1)
        case .heading2:
            return .heading(level: 2)
        case .heading3:
            return .heading(level: 3)
        case .heading4:
            return .heading(level: 4)
        case .bullet:
            return .bulletListItem
        case .numbered:
            return .numberedListItem
        case .checklist:
            return .checkListItem(checked: false)
        case .code:
            return .code
        case .divider:
            return .divider
        }
    }

    var previewCaption: String {
        switch self {
        case .paragraph:
            return "Plain text block"
        case .heading1:
            return "Large section heading"
        case .heading2:
            return "Medium section heading"
        case .heading3:
            return "Small section heading"
        case .heading4:
            return "Compact section heading"
        case .bullet:
            return "Bulleted list"
        case .numbered:
            return "Numbered list"
        case .checklist:
            return "To-do list"
        case .code:
            return "Code block"
        case .divider:
            return "Visual divider"
        }
    }

    var isListPreview: Bool {
        switch self {
        case .bullet, .numbered, .checklist:
            return true
        default:
            return false
        }
    }
}
