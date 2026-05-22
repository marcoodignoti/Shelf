import AppKit
import OpenNotionCore
import SwiftUI

struct BlockRowView: View {
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

enum EditorBlockPrefix {
    case none
    case bullet
    case number(Int)
    case checklist(Bool)
}
