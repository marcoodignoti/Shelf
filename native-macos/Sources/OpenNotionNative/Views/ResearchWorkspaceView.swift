import SwiftUI

struct ResearchWorkspaceView: View {
    let store: WorkspaceStore

    var body: some View {
        if store.isLoading {
            ProgressView("Loading research workspace...")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            HSplitView {
                BrowserView(store: store)
                    .frame(minWidth: 520)
                ResearchNotePanel(store: store)
            }
            .overlay(alignment: .top) {
                if let message = store.errorMessage {
                    ErrorPill(message: message)
                        .padding(.top, 10)
                }
            }
        }
    }
}

private struct ErrorPill: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle")
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(.regularMaterial)
            .clipShape(Capsule())
    }
}
