import OpenNotionCore
import SwiftUI

struct ResearchNotePanel: View {
    let store: WorkspaceStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let page = store.currentPage {
                noteEditor(for: page, note: store.currentNote)
            } else {
                emptyState
            }
        }
        .frame(minWidth: 300, idealWidth: 340, maxWidth: 440)
        .background(Color(nsColor: .textBackgroundColor))
    }

    private func noteEditor(for page: ResearchPage, note: ResearchNote?) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(page.title.isEmpty ? page.urlString : page.title)
                    .font(.headline)
                    .lineLimit(2)
                Text(page.urlString)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .textSelection(.enabled)
            }

            LabeledField(title: "Tags") {
                TextField("research, robotics, paper", text: Binding(
                    get: { store.tagsText(for: note) },
                    set: { store.updateCurrentNoteTags($0) }
                ))
                .textFieldStyle(.roundedBorder)
            }

            LabeledField(title: "Notes") {
                TextEditor(text: Binding(
                    get: { note?.body ?? "" },
                    set: { store.updateCurrentNoteBody($0) }
                ))
                .font(.body)
                .frame(minHeight: 180)
                .scrollContentBackground(.hidden)
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            LabeledField(title: "Checklist") {
                TextEditor(text: Binding(
                    get: { store.checklistText(for: note) },
                    set: { store.updateCurrentNoteChecklist($0) }
                ))
                .frame(minHeight: 82)
                .scrollContentBackground(.hidden)
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            LabeledField(title: "Citations") {
                TextEditor(text: Binding(
                    get: { store.citationsText(for: note) },
                    set: { store.updateCurrentNoteCitations($0) }
                ))
                .frame(minHeight: 72)
                .scrollContentBackground(.hidden)
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            relatedNotes(for: note)

            Spacer(minLength: 0)
        }
        .padding(18)
    }

    private func relatedNotes(for note: ResearchNote?) -> some View {
        let relatedPages = store.relatedPages(for: note)
        return LabeledField(title: "Linked Notes") {
            if relatedPages.isEmpty {
                Text("No linked notes")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(relatedPages.prefix(4)) { page in
                        Button {
                            store.selectPage(page)
                        } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "link")
                                    .foregroundStyle(.secondary)
                                Text(page.title.isEmpty ? page.urlString : page.title)
                                    .lineLimit(1)
                                Spacer()
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "note.text")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text("No linked page")
                .font(.headline)
            Text("Open a source to start writing notes tied to its URL.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 260)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }
}

private struct LabeledField<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(.secondary)
            content
        }
    }
}
