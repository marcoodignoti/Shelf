import AppKit
import OpenNotionCore
import SwiftUI
import UniformTypeIdentifiers

struct PageEditorView: View {
    let page: Page
    let onSave: (String, BlockDocument) -> Bool
    let onSaveMetadata: (String?, String?) -> Bool
    let onImportCoverImage: (URL, String?) -> String?
    let onToggleFavorite: () -> Bool
    let onDuplicate: () -> Bool
    let onCreateSubpage: () -> Void
    let onDelete: () -> Void

    @State private var draft: PageEditorDraft
    @State private var draftIcon: String
    @State private var draftCoverURL: String
    @State private var focusedBlockID: String?
    @State private var autosaveTask: Task<Void, Never>?
    @State private var saveState = PageEditorSaveState.saved
    @State private var didCopyLink = false
    @State private var isIconPickerPresented = false
    @State private var isCoverURLFieldPresented = false
    @State private var isHeaderHovering = false
    @State private var isIconHovering = false
    @FocusState private var isTitleFocused: Bool

    private let startsAsUntitledEmptyPage: Bool

    private var hasUnsupportedBlocks: Bool {
        draft.document.blocks.contains { $0.kind.isUnsupported }
    }

    init(
        page: Page,
        onSave: @escaping (String, BlockDocument) -> Bool,
        onSaveMetadata: @escaping (String?, String?) -> Bool,
        onImportCoverImage: @escaping (URL, String?) -> String?,
        onToggleFavorite: @escaping () -> Bool,
        onDuplicate: @escaping () -> Bool,
        onCreateSubpage: @escaping () -> Void,
        onDelete: @escaping () -> Void
    ) {
        let decodedDocument = (try? BlockNoteCodec.decode(page.content)) ?? .empty
        let isUntitledEmptyPage = page.title == "Untitled"
            && decodedDocument.blocks.allSatisfy { $0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let initialTitle = isUntitledEmptyPage ? "" : page.title
        self.page = page
        self.onSave = onSave
        self.onSaveMetadata = onSaveMetadata
        self.onImportCoverImage = onImportCoverImage
        self.onToggleFavorite = onToggleFavorite
        self.onDuplicate = onDuplicate
        self.onCreateSubpage = onCreateSubpage
        self.onDelete = onDelete
        self.startsAsUntitledEmptyPage = isUntitledEmptyPage
        _draft = State(initialValue: PageEditorDraft(
            title: initialTitle,
            document: decodedDocument,
            savedTitle: page.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Untitled" : page.title,
            savedDocument: decodedDocument
        ))
        _draftIcon = State(initialValue: page.icon ?? "")
        _draftCoverURL = State(initialValue: page.coverURL ?? "")
        _focusedBlockID = State(initialValue: isUntitledEmptyPage ? nil : decodedDocument.blocks.first?.id)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let coverURL = normalizedCoverURL(draftCoverURL) {
                PageCoverHeader(
                    coverURL: coverURL,
                    onChangeCover: chooseCoverImage,
                    onRemoveCover: removeCover
                )
                .frame(maxWidth: 760)
                .padding(.horizontal, 48)
                .padding(.top, 72)
                .padding(.bottom, 26)
                .frame(maxWidth: .infinity, alignment: .center)
            }

            VStack(alignment: .leading, spacing: 14) {
                pageMetadataControls

                if let icon = normalizedPageIcon(draftIcon) {
                    Button {
                        isIconPickerPresented.toggle()
                    } label: {
                        Text(icon)
                            .font(.system(size: 48))
                            .frame(width: 58, height: 58)
                            .contentShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .background(isIconHovering ? Color.secondary.opacity(0.10) : Color.primary.opacity(0.001))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .onHover { hovering in
                        withAnimation(.easeInOut(duration: 0.12)) {
                            isIconHovering = hovering
                        }
                    }
                    .popover(isPresented: $isIconPickerPresented) {
                        IconPicker(
                            icon: $draftIcon,
                            onSelect: selectIcon,
                            onChange: updateIcon,
                            onRemove: removeIcon
                        )
                    }
                }

                ZStack(alignment: .leading) {
                    if draft.title.isEmpty {
                        Text(startsAsUntitledEmptyPage ? "New page" : "Untitled")
                            .font(.system(size: 44, weight: .bold, design: .default))
                            .foregroundStyle(Color.primary.opacity(0.12))
                            .allowsHitTesting(false)
                    }

                    TextField("", text: $draft.title)
                        .textFieldStyle(.plain)
                        .font(.system(size: 44, weight: .bold, design: .default))
                        .focused($isTitleFocused)
                        .onSubmit {
                            focusFirstBodyBlock()
                        }
                        .onTapGesture {
                            focusedBlockID = nil
                        }
                }

                if page.isDatabase == 1 {
                    Label("Database view comes in phase 2. Page content and metadata are safe to edit here.", systemImage: "tablecells")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                if hasUnsupportedBlocks {
                    Label("Unsupported blocks are preserved and locked in place.", systemImage: "lock.doc")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .padding(.horizontal, 48)
            .padding(.top, normalizedCoverURL(draftCoverURL) == nil ? 128 : 0)
            .padding(.bottom, 18)
            .frame(maxWidth: .infinity, alignment: .center)
            .onHover { hovering in
                withAnimation(.easeInOut(duration: 0.12)) {
                    isHeaderHovering = hovering
                }
            }

            BlockEditorView(document: $draft.document, focusedBlockID: $focusedBlockID)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onChange(of: draft.title) { _, _ in
            scheduleAutosave()
        }
        .onChange(of: draft.document) { _, _ in
            scheduleAutosave()
        }
        .onDisappear {
            autosaveTask?.cancel()
            saveNow()
        }
        .onAppear {
            if startsAsUntitledEmptyPage {
                focusedBlockID = nil
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    focusedBlockID = nil
                    isTitleFocused = true
                }
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    saveNow()
                } label: {
                    Label("Save", systemImage: "square.and.arrow.down")
                }
                .keyboardShortcut("s")

                Text(saveState.label)
                    .font(.caption)
                    .foregroundStyle(saveState == .failed ? Color.red : Color.secondary)

                Button {
                    copyPageLink()
                } label: {
                    Label(didCopyLink ? "Copied" : "Copy Link", systemImage: didCopyLink ? "checkmark" : "link")
                }
                .help("Copy link")

                Button {
                    _ = onToggleFavorite()
                } label: {
                    Label(page.isFavorite == 1 ? "Remove Favorite" : "Favorite", systemImage: page.isFavorite == 1 ? "star.fill" : "star")
                }
                .help(page.isFavorite == 1 ? "Remove from favorites" : "Add to favorites")

                Menu {
                    Button("New Subpage") {
                        onCreateSubpage()
                    }

                    Button("Duplicate") {
                        _ = onDuplicate()
                    }

                    Divider()

                    Button("Move to Trash", role: .destructive) {
                        onDelete()
                    }
                } label: {
                    Label("More", systemImage: "ellipsis.circle")
                }
                .help("More")
            }
        }
    }

    private func scheduleAutosave() {
        autosaveTask?.cancel()
        guard draft.isDirty else {
            saveState = .saved
            return
        }

        saveState = .unsaved
        autosaveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 700_000_000)
            guard !Task.isCancelled else {
                return
            }
            saveNow()
        }
    }

    private func saveNow() {
        autosaveTask?.cancel()
        guard draft.isDirty else {
            saveState = .saved
            return
        }

        saveState = .saving
        if onSave(draft.persistedTitle, draft.document) {
            draft.markSaved()
            saveState = .saved
        } else {
            saveState = .failed
        }
    }

    private var pageMetadataControls: some View {
        let opacity = pageMetadataControlsOpacity(
            isHovering: isHeaderHovering,
            isIconPickerPresented: isIconPickerPresented,
            isCoverURLFieldPresented: isCoverURLFieldPresented
        )

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if normalizedPageIcon(draftIcon) == nil {
                    Button {
                        isIconPickerPresented.toggle()
                    } label: {
                        Label("Add icon", systemImage: "face.smiling")
                    }
                    .popover(isPresented: $isIconPickerPresented) {
                        IconPicker(
                            icon: $draftIcon,
                            onSelect: selectIcon,
                            onChange: updateIcon,
                            onRemove: removeIcon
                        )
                    }
                }

                Button {
                    chooseCoverImage()
                } label: {
                    Label(normalizedCoverURL(draftCoverURL) == nil ? "Add cover" : "Change cover", systemImage: "photo")
                }

                Button {
                    isCoverURLFieldPresented.toggle()
                } label: {
                    Label("Cover URL", systemImage: "link")
                }

                if normalizedCoverURL(draftCoverURL) != nil {
                    Button(role: .destructive) {
                        removeCover()
                    } label: {
                        Label("Remove cover", systemImage: "xmark")
                    }
                }
            }
            .buttonStyle(.borderless)
            .font(.caption)
            .foregroundStyle(.secondary)

            if isCoverURLFieldPresented {
                HStack(spacing: 8) {
                    Image(systemName: "photo")
                        .foregroundStyle(.secondary)
                    TextField("Paste cover image URL", text: $draftCoverURL)
                        .textFieldStyle(.plain)
                        .onChange(of: draftCoverURL) { _, value in
                            updateCoverURL(value)
                        }
                    if normalizedCoverURL(draftCoverURL) != nil {
                        Button {
                            removeCover()
                        } label: {
                            Image(systemName: "xmark")
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                        .help("Remove cover")
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(.background)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.secondary.opacity(0.18))
                )
            }
        }
        .opacity(opacity)
        .allowsHitTesting(opacity > 0)
        .animation(.easeInOut(duration: 0.12), value: opacity)
    }

    private func updateIcon(_ value: String) {
        let nextIcon = normalizedPageIcon(value) ?? ""
        if draftIcon != nextIcon {
            draftIcon = nextIcon
        }
        saveMetadata(icon: normalizedPageIcon(nextIcon), coverURL: normalizedCoverURL(draftCoverURL))
    }

    private func selectIcon(_ value: String) {
        updateIcon(value)
        isIconPickerPresented = false
    }

    private func removeIcon() {
        draftIcon = ""
        isIconPickerPresented = false
        saveMetadata(icon: nil, coverURL: normalizedCoverURL(draftCoverURL))
    }

    private func updateCoverURL(_ value: String) {
        saveMetadata(icon: normalizedPageIcon(draftIcon), coverURL: normalizedCoverURL(value))
    }

    private func removeCover() {
        draftCoverURL = ""
        isCoverURLFieldPresented = false
        saveMetadata(icon: normalizedPageIcon(draftIcon), coverURL: nil)
    }

    private func chooseCoverImage() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = ["png", "jpg", "jpeg", "webp", "gif"].compactMap { UTType(filenameExtension: $0) }
        panel.begin { response in
            guard response == .OK, let url = panel.url else {
                return
            }
            Task { @MainActor in
                if let importedCoverURL = onImportCoverImage(url, normalizedPageIcon(draftIcon)) {
                    draftCoverURL = importedCoverURL
                    isCoverURLFieldPresented = false
                    saveState = .saved
                } else {
                    saveState = .failed
                }
            }
        }
    }

    @discardableResult
    private func saveMetadata(icon: String?, coverURL: String?) -> Bool {
        let didSave = onSaveMetadata(icon, coverURL)
        saveState = didSave ? .saved : .failed
        return didSave
    }

    private func copyPageLink() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString("opennotion://page/\(page.id)", forType: .string)
        didCopyLink = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            didCopyLink = false
        }
    }

    private func focusFirstBodyBlock() {
        isTitleFocused = false
        focusedBlockID = PageEditorFocus.firstEditableBlockID(in: draft.document)
    }
}

private let pageIconOptions = ["📄", "✅", "💡", "📌", "🚀", "🧠", "🛠️", "📚", "🎯", "✨", "🔥", "📝"]

private func normalizedPageIcon(_ value: String) -> String? {
    let icon = String(value.trimmingCharacters(in: .whitespacesAndNewlines).prefix(8))
    return icon.isEmpty ? nil : icon
}

private func normalizedCoverURL(_ value: String) -> String? {
    let coverURL = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return coverURL.isEmpty ? nil : coverURL
}

func pageMetadataControlsOpacity(
    isHovering: Bool,
    isIconPickerPresented: Bool,
    isCoverURLFieldPresented: Bool
) -> Double {
    if isHovering || isIconPickerPresented || isCoverURLFieldPresented {
        return 1
    }
    return 0
}

func coverActionsOpacity(isHovering: Bool) -> Double {
    isHovering ? 1 : 0
}

private struct IconPicker: View {
    @Binding var icon: String
    let onSelect: (String) -> Void
    let onChange: (String) -> Void
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(34), spacing: 6), count: 6), spacing: 6) {
                ForEach(pageIconOptions, id: \.self) { option in
                    Button {
                        onSelect(option)
                    } label: {
                        Text(option)
                            .font(.title3)
                            .frame(width: 34, height: 34)
                    }
                    .buttonStyle(.plain)
                    .background(Color.secondary.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                }
            }

            HStack(spacing: 8) {
                Image(systemName: "face.smiling")
                    .foregroundStyle(.secondary)
                TextField("Custom icon", text: $icon)
                    .textFieldStyle(.plain)
                    .onChange(of: icon) { _, value in
                        onChange(value)
                    }
                if normalizedPageIcon(icon) != nil {
                    Button {
                        onRemove()
                    } label: {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .help("Remove icon")
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(.background)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.secondary.opacity(0.18))
            )
        }
        .padding(10)
        .frame(width: 270)
    }
}

private struct PageCoverHeader: View {
    let coverURL: String
    let onChangeCover: () -> Void
    let onRemoveCover: () -> Void
    @State private var isHovering = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            CoverImageView(coverURL: coverURL)
                .frame(height: 180)
                .frame(maxWidth: .infinity)
                .background(Color.secondary.opacity(0.12))

            HStack(spacing: 6) {
                Button("Change cover") {
                    onChangeCover()
                }
                Button {
                    onRemoveCover()
                } label: {
                    Image(systemName: "xmark")
                }
                .help("Remove cover")
            }
            .buttonStyle(.borderless)
            .font(.caption)
            .padding(8)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .padding(10)
            .opacity(coverActionsOpacity(isHovering: isHovering))
            .allowsHitTesting(isHovering)
            .animation(.easeInOut(duration: 0.12), value: isHovering)
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.12)) {
                isHovering = hovering
            }
        }
    }
}

private struct CoverImageView: View {
    let coverURL: String

    var body: some View {
        if let url = URL(string: coverURL), url.isFileURL, let image = NSImage(contentsOf: url) {
            Image(nsImage: image)
                .resizable()
                .scaledToFill()
        } else if let url = URL(string: coverURL), !url.isFileURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case let .success(image):
                    image.resizable().scaledToFill()
                case .failure:
                    coverPlaceholder
                case .empty:
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                @unknown default:
                    coverPlaceholder
                }
            }
        } else if let image = NSImage(contentsOfFile: coverURL) {
            Image(nsImage: image)
                .resizable()
                .scaledToFill()
        } else {
            coverPlaceholder
        }
    }

    private var coverPlaceholder: some View {
        ZStack {
            Color.secondary.opacity(0.12)
            Image(systemName: "photo")
                .font(.title)
                .foregroundStyle(.secondary)
        }
    }
}

private enum PageEditorSaveState {
    case saved
    case unsaved
    case saving
    case failed

    var label: String {
        switch self {
        case .saved:
            return "Saved"
        case .unsaved:
            return "Unsaved"
        case .saving:
            return "Saving..."
        case .failed:
            return "Save failed"
        }
    }
}

private struct BlockEditorView: View {
    @Binding var document: BlockDocument
    @Binding var focusedBlockID: String?
    @State private var draggingBlockID: String?
    @State private var activeDropLocation: BlockDropLocation?
    @State private var selectionOffsets: [String: Int] = [:]
    @State private var undoStack = BlockEditorUndoStack()

    var body: some View {
        ScrollViewReader { scrollProxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 4) {
                    ForEach(document.blocks) { block in
                        VStack(alignment: .leading, spacing: 0) {
                            BlockDropIndicator(isActive: activeDropLocation == .before(block.id))

                            BlockRowView(
                                block: binding(for: block.id),
                                document: $document,
                                focusedBlockID: $focusedBlockID,
                                draggingBlockID: $draggingBlockID,
                                activeDropLocation: $activeDropLocation,
                                selectionOffsets: $selectionOffsets,
                                undoStack: $undoStack,
                                prefix: prefix(for: block)
                            ) { id, anchor in
                                requestScroll(to: id, anchor: anchor, using: scrollProxy)
                            }
                        }
                        .id(block.id)
                    }

                    BlockDropIndicator(isActive: activeDropLocation == .end)

                    Color.clear
                        .frame(height: 24)
                        .onDrop(
                            of: BlockDragPasteboard.typeIdentifiers,
                            delegate: BlockEndDropDelegate(
                                document: $document,
                                focusedBlockID: $focusedBlockID,
                                draggingBlockID: $draggingBlockID,
                                activeDropLocation: $activeDropLocation
                            )
                        )
                }
                .padding(.horizontal, 40)
                .padding(.bottom, activeSlashBlockID == nil ? 48 : 220)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
            }
            .background(Color(nsColor: .textBackgroundColor))
            .onChange(of: focusedBlockID) { _, id in
                guard let id else {
                    return
                }
                requestScroll(to: id, anchor: .center, using: scrollProxy)
            }
            .onChange(of: activeSlashBlockID) { _, id in
                guard let id else {
                    return
                }
                requestScroll(to: id, anchor: .center, using: scrollProxy)
            }
        }
    }

    private func binding(for id: String) -> Binding<Block> {
        Binding(
            get: {
                document.blocks.first { $0.id == id }
                    ?? Block(id: id, kind: .paragraph, text: "", rawJSON: nil)
            },
            set: { newValue in
                guard let index = document.blocks.firstIndex(where: { $0.id == id }) else {
                    return
                }
                document.blocks[index] = newValue
            }
        )
    }

    private func prefix(for block: Block) -> EditorBlockPrefix {
        switch block.kind {
        case .bulletListItem:
            return .bullet
        case .numberedListItem:
            return .number(numberedOrdinal(for: block.id))
        case let .checkListItem(checked):
            return .checklist(checked)
        default:
            return .none
        }
    }

    private func numberedOrdinal(for id: String) -> Int {
        guard let index = document.blocks.firstIndex(where: { $0.id == id }) else {
            return 1
        }

        var ordinal = 1
        var cursor = index - 1
        while cursor >= 0 {
            guard case .numberedListItem = document.blocks[cursor].kind else {
                break
            }
            ordinal += 1
            cursor -= 1
        }
        return ordinal
    }

    private var activeSlashBlockID: String? {
        guard let focusedBlockID,
              let block = document.blocks.first(where: { $0.id == focusedBlockID }),
              block.kind.acceptsText,
              block.kind != .code else {
            return nil
        }

        let trimmed = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("/"),
              trimmed.count <= 24 else {
            return nil
        }
        return focusedBlockID
    }

    private func requestScroll(to id: String, anchor: UnitPoint, using proxy: ScrollViewProxy) {
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.16)) {
                proxy.scrollTo(id, anchor: anchor)
            }
        }
    }
}
