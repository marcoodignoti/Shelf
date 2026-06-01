export const CHAT_ACTIONS_FENCE = "```opennotion-actions";

// While streaming, hide the raw action fence (and anything after it) from the
// rendered prose so the user never sees raw JSON. The parsed plan arrives with
// the final reply and renders as an inline card.
export function visibleStreamText(raw: string): string {
  const marker = raw.indexOf(CHAT_ACTIONS_FENCE);
  return (marker === -1 ? raw : raw.slice(0, marker)).trimEnd();
}
