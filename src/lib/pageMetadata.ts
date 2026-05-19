export function normalizePageIcon(value: string): string | null {
  const icon = Array.from(value.trim()).slice(0, 8).join("");
  return icon || null;
}

export function normalizeCoverUrl(value: string): string | null {
  const coverUrl = value.trim();
  return coverUrl || null;
}
