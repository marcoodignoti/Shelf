import OpenNotionCore
import SwiftUI

struct SidebarView: View {
    let store: OpenNotionStore
    @State private var query = ""
    @State private var expandedPageIDs: Set<String> = []

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
            if isSearching {
                Section("Results") {
                    ForEach(visiblePages) { page in
                        PageRow(page: page)
                            .tag(page.id)
                            .contextMenu {
                                pageContextMenu(for: page)
                            }
                    }
                }
            } else if !favorites.isEmpty {
                Section("Favorites") {
                    ForEach(favorites) { page in
                        PageRow(page: page)
                            .tag(page.id)
                            .contextMenu {
                                pageContextMenu(for: page)
                            }
                    }
                }
            }

            Section("Pages") {
                ForEach(pageTree) { node in
                    PageTreeRow(
                        node: node,
                        expandedPageIDs: $expandedPageIDs,
                        contextMenu: pageContextMenu
                    )
                }
            }

            if !isSearching, !store.deletedPages.isEmpty {
                Section("Trash") {
                    ForEach(store.deletedPages) { page in
                        PageRow(page: page)
                            .foregroundStyle(.secondary)
                            .contextMenu {
                                trashContextMenu(for: page)
                            }
                    }
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

    private var isSearching: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var pageTree: [PageTreeNode] {
        PageHierarchy.tree(from: visiblePages)
    }

    @ViewBuilder
    private func pageContextMenu(for page: Page) -> some View {
        Button("New Subpage") {
            expandedPageIDs.insert(page.id)
            store.createPage(parentID: page.id)
        }

        Button(page.isFavorite == 1 ? "Remove from Favorites" : "Add to Favorites") {
            store.toggleFavorite(pageID: page.id)
        }

        Divider()

        Button("Move to Trash", role: .destructive) {
            store.requestDeletePage(pageID: page.id)
        }
    }

    @ViewBuilder
    private func trashContextMenu(for page: Page) -> some View {
        Button("Restore") {
            store.restorePage(pageID: page.id)
        }

        Divider()

        Button("Delete Permanently", role: .destructive) {
            store.requestPermanentDeletePage(pageID: page.id)
        }
    }
}

private struct PageTreeRow: View {
    let node: PageTreeNode
    @Binding var expandedPageIDs: Set<String>
    let contextMenu: (Page) -> AnyView

    init<ContextMenu: View>(
        node: PageTreeNode,
        expandedPageIDs: Binding<Set<String>>,
        @ViewBuilder contextMenu: @escaping (Page) -> ContextMenu
    ) {
        self.node = node
        _expandedPageIDs = expandedPageIDs
        self.contextMenu = { AnyView(contextMenu($0)) }
    }

    var body: some View {
        if node.children.isEmpty {
            PageRow(page: node.page)
                .tag(node.page.id)
                .contextMenu {
                    contextMenu(node.page)
                }
        } else {
            DisclosureGroup(isExpanded: isExpanded) {
                ForEach(node.children) { child in
                    PageTreeRow(
                        node: child,
                        expandedPageIDs: $expandedPageIDs,
                        contextMenu: contextMenu
                    )
                }
            } label: {
                PageRow(page: node.page)
            }
            .tag(node.page.id)
            .contextMenu {
                contextMenu(node.page)
            }
        }
    }

    private var isExpanded: Binding<Bool> {
        Binding(
            get: { expandedPageIDs.contains(node.page.id) },
            set: { isExpanded in
                if isExpanded {
                    expandedPageIDs.insert(node.page.id)
                } else {
                    expandedPageIDs.remove(node.page.id)
                }
            }
        )
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
