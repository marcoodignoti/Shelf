export type SearchMatchPart = {
  text: string;
  matched: boolean;
};

export function splitSearchMatch(text: string, query: string): SearchMatchPart[] {
  const trimmedQuery = query.trim();

  if (!text || !trimmedQuery) {
    return [{ text, matched: false }];
  }

  const matchIndex = text.toLowerCase().indexOf(trimmedQuery.toLowerCase());

  if (matchIndex === -1) {
    return [{ text, matched: false }];
  }

  const matchEnd = matchIndex + trimmedQuery.length;
  return [
    { text: text.slice(0, matchIndex), matched: false },
    { text: text.slice(matchIndex, matchEnd), matched: true },
    { text: text.slice(matchEnd), matched: false },
  ].filter(part => part.text.length > 0);
}
