import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let outputURL = root.appendingPathComponent("docs/assets/shelf-social-preview.png")
let iconURL = root.appendingPathComponent("assets/app-icon.png")
let screenshotURL = root.appendingPathComponent("docs/assets/shelf-studio-pdf.png")

guard
  let icon = NSImage(contentsOf: iconURL),
  let screenshot = NSImage(contentsOf: screenshotURL)
else {
  fputs("Missing source image assets.\n", stderr)
  exit(1)
}

let width = 1280
let height = 640
let bitmap = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: width,
  pixelsHigh: height,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
)!

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

let canvas = NSRect(x: 0, y: 0, width: width, height: height)
NSColor(calibratedRed: 0.965, green: 0.963, blue: 0.948, alpha: 1).setFill()
canvas.fill()

let gradient = NSGradient(colors: [
  NSColor(calibratedRed: 0.99, green: 0.985, blue: 0.965, alpha: 1),
  NSColor(calibratedRed: 0.91, green: 0.925, blue: 0.925, alpha: 1),
])!
gradient.draw(in: canvas, angle: 0)

NSColor(calibratedWhite: 0.12, alpha: 0.08).setStroke()
let gridPath = NSBezierPath()
gridPath.lineWidth = 1
for x in stride(from: 0, through: width, by: 40) {
  gridPath.move(to: NSPoint(x: x, y: 0))
  gridPath.line(to: NSPoint(x: x, y: height))
}
for y in stride(from: 0, through: height, by: 40) {
  gridPath.move(to: NSPoint(x: 0, y: y))
  gridPath.line(to: NSPoint(x: width, y: y))
}
gridPath.stroke()

func drawText(_ text: String, in rect: NSRect, size: CGFloat, weight: NSFont.Weight, color: NSColor, lineHeight: CGFloat? = nil) {
  let paragraph = NSMutableParagraphStyle()
  paragraph.lineBreakMode = .byWordWrapping
  if let lineHeight {
    paragraph.minimumLineHeight = lineHeight
    paragraph.maximumLineHeight = lineHeight
  }

  let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: size, weight: weight),
    .foregroundColor: color,
    .paragraphStyle: paragraph,
  ]
  NSAttributedString(string: text, attributes: attributes).draw(in: rect)
}

func fillRoundedRect(_ rect: NSRect, radius: CGFloat, color: NSColor) {
  color.setFill()
  NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
}

func strokeRoundedRect(_ rect: NSRect, radius: CGFloat, color: NSColor, lineWidth: CGFloat) {
  let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
  path.lineWidth = lineWidth
  color.setStroke()
  path.stroke()
}

let iconFrame = NSRect(x: 82, y: 486, width: 86, height: 86)
let iconShadow = NSShadow()
iconShadow.shadowColor = NSColor.black.withAlphaComponent(0.12)
iconShadow.shadowBlurRadius = 18
iconShadow.shadowOffset = NSSize(width: 0, height: -6)
iconShadow.set()
fillRoundedRect(iconFrame, radius: 19, color: .white)
NSShadow().set()
icon.draw(in: iconFrame.insetBy(dx: 10, dy: 10), from: .zero, operation: .sourceOver, fraction: 1)

drawText(
  "Shelf",
  in: NSRect(x: 82, y: 392, width: 390, height: 78),
  size: 58,
  weight: .bold,
  color: NSColor(calibratedWhite: 0.07, alpha: 1)
)
drawText(
  "Local-first desktop workspace for notes, PDFs, study, and research.",
  in: NSRect(x: 86, y: 290, width: 392, height: 118),
  size: 26,
  weight: .medium,
  color: NSColor(calibratedWhite: 0.18, alpha: 1),
  lineHeight: 34
)

let badges = ["Notes", "PDF Studio", "SQLite", "No cloud account"]
var badgeX: CGFloat = 86
var badgeY: CGFloat = 226
for badge in badges {
  let textWidth = ceil((badge as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 17, weight: .semibold)]).width)
  let badgeWidth = textWidth + 28
  if badgeX + badgeWidth > 470 {
    badgeX = 86
    badgeY -= 48
  }
  let badgeRect = NSRect(x: badgeX, y: badgeY, width: badgeWidth, height: 34)
  fillRoundedRect(badgeRect, radius: 17, color: NSColor.white.withAlphaComponent(0.82))
  strokeRoundedRect(badgeRect, radius: 17, color: NSColor(calibratedWhite: 0.1, alpha: 0.09), lineWidth: 1)
  drawText(badge, in: NSRect(x: badgeX + 14, y: badgeY + 7, width: badgeWidth - 28, height: 22), size: 17, weight: .semibold, color: NSColor(calibratedWhite: 0.17, alpha: 1))
  badgeX += badgeWidth + 10
}

let panelFrame = NSRect(x: 520, y: 78, width: 682, height: 484)
let panelShadow = NSShadow()
panelShadow.shadowColor = NSColor.black.withAlphaComponent(0.22)
panelShadow.shadowBlurRadius = 38
panelShadow.shadowOffset = NSSize(width: 0, height: -18)
panelShadow.set()
fillRoundedRect(panelFrame, radius: 24, color: .white)
NSShadow().set()

let topBar = NSRect(x: panelFrame.minX, y: panelFrame.maxY - 46, width: panelFrame.width, height: 46)
fillRoundedRect(panelFrame, radius: 24, color: .white)
NSColor(calibratedWhite: 0.96, alpha: 1).setFill()
topBar.fill()

for index in 0..<3 {
  NSColor(calibratedWhite: 0.74 - CGFloat(index) * 0.08, alpha: 1).setFill()
  NSBezierPath(ovalIn: NSRect(x: panelFrame.minX + 22 + CGFloat(index) * 22, y: panelFrame.maxY - 28, width: 10, height: 10)).fill()
}

let screenshotFrame = NSRect(x: panelFrame.minX + 16, y: panelFrame.minY + 16, width: panelFrame.width - 32, height: panelFrame.height - 62)
NSGraphicsContext.saveGraphicsState()
NSBezierPath(roundedRect: screenshotFrame, xRadius: 14, yRadius: 14).addClip()
let sourceCrop = NSRect(
  x: 0,
  y: 132,
  width: screenshot.size.width,
  height: screenshot.size.height - 204
)
screenshot.draw(in: screenshotFrame, from: sourceCrop, operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
strokeRoundedRect(panelFrame, radius: 24, color: NSColor(calibratedWhite: 0.1, alpha: 0.12), lineWidth: 1)

drawText(
  "Open source · MIT",
  in: NSRect(x: 86, y: 82, width: 320, height: 28),
  size: 20,
  weight: .semibold,
  color: NSColor(calibratedWhite: 0.22, alpha: 1)
)

NSGraphicsContext.restoreGraphicsState()

guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
  fputs("Could not encode PNG.\n", stderr)
  exit(1)
}

try pngData.write(to: outputURL)
print(outputURL.path)
