type SuggestionLike = {
  title: string;
  aliases?: readonly string[];
  group?: string;
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function startsWithWord(value: string, query: string): boolean {
  return value
    .split(/[\s/_-]+/)
    .some((part) => part.startsWith(query));
}

function suggestionScore(item: SuggestionLike, query: string): number | null {
  const title = normalize(item.title);
  const aliases = item.aliases?.map(normalize) ?? [];

  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  if (startsWithWord(title, query)) return 2;
  if (aliases.some((alias) => alias === query)) return 3;
  if (aliases.some((alias) => alias.startsWith(query) || startsWithWord(alias, query))) return 4;
  if (title.includes(query)) return 5;
  if (query.length > 1 && aliases.some((alias) => alias.includes(query))) return 6;

  return null;
}

export function rankedSuggestionItems<T extends SuggestionLike>(items: T[], query: string): T[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return items;

  const rankedItems = items
    .map((item, index) => ({
      item,
      index,
      score: suggestionScore(item, normalizedQuery),
    }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((first, second) => first.score - second.score || first.index - second.index)
    .map((entry) => entry.item);

  const groupedItems = new Map<string, T[]>();
  for (const item of rankedItems) {
    const group = item.group ?? "";
    groupedItems.set(group, [...(groupedItems.get(group) ?? []), item]);
  }

  return [...groupedItems.values()].flat();
}
