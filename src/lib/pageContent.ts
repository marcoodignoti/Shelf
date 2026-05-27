import { PartialBlock } from "@blocknote/core";

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

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function textFromInlineContent(content: unknown): string {
  if (typeof content === "string") return content;

  if (!Array.isArray(content)) return "";

  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (typeof item !== "object" || item === null || Array.isArray(item)) return "";
      if ("text" in item && typeof item.text === "string") return item.text;
      if ("type" in item && item.type === "math") {
        const props = "props" in item && typeof item.props === "object" && item.props !== null ? item.props : {};
        return "formula" in props && typeof props.formula === "string" ? props.formula : "";
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function textFromTableCell(cell: unknown): string {
  if (typeof cell === "string" || Array.isArray(cell)) {
    return textFromInlineContent(cell);
  }

  if (typeof cell !== "object" || cell === null) return "";

  const record = cell as Record<string, unknown>;
  return textFromInlineContent(record.content);
}

function textFromTableContent(content: unknown): string[] {
  if (typeof content !== "object" || content === null || Array.isArray(content)) return [];

  const record = content as Record<string, unknown>;

  if (record.type !== "tableContent" || !Array.isArray(record.rows)) return [];

  return record.rows.flatMap((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return [];

    const rowRecord = row as Record<string, unknown>;
    if (!Array.isArray(rowRecord.cells)) return [];

    return rowRecord.cells.map(textFromTableCell).filter(Boolean);
  });
}

function textFromBlock(block: unknown): string[] {
  if (typeof block !== "object" || block === null || Array.isArray(block)) return [];

  const record = block as Record<string, unknown>;
  const parts = [textFromInlineContent(record.content), ...textFromTableContent(record.content)];

  if (Array.isArray(record.children)) {
    parts.push(...record.children.flatMap(textFromBlock));
  }

  return parts.filter(Boolean);
}

export function parsePageBlocks(content: string | null): PartialBlock[] {
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

export function pageContentToSearchText(content: string | null): string {
  if (!content) return "";

  try {
    const parsed = JSON.parse(content);

    if (Array.isArray(parsed)) {
      return normalizeWhitespace(parsed.flatMap(textFromBlock).join(" "));
    }

    if (typeof parsed === "string") {
      return normalizeWhitespace(parsed);
    }

    if (typeof parsed?.plainText === "string") {
      return normalizeWhitespace(parsed.plainText);
    }
  } catch {
    return normalizeWhitespace(content);
  }

  return "";
}

export function pageContentPreview(content: string | null, query: string): string | null {
  const text = pageContentToSearchText(content);
  const trimmedQuery = query.trim();

  if (!text || !trimmedQuery) return null;

  const index = text.toLowerCase().indexOf(trimmedQuery.toLowerCase());

  if (index === -1) return text.slice(0, 120);

  return text.slice(Math.max(0, index - 40), index + trimmedQuery.length + 80);
}
