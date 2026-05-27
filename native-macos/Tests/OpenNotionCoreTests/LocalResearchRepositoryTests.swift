import Foundation
import XCTest
@testable import OpenNotionCore

final class LocalResearchRepositoryTests: XCTestCase {
    func testMissingFileBootstrapsDefaultWorkspaces() throws {
        let repository = LocalResearchRepository(fileURL: temporaryFileURL())

        let data = try repository.load()

        XCTAssertEqual(data.schemaVersion, 1)
        XCTAssertEqual(data.workspaces.map(\.name), ["University", "Physics 2", "Embedded"])
        XCTAssertEqual(data.pages, [])
        XCTAssertEqual(data.notes, [])
    }

    func testRoundTripsResearchPageAndLinkedNote() throws {
        let fileURL = temporaryFileURL()
        let repository = LocalResearchRepository(fileURL: fileURL)
        let data = ResearchWorkspaceData(
            workspaces: [
                ResearchWorkspace(
                    id: "workspace",
                    name: "Robotics",
                    createdAt: "2026-05-27T09:00:00Z",
                    updatedAt: "2026-05-27T09:00:00Z"
                )
            ],
            pages: [
                ResearchPage(
                    id: "page",
                    workspaceID: "workspace",
                    title: "ROS joint states",
                    urlString: "https://docs.ros.org/en/jazzy/p/sensor_msgs/msg/JointState.html",
                    createdAt: "2026-05-27T09:01:00Z",
                    updatedAt: "2026-05-27T09:01:00Z",
                    lastVisitedAt: "2026-05-27T09:01:00Z"
                )
            ],
            notes: [
                ResearchNote(
                    id: "note",
                    pageID: "page",
                    body: "joint_states maps names to positions",
                    tags: ["robotics", "ros"],
                    checklist: ["verify units"],
                    citations: ["JointState message docs"],
                    createdAt: "2026-05-27T09:02:00Z",
                    updatedAt: "2026-05-27T09:02:00Z"
                )
            ]
        )

        try repository.save(data)
        let loaded = try repository.load()

        XCTAssertEqual(loaded, data)
    }

    private func temporaryFileURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("opennotion-research-\(UUID().uuidString)")
            .appendingPathExtension("json")
    }
}
