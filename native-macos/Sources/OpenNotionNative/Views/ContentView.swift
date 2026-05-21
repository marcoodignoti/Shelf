import OpenNotionCore
import SwiftUI

struct ContentView: View {
    let store: OpenNotionStore

    var body: some View {
        NavigationSplitView {
            SidebarView(store: store)
        } detail: {
            VStack(spacing: 0) {
                SafetyBanner(status: store.safetyStatus)
                Divider()
                DetailView(store: store)
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
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(.bar)
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
            PageEditorView(page: page) { title, text in
                store.save(
                    pageID: page.id,
                    title: title,
                    plainText: text,
                    preserveContent: BlockNoteCodec.hasUnsupportedBlocks(page.content)
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
