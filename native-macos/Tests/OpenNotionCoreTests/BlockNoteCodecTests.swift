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
}
