import Foundation

public enum BlockNoteCodec {
    public enum Error: Swift.Error, Equatable {
        case invalidJSON
    }

    public static func decode(_ content: String?) throws -> BlockDocument {
        guard let content, !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return .empty
        }

        guard let data = content.data(using: .utf8) else {
            throw Error.invalidJSON
        }

        do {
            let object = try JSONSerialization.jsonObject(with: data)

            if let blocks = object as? [[String: Any]], !blocks.isEmpty {
                return BlockDocument(blocks: blocks.map(decodeBlock))
            }

            if let plainText = object as? String {
                return document(fromPlainText: plainText)
            }

            if let wrapper = object as? [String: Any], let plainText = wrapper["plainText"] as? String {
                return document(fromPlainText: plainText)
            }
        } catch {
            return document(fromPlainText: content)
        }

        return .empty
    }

    public static func encode(_ document: BlockDocument) throws -> String {
        let objects = document.blocks.map(encodeBlock)
        let data = try JSONSerialization.data(withJSONObject: objects, options: [.sortedKeys])
        guard let string = String(data: data, encoding: .utf8) else {
            throw Error.invalidJSON
        }
        return string
    }

    public static func document(fromPlainText text: String) -> BlockDocument {
        let lines = text.components(separatedBy: .newlines)
        let blocks = lines.map { line in
            Block(id: UUID().uuidString, kind: .paragraph, text: line, rawJSON: nil)
        }
        return BlockDocument(blocks: blocks.isEmpty ? BlockDocument.empty.blocks : blocks)
    }

    public static func plainText(from content: String?) -> String {
        let document = (try? decode(content)) ?? .empty
        return document.blocks
            .map(\.text)
            .joined(separator: "\n")
    }

    public static func searchText(for document: BlockDocument) -> String {
        document.blocks
            .filter { block in
                if case .unknown = block.kind {
                    return false
            }
            return !block.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
            .map(\.text)
            .joined(separator: " ")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func hasUnsupportedBlocks(_ content: String?) -> Bool {
        guard let document = try? decode(content) else {
            return false
        }

        return document.blocks.contains { block in
            if case .unknown = block.kind {
                return true
            }
            return false
        }
    }

    private static func decodeBlock(_ object: [String: Any]) -> Block {
        let id = object["id"] as? String ?? UUID().uuidString
        let type = object["type"] as? String ?? "paragraph"
        let props = object["props"] as? [String: Any] ?? [:]
        let text = inlineText(from: object["content"])
        let kind = blockKind(type: type, props: props)
        let rawJSON = rawJSONString(from: object)

        return Block(id: id, kind: kind, text: text, rawJSON: rawJSON)
    }

    private static func blockKind(type: String, props: [String: Any]) -> BlockKind {
        switch type {
        case "paragraph":
            return .paragraph
        case "heading":
            return .heading(level: props["level"] as? Int ?? 1)
        case "bulletListItem", "bulletList":
            return .bulletListItem
        case "numberedListItem", "numberedList":
            return .numberedListItem
        case "checkListItem":
            return .checkListItem(checked: props["checked"] as? Bool ?? false)
        case "codeBlock", "code":
            return .code
        case "divider":
            return .divider
        default:
            return .unknown(type: type)
        }
    }

    private static func encodeBlock(_ block: Block) -> [String: Any] {
        if let rawJSON = block.rawJSON,
           let data = rawJSON.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return object
        }

        var object: [String: Any] = [
            "id": block.id,
            "content": inlineContent(from: block.text)
        ]

        switch block.kind {
        case .paragraph:
            object["type"] = "paragraph"
        case let .heading(level):
            object["type"] = "heading"
            object["props"] = ["level": level]
        case .bulletListItem:
            object["type"] = "bulletListItem"
        case .numberedListItem:
            object["type"] = "numberedListItem"
        case let .checkListItem(checked):
            object["type"] = "checkListItem"
            object["props"] = ["checked": checked]
        case .code:
            object["type"] = "codeBlock"
        case .divider:
            object["type"] = "divider"
            object["content"] = []
        case let .unknown(type):
            object["type"] = type
        }

        return object
    }

    private static func inlineText(from value: Any?) -> String {
        if let string = value as? String {
            return string
        }

        guard let items = value as? [Any] else {
            return ""
        }

        return items.compactMap { item in
            if let string = item as? String {
                return string
            }
            if let object = item as? [String: Any] {
                return object["text"] as? String
            }
            return nil
        }.joined()
    }

    private static func inlineContent(from text: String) -> [[String: Any]] {
        guard !text.isEmpty else {
            return []
        }

        return [[
            "type": "text",
            "text": text,
            "styles": [:]
        ]]
    }

    private static func rawJSONString(from object: [String: Any]) -> String? {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }
}
