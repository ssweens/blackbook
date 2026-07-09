import { useStdout } from "ink";

/**
 * Fixed rows consumed outside the tab content area:
 * - outer Box padding top/bottom: 2
 * - TabBar: 1
 * - refresh indicator + marginBottom: 2
 * - Notifications: 0 (renders null when empty — the common case; when a
 *   sticky warning/error is showing this can grow to ~6 rows, which this
 *   budget does not cover — a separate, pre-existing gap)
 * - HintBar: 4 (marginTop 1 + borderTop 1 + paddingTop 1 + text 1 — this was
 *   previously counted as 1, undercounting by 3; that mismatch let the frame
 *   silently exceed the terminal's row count and made Ink fall back to a
 *   full clearTerminal + redraw on every re-render, i.e. flicker)
 * - StatusBar: 1
 */
export const CHROME_ROWS = 13;

/**
 * Return the number of rows available for tab content.
 * Falls back to 24 when stdout is unavailable (e.g. tests).
 */
export function useContentHeight(minRows = 12): number {
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  return Math.max(minRows, rows - CHROME_ROWS);
}
