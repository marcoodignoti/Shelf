// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "OpenNotionNative",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "OpenNotionCore", targets: ["OpenNotionCore"]),
        .executable(name: "OpenNotionNative", targets: ["OpenNotionNative"])
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.10.0")
    ],
    targets: [
        .target(
            name: "OpenNotionCore",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift")
            ]
        ),
        .executableTarget(
            name: "OpenNotionNative",
            dependencies: ["OpenNotionCore"]
        ),
        .testTarget(
            name: "OpenNotionCoreTests",
            dependencies: ["OpenNotionCore"]
        )
    ]
)
