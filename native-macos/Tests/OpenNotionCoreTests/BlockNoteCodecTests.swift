import XCTest
@testable import OpenNotionCore

final class BlockNoteCodecTests: XCTestCase {
    func testParsesKnownBlocksAndPreservesUnknownBlocks() throws {
        let json = """
        [
          {"id":"p1","type":"paragraph","content":[{"type":"text","text":"Hello","styles":{}}]},
          {"id":"h1","type":"heading","props":{"level":2},"content":[{"type":"text","text":"Plan","styles":{}}]},
          {"id":"x1","type":"image","props":{"url":"asset://cover.png"},"content":[]}
        ]
        """

        let document = try BlockNoteCodec.decode(json)

        XCTAssertEqual(document.blocks.count, 3)
        XCTAssertEqual(document.blocks[0].kind, .paragraph)
        XCTAssertEqual(document.blocks[0].text, "Hello")
        XCTAssertEqual(document.blocks[1].kind, .heading(level: 2))
        XCTAssertEqual(document.blocks[1].text, "Plan")
        XCTAssertEqual(document.blocks[2].kind, .unknown(type: "image"))
        XCTAssertNotNil(document.blocks[2].rawJSON)
        XCTAssertEqual(BlockNoteCodec.searchText(for: document), "Hello Plan")
        XCTAssertTrue(BlockNoteCodec.hasUnsupportedBlocks(json))
    }

    func testEncodesParagraphDocumentAsBlockNoteJSON() throws {
        let document = BlockDocument(blocks: [
            Block(id: "a", kind: .paragraph, text: "One", rawJSON: nil),
            Block(id: "b", kind: .paragraph, text: "Two", rawJSON: nil)
        ])

        let encoded = try BlockNoteCodec.encode(document)
        let decoded = try BlockNoteCodec.decode(encoded)

        XCTAssertEqual(decoded.blocks.map(\.text), ["One", "Two"])
        XCTAssertEqual(decoded.blocks.map(\.kind), [.paragraph, .paragraph])
    }

    func testEncodesSupportedNativeBlockKinds() throws {
        let document = BlockDocument(blocks: [
            Block(id: "h", kind: .heading(level: 1), text: "Title", rawJSON: nil),
            Block(id: "b", kind: .bulletListItem, text: "Bullet", rawJSON: nil),
            Block(id: "n", kind: .numberedListItem, text: "Number", rawJSON: nil),
            Block(id: "c", kind: .checkListItem(checked: true), text: "Done", rawJSON: nil),
            Block(id: "code", kind: .code, text: "let x = 1", rawJSON: nil),
            Block(id: "d", kind: .divider, text: "", rawJSON: nil)
        ])

        let encoded = try BlockNoteCodec.encode(document)
        let decoded = try BlockNoteCodec.decode(encoded)

        XCTAssertEqual(decoded.blocks.map(\.kind), [
            .heading(level: 1),
            .bulletListItem,
            .numberedListItem,
            .checkListItem(checked: true),
            .code,
            .divider
        ])
        XCTAssertFalse(BlockNoteCodec.hasUnsupportedBlocks(encoded))
    }

    func testRoundTripPreservesKnownBlockInlineContentAndTextSpans() throws {
        let json = """
        [
          {
            "id": "styled",
            "type": "paragraph",
            "content": [
              {"type": "text", "text": "Hello", "styles": {"bold": true}},
              {"type": "text", "text": " world", "styles": {"italic": true}}
            ]
          }
        ]
        """

        let document = try BlockNoteCodec.decode(json)
        XCTAssertEqual(document.blocks[0].text, "Hello world")

        let encoded = try BlockNoteCodec.encode(document)
        let blocks = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(encoded.utf8)) as? [[String: Any]])
        let content = try XCTUnwrap(blocks.first?["content"] as? [[String: Any]])
        let firstStyles = try XCTUnwrap(content.first?["styles"] as? [String: Any])
        let secondStyles = try XCTUnwrap(content.dropFirst().first?["styles"] as? [String: Any])

        XCTAssertEqual(content.count, 2)
        XCTAssertEqual(content[0]["text"] as? String, "Hello")
        XCTAssertEqual(content[1]["text"] as? String, " world")
        XCTAssertEqual(firstStyles["bold"] as? Bool, true)
        XCTAssertEqual(secondStyles["italic"] as? Bool, true)
    }

    func testEditingStyledKnownBlockPreservesInlineStyles() throws {
        let json = """
        [
          {
            "id": "styled",
            "type": "paragraph",
            "content": [
              {"type": "text", "text": "Hello", "styles": {"bold": true}},
              {"type": "text", "text": " world", "styles": {"italic": true}}
            ]
          }
        ]
        """

        var document = try BlockNoteCodec.decode(json)
        document.updateText(id: "styled", text: "Hello brave world")

        let encoded = try BlockNoteCodec.encode(document)
        let blocks = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(encoded.utf8)) as? [[String: Any]])
        let content = try XCTUnwrap(blocks.first?["content"] as? [[String: Any]])
        let firstStyles = try XCTUnwrap(content.first?["styles"] as? [String: Any])
        let secondStyles = try XCTUnwrap(content.dropFirst().first?["styles"] as? [String: Any])

        XCTAssertEqual(content.count, 2)
        XCTAssertEqual(content[0]["text"] as? String, "Hello")
        XCTAssertEqual(content[1]["text"] as? String, " brave world")
        XCTAssertEqual(firstStyles["bold"] as? Bool, true)
        XCTAssertEqual(secondStyles["italic"] as? Bool, true)
    }

    func testEditingKnownBlockPreservesRawBlockProps() throws {
        let json = """
        [
          {
            "id": "heading",
            "type": "heading",
            "props": {"level": 2, "textColor": "red"},
            "content": [{"type": "text", "text": "Old", "styles": {"underline": true}}]
          }
        ]
        """

        var document = try BlockNoteCodec.decode(json)
        document.updateText(id: "heading", text: "New")

        let encoded = try BlockNoteCodec.encode(document)
        let blocks = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(encoded.utf8)) as? [[String: Any]])
        let props = try XCTUnwrap(blocks.first?["props"] as? [String: Any])
        let content = try XCTUnwrap(blocks.first?["content"] as? [[String: Any]])
        let styles = try XCTUnwrap(content.first?["styles"] as? [String: Any])

        XCTAssertEqual(props["level"] as? Int, 2)
        XCTAssertEqual(props["textColor"] as? String, "red")
        XCTAssertEqual(content.first?["text"] as? String, "New")
        XCTAssertEqual(styles["underline"] as? Bool, true)
    }
}
