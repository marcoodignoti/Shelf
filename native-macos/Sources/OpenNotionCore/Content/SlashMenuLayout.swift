import Foundation

public enum SlashMenuLayout {
    public static func previewTopOffset(
        selectedIndex: Int?,
        rowHeight: Double,
        maxVisibleOffset: Double
    ) -> Double {
        let index = max(selectedIndex ?? 0, 0)
        let preferredOffset = 40 + Double(index) * rowHeight
        return min(preferredOffset, maxVisibleOffset)
    }
}
