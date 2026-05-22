import Foundation
import GRDB

public enum DatabaseOpenMode: String, Sendable {
    case live
    case testingCopy
}

public struct DatabaseSession: Equatable, Sendable {
    public var activeDatabasePath: String
    public var sourceDatabasePath: String
    public var backupDirectory: String
    public var mode: DatabaseOpenMode

    public var isTestingCopy: Bool {
        mode == .testingCopy
    }

    public var isLiveDatabase: Bool {
        mode == .live
    }

    public var warningMessage: String? {
        if isLiveDatabase {
            return "Native app is writing to its local database. A backup is created before the first write."
        }

        return "Testing copy mode is active. Writes do not affect the native local database."
    }
}

public struct DatabaseSafetyStatus: Equatable, Sendable {
    public var activeDatabasePath: String?
    public var sourceDatabasePath: String?
    public var isLiveDatabase: Bool
    public var isTestingCopy: Bool
    public var warningMessage: String?
    public var backupPath: String?

    public static let unavailable = DatabaseSafetyStatus(
        activeDatabasePath: nil,
        sourceDatabasePath: nil,
        isLiveDatabase: false,
        isTestingCopy: false,
        warningMessage: nil,
        backupPath: nil
    )
}

public struct DatabaseSafetyOptions: Sendable {
    public var backupBeforeWrites: Bool
    public var liveDatabasePath: String?
    public var backupDirectory: String?
    public var session: DatabaseSession?

    public init(
        backupBeforeWrites: Bool = false,
        liveDatabasePath: String? = nil,
        backupDirectory: String? = nil,
        session: DatabaseSession? = nil
    ) {
        self.backupBeforeWrites = backupBeforeWrites
        self.liveDatabasePath = liveDatabasePath
        self.backupDirectory = backupDirectory
        self.session = session
    }

    public static let disabled = DatabaseSafetyOptions()
}

public enum DatabaseSafety {
    public static let modeEnvironmentKey = "OPENNOTION_NATIVE_DATABASE_MODE"
    public static let pathEnvironmentKey = "OPENNOTION_NATIVE_DATABASE_PATH"

    public static func defaultSession(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) throws -> DatabaseSession {
        let sourcePath = try environment[pathEnvironmentKey]
            ?? ApplicationSupportResolver.defaultDatabasePath(fileManager: fileManager)
        let mode = DatabaseOpenMode(rawValue: environment[modeEnvironmentKey] ?? "") ?? .live

        if mode == .testingCopy {
            return try testingCopySession(sourceDatabasePath: sourcePath, fileManager: fileManager)
        }

        return liveSession(databasePath: sourcePath, fileManager: fileManager)
    }

    public static func liveSession(
        databasePath: String,
        fileManager: FileManager = .default
    ) -> DatabaseSession {
        DatabaseSession(
            activeDatabasePath: standardizedPath(databasePath),
            sourceDatabasePath: standardizedPath(databasePath),
            backupDirectory: defaultBackupDirectory(for: databasePath, fileManager: fileManager),
            mode: .live
        )
    }

    public static func testingCopySession(
        sourceDatabasePath: String,
        fileManager: FileManager = .default
    ) throws -> DatabaseSession {
        let sourceURL = URL(fileURLWithPath: sourceDatabasePath)
        let copyDirectory = fileManager.temporaryDirectory
            .appendingPathComponent("OpenNotionNativeTestingCopies", isDirectory: true)
        try fileManager.createDirectory(at: copyDirectory, withIntermediateDirectories: true)
        let copyURL = copyDirectory
            .appendingPathComponent(sourceURL.deletingPathExtension().lastPathComponent)
            .appendingPathExtension("\(UUID().uuidString).db")

        if fileManager.fileExists(atPath: sourceDatabasePath) {
            let source = try DatabaseQueue(path: sourceDatabasePath)
            let destination = try DatabaseQueue(path: copyURL.path)
            try source.backup(to: destination)
        }

        return DatabaseSession(
            activeDatabasePath: standardizedPath(copyURL.path),
            sourceDatabasePath: standardizedPath(sourceDatabasePath),
            backupDirectory: defaultBackupDirectory(for: sourceDatabasePath, fileManager: fileManager),
            mode: .testingCopy
        )
    }

    public static func defaultBackupDirectory(
        for databasePath: String,
        fileManager: FileManager = .default
    ) -> String {
        URL(fileURLWithPath: databasePath)
            .deletingLastPathComponent()
            .appendingPathComponent("native-backups", isDirectory: true)
            .path
    }

    public static func backupPath(
        for databasePath: String,
        in backupDirectory: String,
        date: Date = Date()
    ) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMdd-HHmmss"

        let baseName = URL(fileURLWithPath: databasePath).deletingPathExtension().lastPathComponent
        return URL(fileURLWithPath: backupDirectory, isDirectory: true)
            .appendingPathComponent("\(baseName)-\(formatter.string(from: date))-\(UUID().uuidString.prefix(8)).db")
            .path
    }

    public static func standardizedPath(_ path: String) -> String {
        URL(fileURLWithPath: path).standardizedFileURL.path
    }
}
