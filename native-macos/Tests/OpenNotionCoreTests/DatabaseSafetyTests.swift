import XCTest
@testable import OpenNotionCore

final class DatabaseSafetyTests: XCTestCase {
    func testTestingCopyModeWritesToCopyAndLeavesSourceDatabaseUntouched() throws {
        let sourcePath = temporaryDatabasePath("source.sqlite")
        let sourceRepository = try SQLitePageRepository(databasePath: sourcePath)
        try sourceRepository.bootstrap()
        _ = try sourceRepository.createPage(
            id: "source-page",
            title: "Source",
            parentID: nil,
            createdAt: "2026-05-21T10:00:00.000Z"
        )

        let session = try DatabaseSafety.testingCopySession(sourceDatabasePath: sourcePath)
        let copyRepository = try SQLitePageRepository(databasePath: session.activeDatabasePath)
        try copyRepository.bootstrap()
        _ = try copyRepository.createPage(
            id: "copy-page",
            title: "Copy",
            parentID: nil,
            createdAt: "2026-05-21T10:01:00.000Z"
        )

        XCTAssertNotEqual(session.activeDatabasePath, sourcePath)
        XCTAssertTrue(session.isTestingCopy)
        XCTAssertEqual(try sourceRepository.listPages().map(\.id), ["source-page"])
        XCTAssertEqual(try copyRepository.listPages().map(\.id), ["copy-page", "source-page"])
    }

    func testLiveRepositoryCreatesSingleBackupBeforeWritingExistingDatabase() throws {
        let sourcePath = temporaryDatabasePath("live.sqlite")
        let backupDirectory = temporaryDirectoryPath("backups")
        let sourceRepository = try SQLitePageRepository(databasePath: sourcePath)
        try sourceRepository.bootstrap()
        _ = try sourceRepository.createPage(
            id: "seed-page",
            title: "Seed",
            parentID: nil,
            createdAt: "2026-05-21T10:00:00.000Z"
        )

        let liveRepository = try SQLitePageRepository(
            databasePath: sourcePath,
            safetyOptions: DatabaseSafetyOptions(
                backupBeforeWrites: true,
                liveDatabasePath: sourcePath,
                backupDirectory: backupDirectory
            )
        )
        try liveRepository.bootstrap()
        _ = try liveRepository.createPage(
            id: "new-page",
            title: "New",
            parentID: nil,
            createdAt: "2026-05-21T10:01:00.000Z"
        )
        try liveRepository.updatePage(
            id: "new-page",
            updates: PageUpdates(title: "Renamed"),
            updatedAt: "2026-05-21T10:02:00.000Z"
        )

        let backupFiles = try FileManager.default
            .contentsOfDirectory(atPath: backupDirectory)
            .filter { $0.hasSuffix(".db") }
        XCTAssertEqual(backupFiles.count, 1)
        XCTAssertEqual(liveRepository.safetyStatus.backupPath?.hasPrefix(backupDirectory), true)

        let backupPath = "\(backupDirectory)/\(backupFiles[0])"
        let backupRepository = try SQLitePageRepository(databasePath: backupPath)
        XCTAssertEqual(try backupRepository.listPages().map(\.id), ["seed-page"])
    }

    private func temporaryDatabasePath(_ filename: String) -> String {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("opennotion-native-\(UUID().uuidString)-\(filename)")
            .path
    }

    private func temporaryDirectoryPath(_ name: String) -> String {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("opennotion-native-\(UUID().uuidString)-\(name)", isDirectory: true)
            .path
    }
}
