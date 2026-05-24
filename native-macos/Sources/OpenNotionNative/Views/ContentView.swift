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
        .onOpenURL { url in
            _ = store.openPageLink(url)
        }
        .confirmationDialog("Move page to Trash?", isPresented: deleteConfirmationBinding, titleVisibility: .visible) {
            Button("Move to Trash", role: .destructive) {
                _ = store.confirmPendingPageDeletion()
            }
            Button("Cancel", role: .cancel) {
                store.cancelPendingPageDeletion()
            }
        } message: {
            Text("This moves the page and its subpages to Trash. You can restore them later.")
        }
        .confirmationDialog("Delete page permanently?", isPresented: permanentDeleteConfirmationBinding, titleVisibility: .visible) {
            Button("Delete Permanently", role: .destructive) {
                _ = store.confirmPendingPermanentPageDeletion()
            }
            Button("Cancel", role: .cancel) {
                store.cancelPendingPermanentPageDeletion()
            }
        } message: {
            Text("This permanently deletes the page and its subpages from Trash. This action cannot be undone.")
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

    private var deleteConfirmationBinding: Binding<Bool> {
        Binding(
            get: { store.pendingDeletePageID != nil },
            set: { isPresented in
                if !isPresented {
                    store.cancelPendingPageDeletion()
                }
            }
        )
    }

    private var permanentDeleteConfirmationBinding: Binding<Bool> {
        Binding(
            get: { store.pendingPermanentDeletePageID != nil },
            set: { isPresented in
                if !isPresented {
                    store.cancelPendingPermanentPageDeletion()
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
            } onSaveMetadata: { icon, coverURL in
                store.updatePageMetadata(
                    pageID: page.id,
                    icon: icon,
                    coverURL: coverURL
                )
            } onImportCoverImage: { sourceURL, icon in
                store.importCoverImage(
                    pageID: page.id,
                    sourceURL: sourceURL,
                    icon: icon
                )
            } onToggleFavorite: {
                store.toggleFavorite(pageID: page.id)
            } onDuplicate: {
                store.duplicatePage(pageID: page.id)
            } onCreateSubpage: {
                store.createPage(parentID: page.id)
            } onDelete: {
                store.requestDeletePage(pageID: page.id)
            }
            .id(page.id)
        } else {
            HomeView {
                store.createPage()
            }
        }
    }
}
