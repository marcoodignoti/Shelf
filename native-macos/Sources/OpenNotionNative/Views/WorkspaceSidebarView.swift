import OpenNotionCore
import SwiftUI

struct WorkspaceSidebarView: View {
    let store: WorkspaceStore
    @State private var newWorkspaceName = ""

    var body: some View {
        VStack(spacing: 0) {
            TextField("Search notes, URLs, titles", text: Binding(
                get: { store.searchQuery },
                set: { store.searchQuery = $0 }
            ))
            .textFieldStyle(.roundedBorder)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)

            Divider()

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    sidebarSections
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 14)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.leading, 112)
    }

    @ViewBuilder
    private var sidebarSections: some View {
            if !store.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                SidebarSection("Results") {
                    ForEach(store.searchResults) { page in
                        researchPageButton(page)
                    }
                }
            }

            SidebarSection("Workspaces") {
                ForEach(store.workspaces) { workspace in
                    Button {
                        store.selectWorkspace(workspace)
                    } label: {
                        Label(
                            workspace.name,
                            systemImage: workspace.id == store.selectedWorkspace?.id ? "folder.fill" : "folder"
                        )
                        .lineLimit(1)
                    }
                    .buttonStyle(.plain)
                }

                HStack(spacing: 6) {
                    TextField("New workspace", text: $newWorkspaceName)
                        .textFieldStyle(.plain)
                        .onSubmit(createWorkspace)
                    Button(action: createWorkspace) {
                        Image(systemName: "plus")
                    }
                    .buttonStyle(.borderless)
                    .help("Create Workspace")
                }
            }

            if !store.workspacePages.isEmpty {
                SidebarSection("Pages") {
                    ForEach(store.workspacePages) { page in
                        researchPageButton(page)
                    }
                }
            }

            if !store.recentPages.isEmpty {
                SidebarSection("Recent") {
                    ForEach(store.recentPages) { page in
                        researchPageButton(page)
                    }
                }
            }

            if !store.favoritePages.isEmpty {
                SidebarSection("Favorites") {
                    ForEach(store.favoritePages) { page in
                        researchPageButton(page)
                    }
                }
            }

            SidebarSection("Archive") {
                if store.archivedPages.isEmpty {
                    Text("No archived sources")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(store.archivedPages) { page in
                        researchPageButton(page)
                    }
                }
            }

            SidebarSection("Settings") {
                Label("Research Workspace", systemImage: "gearshape")
                    .foregroundStyle(.secondary)
            }
    }

    private func createWorkspace() {
        if store.createWorkspace(named: newWorkspaceName) {
            newWorkspaceName = ""
        }
    }

    private func researchPageButton(_ page: ResearchPage) -> some View {
        Button {
            store.selectPage(page)
        } label: {
            ResearchPageRow(page: page, isSelected: page.id == store.currentPage?.id)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(page.isFavorite ? "Remove from Favorites" : "Add to Favorites") {
                store.toggleFavorite(pageID: page.id)
            }

            if page.isArchived {
                Button("Restore") {
                    store.restore(pageID: page.id)
                }
            } else {
                Button("Archive") {
                    store.archive(pageID: page.id)
                }
            }
        }
    }
}

private struct SidebarSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            VStack(alignment: .leading, spacing: 6) {
                content
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ResearchPageRow: View {
    let page: ResearchPage
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: page.isFavorite ? "star.fill" : "globe")
                .foregroundStyle(page.isFavorite ? .yellow : .secondary)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(page.title.isEmpty ? page.urlString : page.title)
                    .fontWeight(isSelected ? .semibold : .regular)
                    .lineLimit(1)
                Text(hostText)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .contentShape(Rectangle())
    }

    private var hostText: String {
        URL(string: page.urlString)?.host ?? page.urlString
    }
}
