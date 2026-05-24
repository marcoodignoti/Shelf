import AppKit
import SwiftUI

enum BlockTextCommand: Equatable {
    case insertNewline(Int)
    case deleteBackwardAtBeginning
    case moveToPreviousBlock
    case moveToNextBlock
    case moveToPreviousMenuItem
    case moveToNextMenuItem
    case applyMarkdownShortcut
    case cancelMenu
    case undoStructuralEdit
}

struct BlockTextView: NSViewRepresentable {
    @Binding var text: String
    @Binding var measuredHeight: CGFloat
    let isFocused: Bool
    let selectionOffset: Int?
    let font: NSFont
    let textColor: NSColor
    let isEditable: Bool
    let onFocus: () -> Void
    let onSelectionApplied: () -> Void
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
                if isFocused, let selectionOffset {
                    textView.setSelectedUTF16Offset(selectionOffset)
                    onSelectionApplied()
                }
                return
            }

            textView.window?.makeFirstResponder(textView)
            if let selectionOffset {
                textView.setSelectedUTF16Offset(selectionOffset)
                onSelectionApplied()
            }
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

    func setSelectedUTF16Offset(_ offset: Int) {
        let clampedOffset = min(max(offset, 0), string.utf16.count)
        setSelectedRange(NSRange(location: clampedOffset, length: 0))
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

    override func insertText(_ insertString: Any, replacementRange: NSRange) {
        let insertedText: String?
        if let string = insertString as? String {
            insertedText = string
        } else if let attributedString = insertString as? NSAttributedString {
            insertedText = attributedString.string
        } else {
            insertedText = nil
        }

        let range = selectedRange()
        if insertedText == " ",
           range.length == 0,
           range.location == string.utf16.count,
           commandHandler?(.applyMarkdownShortcut) == true {
            return
        }

        super.insertText(insertString, replacementRange: replacementRange)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if handlesStructuralUndo(event) {
            return true
        }

        return super.performKeyEquivalent(with: event)
    }

    override func keyDown(with event: NSEvent) {
        if handlesStructuralUndo(event) {
            return
        }

        super.keyDown(with: event)
    }

    private func handlesStructuralUndo(_ event: NSEvent) -> Bool {
        guard event.modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.command),
              event.charactersIgnoringModifiers?.lowercased() == "z" else {
            return false
        }

        return commandHandler?(.undoStructuralEdit) == true
    }
}
