import type { Page } from "./db";
import { openNotionEditorSchema } from "./editorMath";
import { parsePageBlocks } from "./pageContent";

// One headless editor converts every page in an export run; BlockNote is
// loaded lazily so the editor bundle stays out of the initial chunk.
export async function createPageMarkdownRenderer(): Promise<(page: Page) => Promise<string>> {
  const { BlockNoteEditor } = await import("@blocknote/core");
  const editor = BlockNoteEditor.create({ schema: openNotionEditorSchema });
  return async (page: Page) => editor.blocksToMarkdownLossy(parsePageBlocks(page.content));
}
