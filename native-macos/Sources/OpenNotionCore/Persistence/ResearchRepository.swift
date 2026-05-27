import Foundation

public protocol ResearchRepository: Sendable {
    func load() throws -> ResearchWorkspaceData
    func save(_ data: ResearchWorkspaceData) throws
}

public final class LocalResearchRepository: ResearchRepository, @unchecked Sendable {
    private let fileURL: URL
    private let fileManager: FileManager
    private let dateFormatter = ISO8601DateFormatter()

    public init(fileURL: URL, fileManager: FileManager = .default) {
        self.fileURL = fileURL
        self.fileManager = fileManager
    }

    public static func defaultRepository(fileManager: FileManager = .default) throws -> LocalResearchRepository {
        let directory = try ApplicationSupportResolver.defaultDirectory(fileManager: fileManager)
        return LocalResearchRepository(
            fileURL: directory.appendingPathComponent("research-workspace.json"),
            fileManager: fileManager
        )
    }

    public func load() throws -> ResearchWorkspaceData {
        guard fileManager.fileExists(atPath: fileURL.path) else {
            let data = ResearchWorkspaceData.defaultData(createdAt: dateFormatter.string(from: Date()))
            try save(data)
            return data
        }

        let fileData = try Data(contentsOf: fileURL)
        guard !fileData.isEmpty else {
            return ResearchWorkspaceData.defaultData(createdAt: dateFormatter.string(from: Date()))
        }
        return try JSONDecoder().decode(ResearchWorkspaceData.self, from: fileData)
    }

    public func save(_ data: ResearchWorkspaceData) throws {
        try fileManager.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(data).write(to: fileURL, options: .atomic)
    }
}
