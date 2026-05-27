import Foundation

public struct ResearchWorkspaceData: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var workspaces: [ResearchWorkspace]
    public var pages: [ResearchPage]
    public var notes: [ResearchNote]

    public init(
        schemaVersion: Int = 1,
        workspaces: [ResearchWorkspace] = [],
        pages: [ResearchPage] = [],
        notes: [ResearchNote] = []
    ) {
        self.schemaVersion = schemaVersion
        self.workspaces = workspaces
        self.pages = pages
        self.notes = notes
    }

    public static func defaultData(createdAt: String) -> ResearchWorkspaceData {
        ResearchWorkspaceData(
            workspaces: [
                ResearchWorkspace(id: "university", name: "University", createdAt: createdAt, updatedAt: createdAt),
                ResearchWorkspace(id: "physics-2", name: "Physics 2", createdAt: createdAt, updatedAt: createdAt),
                ResearchWorkspace(id: "embedded", name: "Embedded", createdAt: createdAt, updatedAt: createdAt)
            ]
        )
    }
}

public struct ResearchWorkspace: Identifiable, Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var isArchived: Bool
    public var createdAt: String
    public var updatedAt: String

    public init(
        id: String,
        name: String,
        isArchived: Bool = false,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.name = name
        self.isArchived = isArchived
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct ResearchPage: Identifiable, Codable, Equatable, Sendable {
    public var id: String
    public var workspaceID: String
    public var title: String
    public var urlString: String
    public var isFavorite: Bool
    public var isArchived: Bool
    public var createdAt: String
    public var updatedAt: String
    public var lastVisitedAt: String

    public init(
        id: String,
        workspaceID: String,
        title: String,
        urlString: String,
        isFavorite: Bool = false,
        isArchived: Bool = false,
        createdAt: String,
        updatedAt: String,
        lastVisitedAt: String
    ) {
        self.id = id
        self.workspaceID = workspaceID
        self.title = title
        self.urlString = urlString
        self.isFavorite = isFavorite
        self.isArchived = isArchived
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.lastVisitedAt = lastVisitedAt
    }
}

public struct ResearchNote: Identifiable, Codable, Equatable, Sendable {
    public var id: String
    public var pageID: String
    public var body: String
    public var tags: [String]
    public var checklist: [String]
    public var citations: [String]
    public var linkedNoteIDs: [String]
    public var createdAt: String
    public var updatedAt: String

    public init(
        id: String,
        pageID: String,
        body: String = "",
        tags: [String] = [],
        checklist: [String] = [],
        citations: [String] = [],
        linkedNoteIDs: [String] = [],
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.pageID = pageID
        self.body = body
        self.tags = tags
        self.checklist = checklist
        self.citations = citations
        self.linkedNoteIDs = linkedNoteIDs
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
