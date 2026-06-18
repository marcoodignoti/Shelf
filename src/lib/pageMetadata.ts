export function normalizePageIcon(value: string): string | null {
  const trimmed = value.trim();
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new (
      locale?: string,
      options?: { granularity: "grapheme" }
    ) => { segment: (input: string) => Iterable<{ segment: string }> };
  }).Segmenter;
  const icon = Segmenter
    ? new Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)[Symbol.iterator]().next().value?.segment ?? ""
    : Array.from(trimmed)[0] ?? "";

  return icon || null;
}

export function normalizeCoverUrl(value: string): string | null {
  const coverUrl = value.trim();
  if (!coverUrl) return null;
  if (/^blob:/i.test(coverUrl)) return coverUrl;
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(coverUrl)) return coverUrl;
  return null;
}
