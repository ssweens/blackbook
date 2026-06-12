import { useStdout } from "ink";

/**
 * Fixed rows consumed outside the tab content area:
 * - outer Box padding top/bottom: 2
 * - TabBar: 1
 * - refresh indicator + marginBottom: 2
 * - Notifications: 1 (conservative)
 * - HintBar: 1
 * - StatusBar: 1
 */
export const CHROME_ROWS = 8;

/**
 * Return the number of rows available for tab content.
 * Falls back to 24 when stdout is unavailable (e.g. tests).
 */
export function useContentHeight(minRows = 12): number {
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;
  return Math.max(minRows, rows - CHROME_ROWS);
}
