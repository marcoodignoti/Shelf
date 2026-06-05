export type PartialBlock = {
  id?: string;
  type?: string;
  props?: Record<string, any>;
  content?: any;
  children?: PartialBlock[];
};

export type Block<
  BSchema = any,
  ISchema = any,
  SSchema = any,
> = {
  id: string;
  type: string;
  props: Record<string, any>;
  content: any;
  children: Block<BSchema, ISchema, SSchema>[];
};

export class BlockNoteEditor<
  BSchema = unknown,
  ISchema = unknown,
  SSchema = unknown,
> {
  static create(options: {
    uploadFile?: (file: File) => string | Promise<string>;
    pasteHandler?: (options: {
      event: ClipboardEvent;
      editor: BlockNoteEditor;
      defaultPasteHandler: () => void;
    }) => void;
    [key: string]: any;
  }): BlockNoteEditor;

  [key: string]: any;

  domElement?: HTMLElement;
  document: Block[];
  dictionary: any;
  focus(): void;
  getBlock(id: string): Block | undefined;
  getSelection(): { blocks: Block[] } | undefined;
  getTextCursorPosition(): { block: Block };
  insertInlineContent(content: unknown, options?: unknown): void;
  insertBlocks(blocks: PartialBlock[], referenceBlock: Block | string, placement?: string): void;
  removeBlocks(blocks: Block[] | string[]): void;
  replaceBlocks(blocksToRemove: Block[] | string[], blocksToInsert: PartialBlock[]): void;
  setSelection(...selection: unknown[]): void;
  setTextCursorPosition(block: Block | string, placement?: string): void;
  transact(callback: () => void): void;
  updateBlock(block: Block | string, update: PartialBlock): void;
}

export const BlockNoteSchema: {
  create(options: unknown): unknown;
};

export const defaultBlockSpecs: Record<string, unknown>;
export const defaultInlineContentSpecs: Record<string, unknown>;

export function editorHasBlockWithType(
  editor: BlockNoteEditor,
  type: string,
  props?: Record<string, "string" | "number" | "boolean">,
): boolean;
