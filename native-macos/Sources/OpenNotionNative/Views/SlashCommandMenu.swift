import OpenNotionCore
import SwiftUI

struct SlashCommandMenu: View {
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
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 8) {
                menuPanel
                previewPanel
                    .padding(.top, previewTopPadding)
            }

            VStack(alignment: .leading, spacing: 8) {
                menuPanel
                previewPanel
            }
        }
    }

    @ViewBuilder
    private var previewPanel: some View {
        if let selectedIndex,
           styles.indices.contains(selectedIndex) {
            SlashCommandPreview(style: styles[selectedIndex])
        }
    }

    private var previewTopPadding: CGFloat {
        CGFloat(
            SlashMenuLayout.previewTopOffset(
                selectedIndex: selectedIndex,
                rowHeight: 43,
                maxVisibleOffset: 172
            )
        )
    }

    private var menuPanel: some View {
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
                ScrollViewReader { scrollProxy in
                    ScrollView(.vertical) {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(styles) { style in
                                SlashCommandRow(
                                    style: style,
                                    isSelected: style.id == selectedStyleID,
                                    onHover: onHover,
                                    onSelect: onSelect
                                )
                                .id(style.id)
                            }
                        }
                    }
                    .frame(maxHeight: 300)
                    .onChange(of: selectedStyleID) { _, id in
                        guard let id else {
                            return
                        }
                        withAnimation(.easeOut(duration: 0.12)) {
                            scrollProxy.scrollTo(id, anchor: .center)
                        }
                    }
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
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .frame(width: 34, alignment: .center)
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

enum EditorBlockStyle: String, CaseIterable, Identifiable {
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
