/**
 * The slice of a list to render so the selected row stays on screen. The
 * window scrolls only once the selection passes its bottom edge.
 */
export function computeWindow<T>(items: T[], selectedIndex: number, maxHeight: number): { visible: T[]; startIndex: number } {
  const height = Math.max(1, maxHeight);
  if (items.length <= height) {
    return { visible: items, startIndex: 0 };
  }
  const maxStart = Math.max(0, items.length - height);
  const start = Math.min(Math.max(0, selectedIndex - (height - 1)), maxStart);
  return { visible: items.slice(start, start + height), startIndex: start };
}

/** "11–30 of 52" when a list doesn't fit, else "". */
export function windowLabel(startIndex: number, shown: number, total: number): string {
  if (total <= shown) return "";
  return `${startIndex + 1}–${startIndex + shown} of ${total}`;
}

/** Case-insensitive substring match; an empty query matches everything. */
export function matchesQuery(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || text.toLowerCase().includes(q);
}
