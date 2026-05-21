import OpenNotionCore
import SwiftUI

struct PageEditorView: View {
    let page: Page
    let onSave: (String, String) -> Void

    private let hasUnsupportedBlocks: Bool
    @State private var title: String
    @State private var text: String

    init(page: Page, onSave: @escaping (String, String) -> Void) {
        self.page = page
        self.onSave = onSave
        self.hasUnsupportedBlocks = BlockNoteCodec.hasUnsupportedBlocks(page.content)
        _title = State(initialValue: page.title)
        _text = State(initialValue: BlockNoteCodec.plainText(from: page.content))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                TextField("Untitled", text: $title)
                    .textFieldStyle(.plain)
                    .font(.system(size: 34, weight: .bold, design: .default))

                if page.isDatabase == 1 {
                    Label("Database view comes in phase 2. Page content and metadata are safe to edit here.", systemImage: "tablecells")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                if hasUnsupportedBlocks {
                    Label("This page contains unsupported blocks. The beta preserves content and saves title changes only.", systemImage: "lock.doc")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 44)
            .padding(.top, 36)
            .padding(.bottom, 20)

            TextEditor(text: $text)
                .font(.system(size: 16, design: .default))
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 40)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .disabled(hasUnsupportedBlocks)
        }
        .toolbar {
            ToolbarItemGroup {
                Button("Save") {
                    onSave(title, text)
                }
                .keyboardShortcut("s")
            }
        }
    }
}
