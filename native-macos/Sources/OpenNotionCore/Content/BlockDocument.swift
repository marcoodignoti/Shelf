import Foundation

public struct BlockDocument: Equatable, Sendable {
    public var blocks: [Block]

    public init(blocks: [Block]) {
        self.blocks = blocks
    }

    public static var empty: BlockDocument {
        BlockDocument(blocks: [Block(id: UUID().uuidString, kind: .paragraph, text: "", rawJSON: nil)])
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
}
