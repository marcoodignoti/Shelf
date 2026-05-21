import Foundation
import Observation
import OpenNotionCore

@MainActor
@Observable
final class OpenNotionStore {
    var pages: [Page] = []
    var selectedPageID: String?
    var isLoading = false
    var errorMessage: String?
    var safetyStatus: DatabaseSafetyStatus = .unavailable

    private let repository: PageRepository
    private let dateFormatter = ISO8601DateFormatter()

    init(repository: PageRepository? = nil) {
        if let repository {
            self.repository = repository
            return
        }

        do {
            let session = try DatabaseSafety.defaultSession()
            self.repository = try SQLitePageRepository(
                databasePath: session.activeDatabasePath,
                safetyOptions: DatabaseSafetyOptions(
                    backupBeforeWrites: session.isLiveDatabase,
                    liveDatabasePath: session.sourceDatabasePath,
                    backupDirectory: session.backupDirectory,
                    session: session
                )
            )
            self.safetyStatus = self.repository.safetyStatus
        } catch {
            self.repository = UnavailablePageRepository(error: error)
            self.errorMessage = error.localizedDescription
        }
    }

    var selectedPage: Page? {
        guard let selectedPageID else {
            return pages.first
        }
        return pages.first { $0.id == selectedPageID }
    }

    func load() {
        isLoading = true
        do {
            try repository.bootstrap()
            pages = try repository.listPages()
            selectedPageID = selectedPage?.id
            safetyStatus = repository.safetyStatus
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func select(_ page: Page) {
        selectedPageID = page.id
    }

    func createPage(parentID: String? = nil) {
        do {
            let now = dateFormatter.string(from: Date())
            let page = try repository.createPage(
                id: UUID().uuidString,
                title: "Untitled",
                parentID: parentID,
                createdAt: now
            )
            pages.insert(page, at: 0)
            selectedPageID = page.id
            safetyStatus = repository.safetyStatus
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @discardableResult
    func save(pageID: String, title: String, document: BlockDocument) -> Bool {
        let selectedPageIDBeforeSave = selectedPageID
        do {
            let now = dateFormatter.string(from: Date())
            let content = try BlockNoteCodec.encode(document)
            let searchText = BlockNoteCodec.searchText(for: document)
            let updates = PageUpdates(title: normalizedTitle(title), content: content, searchText: searchText)

            try repository.updatePage(
                id: pageID,
                updates: updates,
                updatedAt: now
            )
            pages = try repository.listPages()
            if let selectedPageIDBeforeSave,
               pages.contains(where: { $0.id == selectedPageIDBeforeSave }) {
                selectedPageID = selectedPageIDBeforeSave
            } else if pages.contains(where: { $0.id == pageID }) {
                selectedPageID = pageID
            } else {
                selectedPageID = pages.first?.id
            }
            safetyStatus = repository.safetyStatus
            errorMessage = nil
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func deleteSelectedPage() {
        guard let pageID = selectedPage?.id else {
            return
        }

        do {
            try repository.deletePage(id: pageID)
            pages = try repository.listPages()
            selectedPageID = pages.first?.id
            safetyStatus = repository.safetyStatus
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func search(_ query: String) -> [Page] {
        do {
            return try repository.searchPages(query: query)
        } catch {
            errorMessage = error.localizedDescription
            return []
        }
    }

    private func normalizedTitle(_ title: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Untitled" : trimmed
    }
}

private struct UnavailablePageRepository: PageRepository {
    let error: Error
    var safetyStatus: DatabaseSafetyStatus { .unavailable }

    func bootstrap() throws { throw error }
    func listPages() throws -> [Page] { throw error }
    func searchPages(query: String) throws -> [Page] { throw error }
    func createPage(id: String, title: String, parentID: String?, createdAt: String) throws -> Page { throw error }
    func updatePage(id: String, updates: PageUpdates, updatedAt: String) throws { throw error }
    func deletePage(id: String) throws { throw error }
}
