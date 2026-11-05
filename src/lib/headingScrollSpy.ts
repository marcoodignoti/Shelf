export type MeasuredHeading = {
  id: string;
  /** Viewport top of the heading's block, or null when it is not mounted. */
  top: number | null;
};

/**
 * The heading the reader is "in": the last one (in document order) whose top
 * has scrolled to within `threshold` px of the scroll container's top. Falls
 * back to the first heading before any has passed that line.
 */
export function activeHeadingFromOffsets(
  headings: MeasuredHeading[],
  containerTop: number,
  threshold = 140,
): string | null {
  let current = headings[0]?.id ?? null;
  for (const heading of headings) {
    if (heading.top === null) continue;
    if (heading.top > containerTop + threshold) break;
    current = heading.id;
  }
  return current;
}
