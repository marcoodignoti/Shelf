import Foundation
import Observation
import OpenNotionCore

@MainActor
@Observable
final class WorkspaceStore {
    var data = ResearchWorkspaceData()
    var selectedWorkspaceID: String?
    var selectedPageID: String?
    var browserURL: URL?
    var urlText = ""
    var searchQuery = ""
    var isLoading = false
    var errorMessage: String?

    private let repository: ResearchRepository
    private let dateFormatter = ISO8601DateFormatter()

    init(repository: ResearchRepository? = nil) {
        if let repository {
            self.repository = repository
            return
        }

        do {
            self.repository = try LocalResearchRepository.defaultRepository()
        } catch {
            self.repository = UnavailableResearchRepository(error: error)
            self.errorMessage = error.localizedDescription
        }
    }

    var workspaces: [ResearchWorkspace] {
        data.workspaces
            .filter { !$0.isArchived }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    var selectedWorkspace: ResearchWorkspace? {
        guard let selectedWorkspaceID else {
            return workspaces.first
        }
        return workspaces.first { $0.id == selectedWorkspaceID } ?? workspaces.first
    }

    var currentPage: ResearchPage? {
        guard let selectedPageID else {
            return nil
        }
        return data.pages.first { $0.id == selectedPageID }
    }

    var currentNote: ResearchNote? {
        guard let selectedPageID else {
            return nil
        }
        return data.notes.first { $0.pageID == selectedPageID }
    }

    var workspacePages: [ResearchPage] {
        guard let workspaceID = selectedWorkspace?.id else {
            return []
        }
        return data.pages
            .filter { $0.workspaceID == workspaceID && !$0.isArchived }
            .sorted(by: pageRecencySort)
    }

    var recentPages: [ResearchPage] {
        Array(data.pages
            .filter { !$0.isArchived }
            .sorted(by: pageRecencySort)
            .prefix(8))
    }

    var favoritePages: [ResearchPage] {
        data.pages
            .filter { $0.isFavorite && !$0.isArchived }
            .sorted(by: pageRecencySort)
    }

    var archivedPages: [ResearchPage] {
        data.pages
            .filter(\.isArchived)
            .sorted(by: pageRecencySort)
    }

    var searchResults: [ResearchPage] {
        let needle = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else {
            return []
        }
        return data.pages
            .filter { page in
                searchableText(for: page).contains(needle)
            }
            .sorted(by: pageRecencySort)
    }

    func load() {
        isLoading = true
        defer { isLoading = false }

        do {
            data = try repository.load()
            ensureDefaultWorkspace()
            if let page = recentPages.first {
                selectPage(page)
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func selectWorkspace(_ workspace: ResearchWorkspace) {
        selectedWorkspaceID = workspace.id
        if let page = workspacePages.first {
            selectPage(page)
        } else {
            selectedPageID = nil
            browserURL = nil
            urlText = ""
        }
    }

    func selectPage(_ page: ResearchPage) {
        selectedWorkspaceID = page.workspaceID
        selectedPageID = page.id
        urlText = page.urlString
        browserURL = URL(string: page.urlString)
        ensureNote(for: page.id)
    }

    @discardableResult
    func createWorkspace(named name: String) -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return false
        }
        let now = timestamp()
        let workspace = ResearchWorkspace(
            id: UUID().uuidString,
            name: trimmed,
            createdAt: now,
            updatedAt: now
        )
        data.workspaces.append(workspace)
        selectedWorkspaceID = workspace.id
        persist()
        return true
    }

    @discardableResult
    func openAddressBarURL(_ address: String? = nil) -> Bool {
        let address = address ?? urlText
        guard let url = normalizedURL(from: address) else {
            errorMessage = "Enter a valid URL or local file path."
            return false
        }
        recordNavigation(to: url, title: nil)
        browserURL = url
        urlText = url.absoluteString
        return true
    }

    func recordNavigation(to url: URL, title: String?) {
        guard let workspaceID = selectedWorkspace?.id ?? workspaces.first?.id else {
            return
        }

        let now = timestamp()
        let normalizedURLString = url.absoluteString
        if let index = data.pages.firstIndex(where: {
            $0.workspaceID == workspaceID && $0.urlString == normalizedURLString
        }) {
            data.pages[index].lastVisitedAt = now
            data.pages[index].updatedAt = now
            if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                data.pages[index].title = title
            }
            selectedPageID = data.pages[index].id
        } else {
            let page = ResearchPage(
                id: UUID().uuidString,
                workspaceID: workspaceID,
                title: titleForNewPage(title: title, url: url),
                urlString: normalizedURLString,
                createdAt: now,
                updatedAt: now,
                lastVisitedAt: now
            )
            data.pages.append(page)
            selectedPageID = page.id
        }

        selectedWorkspaceID = workspaceID
        urlText = normalizedURLString
        browserURL = url
        if let selectedPageID {
            ensureNote(for: selectedPageID)
        }
        persist()
    }

    func updateCurrentPageTitle(_ title: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let selectedPageID,
              let index = data.pages.firstIndex(where: { $0.id == selectedPageID }),
              data.pages[index].title != trimmed else {
            return
        }

        data.pages[index].title = trimmed
        data.pages[index].updatedAt = timestamp()
        persist()
    }

    func updateCurrentNoteBody(_ body: String) {
        updateCurrentNote { note, now in
            note.body = body
            note.updatedAt = now
        }
    }

    func updateCurrentNoteTags(_ tagsText: String) {
        updateCurrentNote { note, now in
            note.tags = parseCommaSeparated(tagsText)
            note.updatedAt = now
        }
    }

    func updateCurrentNoteChecklist(_ checklistText: String) {
        updateCurrentNote { note, now in
            note.checklist = parseLines(checklistText)
            note.updatedAt = now
        }
    }

    func updateCurrentNoteCitations(_ citationsText: String) {
        updateCurrentNote { note, now in
            note.citations = parseLines(citationsText)
            note.updatedAt = now
        }
    }

    func tagsText(for note: ResearchNote?) -> String {
        note?.tags.joined(separator: ", ") ?? ""
    }

    func checklistText(for note: ResearchNote?) -> String {
        note?.checklist.joined(separator: "\n") ?? ""
    }

    func citationsText(for note: ResearchNote?) -> String {
        note?.citations.joined(separator: "\n") ?? ""
    }

    func relatedPages(for note: ResearchNote?) -> [ResearchPage] {
        guard let note,
              !note.tags.isEmpty else {
            return []
        }
        let tags = Set(note.tags.map { $0.lowercased() })
        let currentPageID = note.pageID
        let relatedPageIDs = data.notes
            .filter { other in
                other.pageID != currentPageID && !tags.isDisjoint(with: Set(other.tags.map { $0.lowercased() }))
            }
            .map(\.pageID)
        return data.pages
            .filter { relatedPageIDs.contains($0.id) && !$0.isArchived }
            .sorted(by: pageRecencySort)
    }

    func toggleFavorite(pageID: String) {
        guard let index = data.pages.firstIndex(where: { $0.id == pageID }) else {
            return
        }
        data.pages[index].isFavorite.toggle()
        data.pages[index].updatedAt = timestamp()
        persist()
    }

    func archive(pageID: String) {
        guard let index = data.pages.firstIndex(where: { $0.id == pageID }) else {
            return
        }
        data.pages[index].isArchived = true
        data.pages[index].updatedAt = timestamp()
        if selectedPageID == pageID {
            if let nextPage = workspacePages.first {
                selectPage(nextPage)
            } else {
                selectedPageID = nil
                browserURL = nil
                urlText = ""
            }
        }
        persist()
    }

    func restore(pageID: String) {
        guard let index = data.pages.firstIndex(where: { $0.id == pageID }) else {
            return
        }
        data.pages[index].isArchived = false
        data.pages[index].updatedAt = timestamp()
        selectedPageID = pageID
        persist()
    }

    private func ensureDefaultWorkspace() {
        if data.workspaces.isEmpty {
            data = ResearchWorkspaceData.defaultData(createdAt: timestamp())
            persist()
        }
        if selectedWorkspaceID == nil {
            selectedWorkspaceID = workspaces.first?.id
        }
    }

    private func ensureNote(for pageID: String) {
        guard !data.notes.contains(where: { $0.pageID == pageID }) else {
            return
        }
        let now = timestamp()
        data.notes.append(
            ResearchNote(
                id: UUID().uuidString,
                pageID: pageID,
                createdAt: now,
                updatedAt: now
            )
        )
        persist()
    }

    private func updateCurrentNote(_ update: (inout ResearchNote, String) -> Void) {
        guard let selectedPageID else {
            return
        }
        ensureNote(for: selectedPageID)
        guard let index = data.notes.firstIndex(where: { $0.pageID == selectedPageID }) else {
            return
        }
        let now = timestamp()
        update(&data.notes[index], now)
        persist()
    }

    private func persist() {
        do {
            try repository.save(data)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func normalizedURL(from input: String) -> URL? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }

        if trimmed.hasPrefix("/") || trimmed.hasPrefix("~") {
            let expanded = (trimmed as NSString).expandingTildeInPath
            guard FileManager.default.fileExists(atPath: expanded) else {
                return nil
            }
            return URL(fileURLWithPath: expanded)
        }

        if let url = URL(string: trimmed), url.scheme != nil {
            return url
        }

        return URL(string: "https://\(trimmed)")
    }

    private func titleForNewPage(title: String?, url: URL) -> String {
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !trimmed.isEmpty {
            return trimmed
        }
        return url.host ?? url.lastPathComponent.ifEmpty(url.absoluteString)
    }

    private func searchableText(for page: ResearchPage) -> String {
        let note = data.notes.first { $0.pageID == page.id }
        return [
            page.title,
            page.urlString,
            note?.body ?? "",
            note?.tags.joined(separator: " ") ?? "",
            note?.checklist.joined(separator: " ") ?? "",
            note?.citations.joined(separator: " ") ?? ""
        ]
        .joined(separator: " ")
        .lowercased()
    }

    private func pageRecencySort(_ lhs: ResearchPage, _ rhs: ResearchPage) -> Bool {
        lhs.lastVisitedAt > rhs.lastVisitedAt
    }

    private func parseCommaSeparated(_ text: String) -> [String] {
        text.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private func parseLines(_ text: String) -> [String] {
        text.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private func timestamp() -> String {
        dateFormatter.string(from: Date())
    }
}

private struct UnavailableResearchRepository: ResearchRepository {
    let error: Error

    func load() throws -> ResearchWorkspaceData {
        throw error
    }

    func save(_ data: ResearchWorkspaceData) throws {
        throw error
    }
}

private extension String {
    func ifEmpty(_ fallback: String) -> String {
        isEmpty ? fallback : self
    }
}
