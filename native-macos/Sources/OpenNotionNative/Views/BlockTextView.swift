import AppKit
import SwiftUI

enum BlockTextCommand {
    case insertNewline(Int)
    case deleteBackwardAtBeginning
    case moveToPreviousBlock
    case moveToNextBlock
    case moveToPreviousMenuItem
    case moveToNextMenuItem
    case cancelMenu
}

struct BlockTextView: NSViewRepresentable {
    @Binding var text: String
    @Binding var measuredHeight: CGFloat
    let isFocused: Bool
    let font: NSFont
    let textColor: NSColor
    let isEditable: Bool
    let onFocus: () -> Void
    let onCommand: (BlockTextCommand) -> Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> EditorNSTextView {
        let textView = EditorNSTextView(frame: .zero)
        textView.delegate = context.coordinator
        textView.drawsBackground = false
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.textContainerInset = NSSize(width: 0, height: 4)
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = true
        textView.autoresizingMask = [.width]
        textView.commandHandler = context.coordinator.handle
        textView.focusHandler = context.coordinator.focus
        textView.setLayoutHandler { textView in
            context.coordinator.updateMeasuredHeight(for: textView)
        }
        return textView
    }

    func updateNSView(_ textView: EditorNSTextView, context: Context) {
        context.coordinator.parent = self
        textView.commandHandler = context.coordinator.handle
        textView.focusHandler = context.coordinator.focus
        textView.setLayoutHandler { textView in
            context.coordinator.updateMeasuredHeight(for: textView)
        }
        textView.font = font
        textView.textColor = textColor
        textView.isEditable = isEditable
        textView.isSelectable = isEditable

        if textView.string != text {
            textView.string = text
        }

        DispatchQueue.main.async {
            context.coordinator.updateMeasuredHeight(for: textView)

            guard isFocused,
                  textView.window?.firstResponder !== textView else {
                return
            }

            textView.window?.makeFirstResponder(textView)
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: BlockTextView

        init(_ parent: BlockTextView) {
            self.parent = parent
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView,
                  parent.text != textView.string else {
                return
            }
            parent.text = textView.string
            updateMeasuredHeight(for: textView)
        }

        func textDidBeginEditing(_ notification: Notification) {
            parent.onFocus()
        }

        func handle(_ command: BlockTextCommand) -> Bool {
            parent.onCommand(command)
        }

        func focus() {
            parent.onFocus()
        }

        func updateMeasuredHeight(for textView: NSTextView) {
            guard let layoutManager = textView.layoutManager,
                  let textContainer = textView.textContainer else {
                return
            }

            textContainer.containerSize = NSSize(
                width: max(textView.bounds.width, 1),
                height: CGFloat.greatestFiniteMagnitude
            )
            layoutManager.ensureLayout(for: textContainer)

            let usedRect = layoutManager.usedRect(for: textContainer)
            let measuredHeight = ceil(usedRect.height + textView.textContainerInset.height * 2)
            let minimumHeight = ceil((textView.font ?? parent.font).pointSize + 8)
            let nextHeight = max(measuredHeight, minimumHeight)

            guard abs(parent.measuredHeight - nextHeight) > 0.5 else {
                return
            }
            parent.measuredHeight = nextHeight
        }
    }
}

final class EditorNSTextView: NSTextView {
    var commandHandler: ((BlockTextCommand) -> Bool)?
    var focusHandler: (() -> Void)?
    private var layoutHandler: (() -> Void)?

    func setLayoutHandler(_ handler: @escaping (EditorNSTextView) -> Void) {
        layoutHandler = { [weak self] in
            guard let self else {
                return
            }
            handler(self)
        }
    }

    override func becomeFirstResponder() -> Bool {
        let didBecomeFirstResponder = super.becomeFirstResponder()
        if didBecomeFirstResponder {
            focusHandler?()
        }
        return didBecomeFirstResponder
    }

    override func layout() {
        super.layout()
        layoutHandler?()
    }

    override func doCommand(by selector: Selector) {
        let range = selectedRange()

        switch selector {
        case #selector(insertNewline(_:)):
            if commandHandler?(.insertNewline(range.location)) == true {
                return
            }
        case #selector(deleteBackward(_:)):
            if range.location == 0,
               range.length == 0,
               commandHandler?(.deleteBackwardAtBeginning) == true {
                return
            }
        case #selector(moveUp(_:)):
            if commandHandler?(.moveToPreviousMenuItem) == true {
                return
            }

            if range.location == 0,
               commandHandler?(.moveToPreviousBlock) == true {
                return
            }
        case #selector(moveDown(_:)):
            if commandHandler?(.moveToNextMenuItem) == true {
                return
            }

            if NSMaxRange(range) >= string.utf16.count,
               commandHandler?(.moveToNextBlock) == true {
                return
            }
        case #selector(cancelOperation(_:)):
            if commandHandler?(.cancelMenu) == true {
                return
            }
        default:
            break
        }

        super.doCommand(by: selector)
    }
}
