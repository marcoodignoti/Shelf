import { describe, expect, it } from "vitest";
import { splitSearchMatch } from "./searchDisplay";

describe("splitSearchMatch", () => {
  it("splits text into before, match, and after parts case-insensitively", () => {
    expect(splitSearchMatch("Project Roadmap", "road")).toEqual([
      { text: "Project ", matched: false },
      { text: "Road", matched: true },
      { text: "map", matched: false },
    ]);
  });

  it("returns plain text when query is empty or missing", () => {
    expect(splitSearchMatch("Project Roadmap", " ")).toEqual([
      { text: "Project Roadmap", matched: false },
    ]);
    expect(splitSearchMatch("Project Roadmap", "xyz")).toEqual([
      { text: "Project Roadmap", matched: false },
    ]);
  });
});
