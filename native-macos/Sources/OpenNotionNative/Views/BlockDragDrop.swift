import Foundation
import OpenNotionCore
import SwiftUI
import UniformTypeIdentifiers

enum BlockDropLocation: Equatable {
    case before(String)
    case end
}

enum BlockDragPasteboard {
    static let type = UTType(exportedAs: "com.opennotion.native.block-id")
    static let typeIdentifiers = [type.identifier]

    static func provider(for blockID: String) -> NSItemProvider {
        let provider = NSItemProvider()
        provider.registerDataRepresentation(forTypeIdentifier: type.identifier, visibility: .ownProcess) { completion in
            completion(blockID.data(using: .utf8), nil)
            return nil
        }
        return provider
    }
}

struct BlockDropIndicator: View {
    let isActive: Bool

    var body: some View {
        Capsule()
            .fill(isActive ? Color.accentColor : Color.clear)
            .frame(height: 2)
            .padding(.leading, 54)
            .padding(.trailing, 4)
            .padding(.vertical, 2)
            .animation(.easeOut(duration: 0.12), value: isActive)
    }
}

struct BlockRowDropDelegate: DropDelegate {
    let targetID: String
    @Binding var document: BlockDocument
    @Binding var focusedBlockID: String?
    @Binding var draggingBlockID: String?
    @Binding var activeDropLocation: BlockDropLocation?

    func validateDrop(info: DropInfo) -> Bool {
        guard info.hasItemsConforming(to: BlockDragPasteboard.typeIdentifiers),
              let draggingBlockID else {
            return false
        }
        return draggingBlockID != targetID
    }

    func dropEntered(info: DropInfo) {
        guard let draggingBlockID,
              draggingBlockID != targetID else {
            return
        }
        activeDropLocation = .before(targetID)
    }

    func dropExited(info: DropInfo) {
        if activeDropLocation == .before(targetID) {
            activeDropLocation = nil
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        defer {
            activeDropLocation = nil
            draggingBlockID = nil
        }

        guard let draggedID = draggingBlockID,
              draggedID != targetID else {
            return false
        }

        document.moveBlock(id: draggedID, before: targetID)
        focusedBlockID = draggedID
        return true
    }
}

struct BlockEndDropDelegate: DropDelegate {
    @Binding var document: BlockDocument
    @Binding var focusedBlockID: String?
    @Binding var draggingBlockID: String?
    @Binding var activeDropLocation: BlockDropLocation?

    func validateDrop(info: DropInfo) -> Bool {
        info.hasItemsConforming(to: BlockDragPasteboard.typeIdentifiers) && draggingBlockID != nil
    }

    func dropEntered(info: DropInfo) {
        if draggingBlockID != nil {
            activeDropLocation = .end
        }
    }

    func dropExited(info: DropInfo) {
        if activeDropLocation == .end {
            activeDropLocation = nil
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }

    func performDrop(info: DropInfo) -> Bool {
        defer {
            activeDropLocation = nil
            draggingBlockID = nil
        }

        guard let draggedID = draggingBlockID else {
            return false
        }

        document.moveBlockToEnd(id: draggedID)
        focusedBlockID = draggedID
        return true
    }
}
