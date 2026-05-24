import Foundation

public struct Page: Identifiable, Codable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var parentID: String?
    public var content: String?
    public var searchText: String?
    public var icon: String?
    public var coverURL: String?
    public var isDeleted: Int
    public var isFavorite: Int
    public var isTemplate: Int
    public var isDatabase: Int
    public var databaseSchema: String?
    public var properties: String?
    public var sortOrder: Int
    public var createdAt: String
    public var updatedAt: String

    public init(
        id: String,
        title: String,
        parentID: String? = nil,
        content: String? = nil,
        searchText: String? = nil,
        icon: String? = nil,
        coverURL: String? = nil,
        isDeleted: Int = 0,
        isFavorite: Int = 0,
        isTemplate: Int = 0,
        isDatabase: Int = 0,
        databaseSchema: String? = nil,
        properties: String? = nil,
        sortOrder: Int = 0,
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.title = title
        self.parentID = parentID
        self.content = content
        self.searchText = searchText
        self.icon = icon
        self.coverURL = coverURL
        self.isDeleted = isDeleted
        self.isFavorite = isFavorite
        self.isTemplate = isTemplate
        self.isDatabase = isDatabase
        self.databaseSchema = databaseSchema
        self.properties = properties
        self.sortOrder = sortOrder
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct PageUpdates: Equatable, Sendable {
    public var title: String?
    public var parentID: String?
    public var content: String?
    public var searchText: String?
    public var icon: String?
    public var coverURL: String?
    public var isDeleted: Int?
    public var isFavorite: Int?
    public var isTemplate: Int?
    public var isDatabase: Int?
    public var databaseSchema: String?
    public var properties: String?
    public var clearIcon: Bool
    public var clearCoverURL: Bool

    public init(
        title: String? = nil,
        parentID: String? = nil,
        content: String? = nil,
        searchText: String? = nil,
        icon: String? = nil,
        coverURL: String? = nil,
        isDeleted: Int? = nil,
        isFavorite: Int? = nil,
        isTemplate: Int? = nil,
        isDatabase: Int? = nil,
        databaseSchema: String? = nil,
        properties: String? = nil,
        clearIcon: Bool = false,
        clearCoverURL: Bool = false
    ) {
        self.title = title
        self.parentID = parentID
        self.content = content
        self.searchText = searchText
        self.icon = icon
        self.coverURL = coverURL
        self.isDeleted = isDeleted
        self.isFavorite = isFavorite
        self.isTemplate = isTemplate
        self.isDatabase = isDatabase
        self.databaseSchema = databaseSchema
        self.properties = properties
        self.clearIcon = clearIcon
        self.clearCoverURL = clearCoverURL
    }
}
