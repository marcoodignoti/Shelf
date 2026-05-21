import Foundation

public enum ApplicationSupportResolver {
    public static let tauriBundleIdentifier = "org.opennotion.desktop"

    public static func defaultDatabasePath(fileManager: FileManager = .default) throws -> String {
        let appSupport = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let directory = appSupport.appendingPathComponent(tauriBundleIdentifier, isDirectory: true)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("opennotion.db").path
    }
}
