import type { LockSyncHint } from "./lock-git.js";

/**
 * Compact list-row rendering of a lock sync hint, shared by the Projects and
 * Profiles tabs so they read the same: "in sync", "drifted +3 -1",
 * "not pushed", "not in source repo", etc. Lowercased (the detail uses Title
 * Case), with the diff counts appended when there are any.
 */
export function lockSyncText(hint: LockSyncHint | undefined): { text: string; color: string } {
  if (!hint) return { text: "checking…", color: "gray" };
  const counts = hint.added > 0 || hint.removed > 0 ? ` +${hint.added} -${hint.removed}` : "";
  return { text: `${hint.label.toLowerCase()}${counts}`, color: hint.color };
}
