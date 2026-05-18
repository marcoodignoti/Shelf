import { Block, BlockNoteEditor, PartialBlock } from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { updatePage, Page } from "../lib/db";
import { useAppStore } from "../store/useAppStore";

const EMPTY_DOCUMENT: PartialBlock[] = [{ type: "paragraph" }];

function plainTextToBlocks(text: string): PartialBlock[] {
  const lines = text.split("\n");
  const blocks = lines.map((line) => ({
    type: "paragraph" as const,
    content: line,
  }));

  return blocks.length > 0 ? blocks : EMPTY_DOCUMENT;
}

function sanitizePageBlocks(blocks: unknown[]): PartialBlock[] {
  const validBlocks = blocks.filter(
    (block): block is PartialBlock =>
      typeof block === "object" && block !== null && !Array.isArray(block)
  );

  return validBlocks.length > 0 ? validBlocks : EMPTY_DOCUMENT;
}

function parsePageBlocks(content: string | null): PartialBlock[] {
  if (!content) return EMPTY_DOCUMENT;

  try {
    const parsed = JSON.parse(content);

    if (Array.isArray(parsed) && parsed.length > 0) {
      return sanitizePageBlocks(parsed);
    }

    if (typeof parsed === "string") {
      return plainTextToBlocks(parsed);
    }

    if (typeof parsed?.plainText === "string") {
      return plainTextToBlocks(parsed.plainText);
    }
  } catch {
    return plainTextToBlocks(content);
  }

  return EMPTY_DOCUMENT;
}

export function Editor({ page }: { page: Page }) {
  const saveTimeoutRef = useRef<number | null>(null);
  const titleTimeoutRef = useRef<number | null>(null);
  const [title, setTitle] = useState(page.title || "");
  const updatePageOptimistically = useAppStore((state) => state.updatePageOptimistically);
  const initialContent = useMemo(() => parsePageBlocks(page.content), [page.id]);
  const editor = useMemo(
    () =>
      BlockNoteEditor.create({
        initialContent,
      }),
    [page.id]
  );

  useEffect(() => {
    setTitle(page.title || "");
  }, [page.id, page.title]);

  const scheduleSave = (updates: Partial<Page>, timeoutRef: React.MutableRefObject<number | null>) => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      updatePage(page.id, updates).catch((error) => {
        console.error("Failed to save page:", error);
      });
    }, 300);
  };

  const handleTitleChange = (value: string) => {
    const nextTitle = value;
    setTitle(nextTitle);
    const savedTitle = nextTitle || "Untitled";
    updatePageOptimistically(page.id, { title: savedTitle });
    scheduleSave({ title: savedTitle }, titleTimeoutRef);
  };

  const handleEditorChange = () => {
    const content = JSON.stringify(editor.document as Block[]);
    updatePageOptimistically(page.id, { content });
    scheduleSave({ content }, saveTimeoutRef);
  };

  return (
    <div className="flex flex-col h-full w-full relative">
      <div className="max-w-3xl mx-auto flex flex-col flex-1 w-full px-8 pt-24 pb-16 overflow-y-auto">
        <input
          className="text-4xl font-bold mb-8 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
          value={title}
          placeholder="Untitled"
          onChange={(event) => handleTitleChange(event.target.value)}
        />
        <div className="flex-1 bg-transparent border-none relative -ml-12">
          <BlockNoteView editor={editor} onChange={handleEditorChange} />
        </div>
      </div>
    </div>
  );
}
