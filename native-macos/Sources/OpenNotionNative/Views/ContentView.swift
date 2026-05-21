import OpenNotionCore
import SwiftUI

struct ContentView: View {
    let store: OpenNotionStore

    var body: some View {
        NavigationSplitView {
            SidebarView(store: store)
        } detail: {
            ZStack(alignment: .topLeading) {
                DetailView(store: store)
                SafetyBanner(status: store.safetyStatus)
                    .padding(.top, 10)
                    .padding(.leading, 14)
            }
        }
        .alert("OpenNotion", isPresented: errorBinding) {
            Button("OK") {
                store.errorMessage = nil
            }
        } message: {
            Text(store.errorMessage ?? "")
        }
    }

    private var errorBinding: Binding<Bool> {
        Binding(
            get: { store.errorMessage != nil },
            set: { isPresented in
                if !isPresented {
                    store.errorMessage = nil
                }
            }
        )
    }
}

private struct SafetyBanner: View {
    let status: DatabaseSafetyStatus

    var body: some View {
        if let message = status.warningMessage {
            HStack(spacing: 8) {
                Image(systemName: status.isLiveDatabase ? "externaldrive.badge.exclamationmark" : "doc.on.doc")
                    .foregroundStyle(status.isLiveDatabase ? .orange : .secondary)
                Text(status.isLiveDatabase ? "Live DB - backup on first write" : "Testing copy")
                    .font(.caption2)
                    .fontWeight(.medium)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(.regularMaterial)
            .clipShape(Capsule())
            .help(message)
        }
    }
}

private struct DetailView: View {
    let store: OpenNotionStore

    var body: some View {
        if store.isLoading {
            ProgressView("Loading workspace...")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let page = store.selectedPage {
            PageEditorView(page: page) { title, document in
                store.save(
                    pageID: page.id,
                    title: title,
                    document: document
                )
            }
            .id(page.id)
        } else {
            HomeView {
                store.createPage()
            }
        }
    }
}
