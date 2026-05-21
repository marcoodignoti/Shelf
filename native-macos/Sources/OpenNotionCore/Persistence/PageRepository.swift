import Foundation

public protocol PageRepository: Sendable {
    var safetyStatus: DatabaseSafetyStatus { get }

    func bootstrap() throws
    func listPages() throws -> [Page]
    func listDeletedPages() throws -> [Page]
    func searchPages(query: String) throws -> [Page]
    func createPage(id: String, title: String, parentID: String?, createdAt: String) throws -> Page
    func updatePage(id: String, updates: PageUpdates, updatedAt: String) throws
    func deletePage(id: String) throws
}
