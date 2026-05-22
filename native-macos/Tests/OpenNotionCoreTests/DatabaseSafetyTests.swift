import XCTest
@testable import OpenNotionCore

final class DatabaseSafetyTests: XCTestCase {
    func testDefaultNativeDatabasePathIsSeparateFromTauriDatabasePath() throws {
        let path = try ApplicationSupportResolver.defaultDatabasePath()

        XCTAssertTrue(path.contains("org.opennotion.native"))
        XCTAssertTrue(path.hasSuffix("opennotion-native.db"))
        XCTAssertFalse(path.contains("org.opennotion.desktop"))
        XCTAssertFalse(path.hasSuffix("opennotion.db"))
    }

    func testDefaultNativeDatabaseSessionWarningDoesNotMentionTauriDatabase() throws {
        let session = try DatabaseSafety.defaultSession(environment: [:])
        let status = DatabaseSafetyStatus(
            activeDatabasePath: session.activeDatabasePath,
            sourceDatabasePath: session.sourceDatabasePath,
            isLiveDatabase: session.isLiveDatabase,
            isTestingCopy: session.isTestingCopy,
            warningMessage: session.warningMessage,
            backupPath: nil
        )

        XCTAssertTrue(status.isLiveDatabase)
        XCTAssertFalse(status.warningMessage?.contains("Tauri") ?? false)
    }

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
        XCTAssertFalse(liveRepository.safetyStatus.warningMessage?.contains("Tauri") ?? false)
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
