# Diff View for Drifted States

## Overview

Add a dedicated diff view that explains *why* an item is drifted.

Requirements from you:
- Separate diff view (not inline)
- Per-file diffs
- File list is selectable; each entry previews the number of lines changed (+/-)
- Works across all relevant tabs and sync types (assets + configs)

## Goals

1. From any place the user can see a drifted item (Discover/Installed/Sync), they can open a diff UI.
2. If multiple tool instances are drifted, the user can choose which instance to inspect.
3. For directory assets and multi-file configs, show per-file drift with counts.
4. Diff view is non-destructive: it’s informational only.

## Non-goals

- Plugin diffs (plugins have “missing/incomplete” status, not “drifted”) unless explicitly requested later.
- Applying patches from the diff view (future feature).

---

## UX / Entry Points (All Tabs)

### Discover + Installed tabs

- AssetDetail: show action **View diff** when `asset.drifted === true`.
- ConfigDetail: show action **View diff** when `config.drifted === true`.

These detail components are used regardless of whether you reached them from Discover or Installed, so coverage is automatic once the detail components include the action.

### Sync tab

Sync tab currently shows drifted assets/configs but has no detail view.

Add:
- Shortcut key: **`d`** opens diff view for the currently selected sync item **if drifted**.
  - If item isn’t drifted (missing-only), show a notification: `No diff available (item is missing, not drifted).`
- (Optional but recommended for completeness): **Enter** on a Sync item opens its normal detail view (PluginDetail / AssetDetail / ConfigDetail).

---

## Coverage by Sync Type

### Assets

Assets can be:
- A single file
- A directory (recursive)
- A URL (cached to disk; treated as a file)

**Diff should support all of these.**

#### Asset: single file
- One file entry in the diff list.

#### Asset: directory
- Build a per-file diff list **recursively**.
- Detect and show:
  - Modified files (present in source and target, content differs)
  - Missing files (present in source, missing in target)
  - Extra files (present in target, missing in source)

File display name should be the relative path within the directory (e.g., `themes/dark.json`).

### Configs

Configs can be:
- Legacy single file (`source_path` / `target_path`)
- Multi-file mappings (`[[configs.files]]`) including directory and glob expansion

**Diff should support both.**

For configs we already have a canonical list of expected files via `config.sourceFiles` (expanded from mappings).

Diff list includes:
- Modified files (hash mismatch)
- Missing target files

(Extra target files are not required for configs; we never delete extras by design.)

---

## Multi-Instance Handling

Assets and configs can drift in multiple enabled instances.

Diff flow:
1. If exactly one drifted enabled instance exists → jump straight to file list.
2. If multiple drifted enabled instances exist → show **Instance picker** first.

Instance picker shows e.g.:
- `Claude (default)`
- `Pi (default)`

---

## Diff Data Model

We need a lightweight *summary* for the file list, and a heavier *detail* only when a file is opened.

```ts
export type DiffItemKind = "asset" | "config";

export interface DiffInstanceRef {
  toolId: string;
  instanceId: string;
  instanceName: string;
  configDir: string;
}

export type DiffFileStatus = "modified" | "missing" | "extra" | "binary";

export interface DiffFileSummary {
  id: string;              // stable key (e.g., relativePath)
  displayPath: string;     // shown in list (e.g., themes/dark.json)
  sourcePath: string | null;
  targetPath: string | null;
  status: DiffFileStatus;
  linesAdded: number;
  linesRemoved: number;
}

export interface DiffTarget {
  kind: DiffItemKind;
  title: string;           // e.g. "AGENTS.md" or "Pi Config"
  instance: DiffInstanceRef;
  files: DiffFileSummary[];
}

// Full render payload for DiffDetail
export interface DiffFileDetail extends DiffFileSummary {
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
}
```

---

## Diff Computation

### Orientation (important)

We want the diff to answer: **“what must change in the target to match the source?”**

So we treat:
- **old = target**
- **new = source**

That makes `+` lines = lines that need to be added to the tool config, and `-` lines = lines that should be removed.

### Summary counts (fast path)

For the file list we only need `+N/-N`, not hunks.

Use the `diff` library’s `diffLines()` to compute counts without building hunks.

### Full diff (slow path)

For the selected file:
- Use `createTwoFilesPatch()` + `parsePatch()` to build hunks for rendering.

### Missing / Extra files

Represent these as diffs against empty content:
- Missing target file: `old = ""`, `new = sourceContent` (all `+`)
- Extra target file: `old = targetContent`, `new = ""` (all `-`)

### Binary files

Detect binary via null bytes in the first 8KB.
- Summary entry: status = `binary`, counts = 0/0
- Detail view: show `Binary files differ` (no hunks)

### Large diffs

- DiffDetail must be scrollable.
- Add soft caps:
  - Max diff lines rendered at once (e.g., 2k) with truncation message.
  - Keep counts accurate even if truncated.

---

## TUI Implementation

### New dependency
- Add `diff` (npm package)

### New lib module
- `tui/src/lib/diff.ts`
  - `computeDiffCounts(oldText, newText)`
  - `computeUnifiedDiff(oldText, newText)`
  - `buildAssetDiffTarget(asset, instance)` (file or dir)
  - `buildConfigDiffTarget(config, instance)` (multi-file)

### Store state (Zustand)

Add to `AppState`:
- `diffTarget: DiffTarget | null`
- `diffError: string | null`
- `diffLoading: boolean`

Add actions:
- `openDiffForAsset(asset: Asset): Promise<void>`
- `openDiffForConfig(config: ConfigFile): Promise<void>`
- `openDiffFromSyncSelection(item: SyncPreviewItem): Promise<void>`
- `closeDiff(): void`

Compute diffs in store (so App can remain a pure view).

### App input handling

- When `diffTarget` is open, DiffView owns input (Esc back/out).
- Sync tab: add `d` key to open diff when selected item is drifted.

### Components

Create:
- `DiffView.tsx` (state machine)
  - Step 1: Instance picker (only if multiple)
  - Step 2: File list
  - Step 3: Diff detail
- `DiffInstanceList.tsx`
- `DiffFileList.tsx`
- `DiffDetail.tsx`

Rendering strategy:
- DiffFileList uses summaries (counts)
- DiffDetail computes hunks for one file on demand

---

## Tests

### Unit tests (diff engine)
- `diffCounts` counts added/removed lines correctly
- `unifiedDiff` produces hunks and correct headers
- missing target file yields all `+` lines
- extra target file yields all `-` lines
- binary detection

### Integration tests (diff target builders)

Assets:
- file asset modified
- directory asset with:
  - modified file
  - missing file
  - extra file

Configs:
- legacy single-file config modified
- multi-file config:
  - one modified file
  - one missing file

### Ink/UI tests (high value)
- AssetDetail shows **View diff** when drifted
- ConfigDetail shows **View diff** when drifted
- DiffView navigation:
  - file list shows `+N/-N`
  - Enter opens DiffDetail
  - Esc returns back

Update `docs/TEST_COVERAGE.md` with a checklist item for "Drift diff view".

---

## Acceptance Criteria

- Drifted assets/configs show a **View diff** action in detail views.
- Sync tab supports opening diffs for drifted assets/configs.
- Directory assets show per-file drift (modified/missing/extra) with counts.
- Multi-file configs show per-file drift (modified/missing) with counts.
- DiffDetail is scrollable and safe for large files.
- Tests cover both core diff logic and TUI navigation.

## Open Questions

1. Keep the instance picker step (agreed).
2. Decision: implement **Option B** — a "Missing Summary" view for missing-only items.
   - Trigger: `d` on a missing-only item in Sync tab (or a "View missing summary" action in detail view if we choose to add it).
   - Output:
     - For configs: list of missing target files (and optionally which instance is being inspected).
     - For directory assets: list missing files and extra files (extra = present in target but not in source).
   - No content diff hunks are shown.

3. No need to show source vs target paths in the diff header (agreed).
