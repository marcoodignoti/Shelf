import Foundation
import Observation
import OpenNotionCore

@MainActor
@Observable
final class OpenNotionStore {
    var pages: [Page] = []
    var deletedPages: [Page] = []
    var selectedPageID: String?
    var isLoading = false
    var errorMessage: String?
    var safetyStatus: DatabaseSafetyStatus = .unavailable
    var pendingDeletePageID: String?

    private let repository: PageRepository
    private let dateFormatter = ISO8601DateFormatter()
    private var pendingOpenPageID: String?

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
            try reloadPages()
            if let pendingOpenPageID,
               pages.contains(where: { $0.id == pendingOpenPageID }) {
                selectedPageID = pendingOpenPageID
                self.pendingOpenPageID = nil
            } else {
                selectedPageID = selectedPage?.id
            }
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

    @discardableResult
    func openPageLink(_ url: URL) -> Bool {
        guard url.scheme == "opennotion",
              let pageID = pageID(from: url) else {
            return false
        }

        if pages.contains(where: { $0.id == pageID }) {
            selectedPageID = pageID
            pendingOpenPageID = nil
            return true
        }

        pendingOpenPageID = pageID
        return true
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
            deletedPages = try repository.listDeletedPages()
            selectedPageID = page.id
            safetyStatus = repository.safetyStatus
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @discardableResult
    func toggleFavorite(pageID: String) -> Bool {
        guard let page = pages.first(where: { $0.id == pageID }) else {
            return false
        }

        return updatePage(
            pageID: pageID,
            updates: PageUpdates(isFavorite: page.isFavorite == 1 ? 0 : 1)
        )
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
            try reloadPages()
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

    @discardableResult
    func deletePage(pageID: String) -> Bool {
        let selectedPageIDBeforeDelete = selectedPageID
        do {
            try repository.deletePage(id: pageID)
            try reloadPages()
            if let selectedPageIDBeforeDelete,
               pages.contains(where: { $0.id == selectedPageIDBeforeDelete }) {
                selectedPageID = selectedPageIDBeforeDelete
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

    func requestDeletePage(pageID: String) {
        guard pages.contains(where: { $0.id == pageID }) else {
            return
        }

        pendingDeletePageID = pageID
    }

    func requestDeleteSelectedPage() {
        guard let pageID = selectedPage?.id else {
            return
        }

        requestDeletePage(pageID: pageID)
    }

    func cancelPendingPageDeletion() {
        pendingDeletePageID = nil
    }

    @discardableResult
    func confirmPendingPageDeletion() -> Bool {
        guard let pageID = pendingDeletePageID else {
            return false
        }

        pendingDeletePageID = nil
        return deletePage(pageID: pageID)
    }

    @discardableResult
    func restorePage(pageID: String) -> Bool {
        do {
            let now = dateFormatter.string(from: Date())
            try repository.updatePage(id: pageID, updates: PageUpdates(isDeleted: 0), updatedAt: now)
            try reloadPages()
            selectedPageID = pageID
            safetyStatus = repository.safetyStatus
            errorMessage = nil
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
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

    @discardableResult
    private func updatePage(pageID: String, updates: PageUpdates) -> Bool {
        let selectedPageIDBeforeUpdate = selectedPageID
        do {
            let now = dateFormatter.string(from: Date())
            try repository.updatePage(id: pageID, updates: updates, updatedAt: now)
            try reloadPages()
            if let selectedPageIDBeforeUpdate,
               pages.contains(where: { $0.id == selectedPageIDBeforeUpdate }) {
                selectedPageID = selectedPageIDBeforeUpdate
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

    private func normalizedTitle(_ title: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Untitled" : trimmed
    }

    private func reloadPages() throws {
        pages = try repository.listPages()
        deletedPages = try repository.listDeletedPages()
    }

    private func pageID(from url: URL) -> String? {
        let pathParts = url.pathComponents.filter { $0 != "/" }
        if url.host == "page" {
            return pathParts.first
        }

        guard pathParts.first == "page" else {
            return nil
        }
        return pathParts.dropFirst().first
    }
}

private struct UnavailablePageRepository: PageRepository {
    let error: Error
    var safetyStatus: DatabaseSafetyStatus { .unavailable }

    func bootstrap() throws { throw error }
    func listPages() throws -> [Page] { throw error }
    func listDeletedPages() throws -> [Page] { throw error }
    func searchPages(query: String) throws -> [Page] { throw error }
    func createPage(id: String, title: String, parentID: String?, createdAt: String) throws -> Page { throw error }
    func updatePage(id: String, updates: PageUpdates, updatedAt: String) throws { throw error }
    func deletePage(id: String) throws { throw error }
}
