import Foundation

public enum CoverImageImportError: LocalizedError, Equatable {
    case unsupportedExtension
    case tooLarge
    case unsupportedContent
    case mismatchedExtension

    public var errorDescription: String? {
        switch self {
        case .unsupportedExtension:
            return "Cover image must be PNG, JPG, WebP, or GIF."
        case .tooLarge:
            return "Cover image must be 10 MB or smaller."
        case .unsupportedContent:
            return "Cover image content is not a supported image."
        case .mismatchedExtension:
            return "Cover image content does not match its extension."
        }
    }
}

public enum CoverImageImporter {
    public static let maxBytes: UInt64 = 10 * 1024 * 1024

    public static func importCoverImage(
        sourceURL: URL,
        pageID: String,
        applicationSupportDirectory: URL? = nil,
        fileManager: FileManager = .default
    ) throws -> String {
        let extensionName = try validatedExtension(for: sourceURL, fileManager: fileManager)
        let root = try applicationSupportDirectory ?? ApplicationSupportResolver.defaultDirectory(fileManager: fileManager)
        let coversDirectory = root.appendingPathComponent("covers", isDirectory: true)
        try fileManager.createDirectory(at: coversDirectory, withIntermediateDirectories: true)

        let destination = coversDirectory
            .appendingPathComponent(sanitizedPageID(pageID))
            .appendingPathExtension(extensionName)

        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }
        try fileManager.copyItem(at: sourceURL, to: destination)

        return destination.standardizedFileURL.absoluteString
    }

    private static func validatedExtension(for sourceURL: URL, fileManager: FileManager) throws -> String {
        let extensionName = sourceURL.pathExtension.lowercased()
        guard allowedExtensions.contains(extensionName) else {
            throw CoverImageImportError.unsupportedExtension
        }

        let size = try fileManager.attributesOfItem(atPath: sourceURL.path)[.size] as? NSNumber
        if size?.uint64Value ?? 0 > maxBytes {
            throw CoverImageImportError.tooLarge
        }

        let data = try Data(contentsOf: sourceURL, options: [.mappedIfSafe])
        guard let detectedExtension = detectedExtension(from: data) else {
            throw CoverImageImportError.unsupportedContent
        }
        guard detectedExtension == extensionName || (detectedExtension == "jpg" && extensionName == "jpeg") else {
            throw CoverImageImportError.mismatchedExtension
        }

        return extensionName == "jpeg" ? "jpg" : extensionName
    }

    private static var allowedExtensions: Set<String> {
        ["png", "jpg", "jpeg", "webp", "gif"]
    }

    private static func detectedExtension(from data: Data) -> String? {
        if data.starts(with: [0x89, 0x50, 0x4E, 0x47]) {
            return "png"
        }
        if data.starts(with: [0xFF, 0xD8, 0xFF]) {
            return "jpg"
        }
        if data.starts(with: Array("GIF87a".utf8)) || data.starts(with: Array("GIF89a".utf8)) {
            return "gif"
        }
        if data.count >= 12,
           data[0..<4].elementsEqual(Array("RIFF".utf8)),
           data[8..<12].elementsEqual(Array("WEBP".utf8)) {
            return "webp"
        }
        return nil
    }

    private static func sanitizedPageID(_ pageID: String) -> String {
        let scalars = pageID.unicodeScalars.map { scalar -> Character in
            if CharacterSet.alphanumerics.contains(scalar) || scalar == "-" || scalar == "_" {
                return Character(scalar)
            }
            return "-"
        }
        let collapsed = String(scalars)
            .split(separator: "-", omittingEmptySubsequences: true)
            .joined(separator: "-")
            .trimmingCharacters(in: CharacterSet(charactersIn: "-_"))

        return collapsed.isEmpty ? UUID().uuidString : collapsed
    }
}
