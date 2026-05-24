import Foundation

public enum PageRepositoryError: Error, Equatable {
    case pageNotFound
}

public protocol PageRepository: Sendable {
    var safetyStatus: DatabaseSafetyStatus { get }

    func bootstrap() throws
    func listPages() throws -> [Page]
    func listDeletedPages() throws -> [Page]
    func page(id: String) throws -> Page?
    func searchPages(query: String) throws -> [Page]
    func createPage(id: String, title: String, parentID: String?, createdAt: String) throws -> Page
    func duplicatePage(sourceID: String, id: String, createdAt: String) throws -> Page
    func movePage(id: String, parentID: String?, updatedAt: String) throws
    func updatePage(id: String, updates: PageUpdates, updatedAt: String) throws
    func deletePage(id: String) throws
    func restorePage(id: String) throws
    func permanentlyDeletePage(id: String) throws
}
