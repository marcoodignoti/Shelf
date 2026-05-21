import OpenNotionCore
import SwiftUI

struct SidebarView: View {
    let store: OpenNotionStore
    @State private var query = ""

    private var visiblePages: [Page] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return store.pages
        }
        let needle = trimmed.lowercased()
        return store.pages.filter { page in
            page.title.lowercased().contains(needle)
                || (page.searchText ?? "").lowercased().contains(needle)
        }
    }

    var body: some View {
        List(selection: selectionBinding) {
            if !favorites.isEmpty {
                Section("Favorites") {
                    ForEach(favorites) { page in
                        PageRow(page: page)
                            .tag(page.id)
                    }
                }
            }

            Section("Pages") {
                ForEach(rootPages) { page in
                    PageRow(page: page)
                        .tag(page.id)
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("OpenNotion")
        .searchable(text: $query, placement: .sidebar, prompt: "Search pages")
        .toolbar {
            ToolbarItem {
                Button {
                    store.createPage()
                } label: {
                    Label("New Page", systemImage: "square.and.pencil")
                }
            }
        }
    }

    private var selectionBinding: Binding<String?> {
        Binding(
            get: { store.selectedPage?.id },
            set: { id in
                guard let id, let page = store.pages.first(where: { $0.id == id }) else {
                    return
                }
                store.select(page)
            }
        )
    }

    private var favorites: [Page] {
        visiblePages.filter { $0.isFavorite == 1 }
    }

    private var rootPages: [Page] {
        visiblePages.filter { $0.parentID == nil }
    }
}

private struct PageRow: View {
    let page: Page

    var body: some View {
        HStack(spacing: 10) {
            if let icon = page.icon, !icon.isEmpty {
                Text(icon)
                    .frame(width: 18)
            } else {
                Image(systemName: page.isDatabase == 1 ? "tablecells" : "doc.text")
                    .foregroundStyle(.secondary)
                    .frame(width: 18)
            }

            Text(page.title.isEmpty ? "Untitled" : page.title)
                .lineLimit(1)
        }
    }
}
