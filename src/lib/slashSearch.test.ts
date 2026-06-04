import { describe, expect, it } from "vitest";
import { rankedSuggestionItems } from "./slashSearch";

describe("rankedSuggestionItems", () => {
  it("prefers title and word-prefix matches over vague one-letter alias matches", () => {
    const results = rankedSuggestionItems(
      [
        { title: "Quote", aliases: ["blockquote"] },
        { title: "Bulleted List", aliases: ["ul", "unordered list"] },
        { title: "Link page", aliases: ["page"] },
      ],
      "l"
    );

    expect(results.map((item) => item.title)).toEqual(["Link page", "Bulleted List"]);
  });

  it("normalizes a leading slash from the query", () => {
    const results = rankedSuggestionItems(
      [
        { title: "Quote", aliases: ["blockquote"] },
        { title: "Link page", aliases: ["page"] },
      ],
      "/l"
    );

    expect(results.map((item) => item.title)).toEqual(["Link page"]);
  });

  it("keeps one-letter alias prefix matches below title matches", () => {
    const results = rankedSuggestionItems(
      [
        { title: "Quote", aliases: ["blockquote"] },
        { title: "Formula", aliases: ["math", "latex"] },
        { title: "Main heading" },
      ],
      "m"
    );

    expect(results.map((item) => item.title)).toEqual(["Main heading", "Formula"]);
  });

  it("keeps global ranking instead of moving weak grouped matches upward", () => {
    const results = rankedSuggestionItems(
      [
        { title: "Link page", group: "Pages" },
        { title: "Numbered List", group: "Basic" },
        { title: "Aligned Text", group: "Pages" },
      ],
      "li"
    );

    expect(results.map((item) => item.title)).toEqual(["Link page", "Numbered List", "Aligned Text"]);
  });

  it("keeps multi-letter alias contains matches available", () => {
    const results = rankedSuggestionItems(
      [
        { title: "Quote", aliases: ["blockquote"] },
        { title: "Code", aliases: ["snippet"] },
      ],
      "lock"
    );

    expect(results.map((item) => item.title)).toEqual(["Quote"]);
  });
});
