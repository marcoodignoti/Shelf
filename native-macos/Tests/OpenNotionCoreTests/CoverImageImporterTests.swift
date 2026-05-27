import XCTest
@testable import OpenNotionCore

final class CoverImageImporterTests: XCTestCase {
    func testImportCopiesSupportedImageToCoversDirectory() throws {
        let root = temporaryDirectory()
        let source = root.appendingPathComponent("source.png")
        try Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).write(to: source)

        let coverURL = try CoverImageImporter.importCoverImage(
            sourceURL: source,
            pageID: "../page one",
            applicationSupportDirectory: root
        )

        let imported = try XCTUnwrap(URL(string: coverURL))
        XCTAssertTrue(imported.isFileURL)
        XCTAssertTrue(FileManager.default.fileExists(atPath: imported.path))
        XCTAssertEqual(imported.deletingLastPathComponent().lastPathComponent, "covers")
        XCTAssertEqual(imported.lastPathComponent, "page-one.png")
    }

    func testImportRejectsMismatchedImageExtension() throws {
        let root = temporaryDirectory()
        let source = root.appendingPathComponent("source.jpg")
        try Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).write(to: source)

        XCTAssertThrowsError(try CoverImageImporter.importCoverImage(
            sourceURL: source,
            pageID: "page",
            applicationSupportDirectory: root
        )) { error in
            XCTAssertEqual(error.localizedDescription, "Cover image content does not match its extension.")
        }
    }

    private func temporaryDirectory() -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("OpenNotionCoverImageImporterTests-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }
}
