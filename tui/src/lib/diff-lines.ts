/**
 * Strip git metadata header lines from a raw `git diff` and clip each line to a
 * width, for rendering in a fixed-width terminal panel. Shared by the Settings
 * source-repo diff and the lock-file git detail.
 */
export function parseDiffLines(raw: string, maxLineWidth: number): string[] {
  return raw
    .split("\n")
    .filter((line) => {
      if (line.startsWith("diff --git")) return false;
      if (line.startsWith("index ")) return false;
      if (line.startsWith("--- ")) return false;
      if (line.startsWith("+++ ")) return false;
      return true;
    })
    .map((line) => (line.length > maxLineWidth ? line.slice(0, maxLineWidth - 1) + "…" : line));
}
