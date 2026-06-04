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
