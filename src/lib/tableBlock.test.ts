import { describe, expect, it } from "vitest";
import { initialTableBlock } from "./tableBlock";

describe("initialTableBlock", () => {
  it("creates a blank 3 column by 2 row BlockNote table", () => {
    expect(initialTableBlock()).toEqual({
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          { cells: ["", "", ""] },
          { cells: ["", "", ""] },
        ],
      },
    });
  });
});
