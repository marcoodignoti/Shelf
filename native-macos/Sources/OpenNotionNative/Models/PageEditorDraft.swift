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

enum PageEditorFocus {
    static func firstEditableBlockID(in document: BlockDocument) -> String? {
        document.blocks.first { $0.kind.acceptsText }?.id
    }
}

struct BlockEditorUndoSnapshot: Equatable {
    var document: BlockDocument
    var focusedBlockID: String?
    var selectionOffsets: [String: Int]
}

struct BlockEditorUndoStack: Equatable {
    private(set) var snapshots: [BlockEditorUndoSnapshot] = []

    mutating func record(
        document: BlockDocument,
        focusedBlockID: String?,
        selectionOffsets: [String: Int]
    ) {
        record(
            BlockEditorUndoSnapshot(
                document: document,
                focusedBlockID: focusedBlockID,
                selectionOffsets: selectionOffsets
            )
        )
    }

    mutating func record(_ snapshot: BlockEditorUndoSnapshot) {
        snapshots.append(snapshot)
    }

    mutating func restorePrevious(
        document: inout BlockDocument,
        focusedBlockID: inout String?,
        selectionOffsets: inout [String: Int]
    ) -> Bool {
        guard let snapshot = snapshots.popLast() else {
            return false
        }

        document = snapshot.document
        focusedBlockID = snapshot.focusedBlockID
        selectionOffsets = snapshot.selectionOffsets
        return true
    }
}
