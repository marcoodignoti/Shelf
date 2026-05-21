import Foundation

public struct PageTreeNode: Identifiable, Equatable, Sendable {
    public var id: String { page.id }
    public var page: Page
    public var children: [PageTreeNode]

    public init(page: Page, children: [PageTreeNode] = []) {
        self.page = page
        self.children = children
    }
}

public enum PageHierarchy {
    public static func tree(from pages: [Page]) -> [PageTreeNode] {
        let ids = Set(pages.map(\.id))
        var visitedIDs = Set<String>()
        let childrenByParentID = Dictionary(grouping: pages.filter { page in
            guard let parentID = page.parentID else {
                return false
            }
            return ids.contains(parentID)
        }, by: { $0.parentID ?? "" })

        func node(for page: Page, ancestors: Set<String> = []) -> PageTreeNode {
            visitedIDs.insert(page.id)
            let children = (childrenByParentID[page.id] ?? []).filter { child in
                !ancestors.contains(child.id) && child.id != page.id
            }

            return PageTreeNode(
                page: page,
                children: children.map { child in
                    node(for: child, ancestors: ancestors.union([page.id]))
                }
            )
        }

        var roots = pages
            .filter { page in
                guard let parentID = page.parentID else {
                    return true
                }
                return !ids.contains(parentID)
            }
            .map { node(for: $0) }

        let cycleFallbacks = pages
            .filter { !visitedIDs.contains($0.id) }
            .map { PageTreeNode(page: $0) }

        roots.append(contentsOf: cycleFallbacks)
        return roots
    }
}
