import SwiftUI

struct BrowserView: View {
    let store: WorkspaceStore
    @State private var canGoBack = false
    @State private var canGoForward = false
    @State private var isLoading = false
    @State private var backTrigger = 0
    @State private var forwardTrigger = 0
    @State private var reloadTrigger = 0

    var body: some View {
        VStack(spacing: 0) {
            BrowserToolbar(
                store: store,
                canGoBack: canGoBack,
                canGoForward: canGoForward,
                isLoading: isLoading,
                onBack: { backTrigger += 1 },
                onForward: { forwardTrigger += 1 },
                onReload: { reloadTrigger += 1 }
            )
            Divider()
            ZStack {
                if store.browserURL == nil {
                    BrowserEmptyState {
                        store.urlText = "https://developer.apple.com/documentation/"
                        _ = store.openAddressBarURL()
                    }
                } else {
                    WebViewWrapper(
                        url: store.browserURL,
                        canGoBack: $canGoBack,
                        canGoForward: $canGoForward,
                        isLoading: $isLoading,
                        backTrigger: backTrigger,
                        forwardTrigger: forwardTrigger,
                        reloadTrigger: reloadTrigger,
                        onURLChange: { url in
                            store.recordNavigation(to: url, title: nil)
                        },
                        onTitleChange: { title in
                            store.updateCurrentPageTitle(title)
                        }
                    )
                }
            }
        }
    }
}

private struct BrowserToolbar: View {
    let store: WorkspaceStore
    let canGoBack: Bool
    let canGoForward: Bool
    let isLoading: Bool
    let onBack: () -> Void
    let onForward: () -> Void
    let onReload: () -> Void
    @State private var addressText = ""

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
            }
            .disabled(!canGoBack)
            .help("Back")

            Button(action: onForward) {
                Image(systemName: "chevron.right")
            }
            .disabled(!canGoForward)
            .help("Forward")

            Button(action: onReload) {
                Image(systemName: "arrow.clockwise")
            }
            .help(isLoading ? "Reload loading page" : "Reload")

            TextField("Enter URL or local PDF path", text: $addressText)
            .textFieldStyle(.roundedBorder)
            .onSubmit {
                _ = store.openAddressBarURL(addressText)
            }
            .onAppear {
                addressText = store.urlText
            }
            .onChange(of: store.urlText) { _, newValue in
                if newValue != addressText {
                    addressText = newValue
                }
            }

            Button {
                _ = store.openAddressBarURL(addressText)
            } label: {
                Image(systemName: "arrow.right.circle.fill")
            }
            .help("Open")

            if let page = store.currentPage {
                Button {
                    store.toggleFavorite(pageID: page.id)
                } label: {
                    Image(systemName: page.isFavorite ? "star.fill" : "star")
                }
                .help(page.isFavorite ? "Remove from Favorites" : "Add to Favorites")

                Button {
                    store.archive(pageID: page.id)
                } label: {
                    Image(systemName: "archivebox")
                }
                .help("Archive")
            }
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}

private struct BrowserEmptyState: View {
    let openSample: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "globe")
                .font(.system(size: 40, weight: .regular))
                .foregroundStyle(.secondary)
            Text("Open a research source")
                .font(.title3)
                .fontWeight(.semibold)
            Text("Use the address bar for websites, documentation, papers, or local PDFs.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
            Button("Open Apple Documentation", action: openSample)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }
}
