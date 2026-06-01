import { describe, expect, it } from "vitest";
import { visibleStreamText, CHAT_ACTIONS_FENCE } from "./aiChatSession";

describe("visibleStreamText", () => {
  it("returns full text before the action fence appears", () => {
    expect(visibleStreamText("Here is the plan so far")).toBe("Here is the plan so far");
  });

  it("hides everything from the action fence onward", () => {
    const raw = `Done.\n\n${CHAT_ACTIONS_FENCE}\n{"version":1}`;
    expect(visibleStreamText(raw)).toBe("Done.");
  });
});
