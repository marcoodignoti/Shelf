import Foundation

public struct BlockDocument: Equatable, Sendable {
    public var blocks: [Block]

    public init(blocks: [Block]) {
        self.blocks = blocks
    }

    public static var empty: BlockDocument {
        BlockDocument(blocks: [Block(id: UUID().uuidString, kind: .paragraph, text: "", rawJSON: nil)])
    }

    public mutating func updateText(id: String, text: String) {
        guard let index = blocks.firstIndex(where: { $0.id == id }),
              blocks[index].kind.acceptsText else {
            return
        }

        blocks[index].text = text
    }

    public mutating func replaceKind(id: String, with kind: BlockKind) {
        guard let index = blocks.firstIndex(where: { $0.id == id }) else {
            return
        }

        blocks[index].kind = kind.normalized
        blocks[index].rawJSON = nil
        if case .divider = kind {
            blocks[index].text = ""
        }
    }

    public mutating func toggleCheck(id: String) {
        guard let index = blocks.firstIndex(where: { $0.id == id }),
              case let .checkListItem(checked) = blocks[index].kind else {
            return
        }

        blocks[index].kind = .checkListItem(checked: !checked)
        blocks[index].rawJSON = nil
    }

    @discardableResult
    public mutating func splitBlock(id: String, at utf16Offset: Int, newID: String = UUID().uuidString) -> String? {
        guard let index = blocks.firstIndex(where: { $0.id == id }) else {
            return nil
        }

        let block = blocks[index]
        if block.kind.exitsToParagraphWhenEmpty,
           block.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            blocks[index].kind = .paragraph
            blocks[index].text = ""
            blocks[index].rawJSON = nil
            return block.id
        }

        if case .unknown = block.kind {
            return nil
        }

        if case .divider = block.kind {
            blocks.insert(Block(id: newID, kind: .paragraph, text: "", rawJSON: nil), at: index + 1)
            return newID
        }

        let split = block.text.splitAtUTF16Offset(utf16Offset)
        blocks[index].text = split.before
        blocks[index].rawJSON = nil
        blocks.insert(
            Block(id: newID, kind: block.kind.kindAfterSplit, text: split.after, rawJSON: nil),
            at: index + 1
        )
        return newID
    }

    @discardableResult
    public mutating func deleteBlock(id: String) -> String? {
        guard blocks.count > 1,
              let index = blocks.firstIndex(where: { $0.id == id }) else {
            return id
        }

        blocks.remove(at: index)
        let focusIndex = max(0, index - 1)
        return blocks[safe: focusIndex]?.id
    }

    public func previousBlockID(before id: String) -> String? {
        guard let index = blocks.firstIndex(where: { $0.id == id }), index > 0 else {
            return nil
        }
        return blocks[index - 1].id
    }

    public func nextBlockID(after id: String) -> String? {
        guard let index = blocks.firstIndex(where: { $0.id == id }), index + 1 < blocks.count else {
            return nil
        }
        return blocks[index + 1].id
    }

    public mutating func moveBlock(id: String, before targetID: String) {
        guard id != targetID,
              let sourceIndex = blocks.firstIndex(where: { $0.id == id }),
              let targetIndex = blocks.firstIndex(where: { $0.id == targetID }) else {
            return
        }

        let block = blocks.remove(at: sourceIndex)
        let adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
        blocks.insert(block, at: adjustedTargetIndex)
    }

    public mutating func moveBlockToEnd(id: String) {
        guard let sourceIndex = blocks.firstIndex(where: { $0.id == id }),
              sourceIndex != blocks.indices.last else {
            return
        }

        let block = blocks.remove(at: sourceIndex)
        blocks.append(block)
    }
}

public struct Block: Identifiable, Equatable, Sendable {
    public var id: String
    public var kind: BlockKind
    public var text: String
    public var rawJSON: String?

    public init(id: String, kind: BlockKind, text: String, rawJSON: String?) {
        self.id = id
        self.kind = kind
        self.text = text
        self.rawJSON = rawJSON
    }
}

public enum BlockKind: Equatable, Sendable {
    case paragraph
    case heading(level: Int)
    case bulletListItem
    case numberedListItem
    case checkListItem(checked: Bool)
    case code
    case divider
    case unknown(type: String)

    public var acceptsText: Bool {
        switch self {
        case .paragraph, .heading, .bulletListItem, .numberedListItem, .checkListItem, .code:
            return true
        case .divider, .unknown:
            return false
        }
    }

    public var isUnsupported: Bool {
        if case .unknown = self {
            return true
        }
        return false
    }

    fileprivate var normalized: BlockKind {
        switch self {
        case let .heading(level):
            return .heading(level: min(max(level, 1), 4))
        default:
            return self
        }
    }

    fileprivate var exitsToParagraphWhenEmpty: Bool {
        switch self {
        case .bulletListItem, .numberedListItem, .checkListItem:
            return true
        default:
            return false
        }
    }

    fileprivate var kindAfterSplit: BlockKind {
        switch self {
        case .heading:
            return .paragraph
        case .checkListItem:
            return .checkListItem(checked: false)
        case .bulletListItem, .numberedListItem, .code, .paragraph:
            return self
        case .divider, .unknown:
            return .paragraph
        }
    }
}

private extension String {
    func splitAtUTF16Offset(_ offset: Int) -> (before: String, after: String) {
        let clampedOffset = min(max(offset, 0), utf16.count)
        let nsString = self as NSString
        return (
            before: nsString.substring(to: clampedOffset),
            after: nsString.substring(from: clampedOffset)
        )
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
