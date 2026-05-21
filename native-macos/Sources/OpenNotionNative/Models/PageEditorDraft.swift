import Foundation
import OpenNotionCore

struct PageEditorDraft: Equatable {
    var title: String
    var document: BlockDocument
    var savedTitle: String
    var savedDocument: BlockDocument

    var persistedTitle: String {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedTitle.isEmpty ? "Untitled" : trimmedTitle
    }

    var isDirty: Bool {
        persistedTitle != savedTitle || document != savedDocument
    }

    mutating func markSaved() {
        savedTitle = persistedTitle
        savedDocument = document
    }
}
