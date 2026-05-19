import { PartialBlock } from "@blocknote/core";

export function initialTableBlock(): PartialBlock {
  return {
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: ["", "", ""] },
        { cells: ["", "", ""] },
      ],
    },
  } as PartialBlock;
}
