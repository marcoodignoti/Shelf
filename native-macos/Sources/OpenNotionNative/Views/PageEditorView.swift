import AppKit
import OpenNotionCore
import SwiftUI

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

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 4) {
                ForEach(document.blocks) { block in
                    BlockRowView(
                        block: binding(for: block.id),
                        document: $document,
                        focusedBlockID: $focusedBlockID,
                        prefix: prefix(for: block)
                    )
                }

                Color.clear
                    .frame(height: 20)
                    .dropDestination(for: String.self) { items, _ in
                        guard let draggedID = items.first else {
                            return false
                        }
                        document.moveBlockToEnd(id: draggedID)
                        focusedBlockID = draggedID
                        return true
                    }
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

private struct BlockRowView: View {
    @Binding var block: Block
    @Binding var document: BlockDocument
    @Binding var focusedBlockID: String?
    let prefix: EditorBlockPrefix
    @State private var isHovering = false

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
                    SlashCommandMenu(query: slashQuery) { style in
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
        .dropDestination(for: String.self) { items, _ in
            guard let draggedID = items.first else {
                return false
            }
            document.moveBlock(id: draggedID, before: block.id)
            focusedBlockID = draggedID
            return true
        }
        .onTapGesture {
            focusedBlockID = block.id
        }
        .onHover { isHovering = $0 }
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
        .draggable(block.id)
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
        return trimmed.hasPrefix("/") && trimmed.count <= 24
    }

    private var slashQuery: String {
        let trimmed = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("/") else {
            return ""
        }
        return String(trimmed.dropFirst()).lowercased()
    }

    private func applySlashCommand(_ style: EditorBlockStyle) {
        document.replaceKind(id: block.id, with: style.kind)
        if block.kind.acceptsText {
            document.updateText(id: block.id, text: "")
        }
        focusedBlockID = block.id
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
            return .systemFont(ofSize: level == 1 ? 28 : 22, weight: .bold)
        case .code:
            return .monospacedSystemFont(ofSize: 14, weight: .regular)
        default:
            return .systemFont(ofSize: 16, weight: .regular)
        }
    }

    private var placeholderText: String {
        switch block.kind {
        case .heading(level: 1):
            return "Heading 1"
        case .heading:
            return "Heading 2"
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
            return .system(size: level == 1 ? 28 : 22, weight: .bold)
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
        case .heading:
            return 36
        case .divider:
            return 32
        default:
            let lineCount = max(1, block.text.components(separatedBy: .newlines).count)
            return max(30, CGFloat(lineCount) * (textFont.pointSize + 8) + 8)
        }
    }

    private func handleCommand(_ command: BlockTextCommand) -> Bool {
        switch command {
        case let .insertNewline(location):
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
        }
    }
}

private struct SlashCommandMenu: View {
    let query: String
    let onSelect: (EditorBlockStyle) -> Void

    private var styles: [EditorBlockStyle] {
        let allStyles = EditorBlockStyle.allCases
        guard !query.isEmpty else {
            return allStyles
        }
        return allStyles.filter { $0.matches(query) }
    }

    var body: some View {
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
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(width: 326)
        .padding(.bottom, 8)
        .background(Color(nsColor: .windowBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color(nsColor: .separatorColor).opacity(0.75), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.12), radius: 18, y: 8)
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
    case bullet
    case numbered
    case checklist
    case code
    case divider

    var id: String { rawValue }

    var title: String {
        switch self {
        case .paragraph:
            return "Text"
        case .heading1:
            return "Heading 1"
        case .heading2:
            return "Heading 2"
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
    }

    var systemImage: String {
        switch self {
        case .paragraph:
            return "text.alignleft"
        case .heading1:
            return "h.square"
        case .heading2:
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
}
