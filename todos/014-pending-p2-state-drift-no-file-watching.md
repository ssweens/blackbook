---
status: completed
priority: p2
issue_id: "014"
tags: [code-review, architecture, ux]
dependencies: []
---

# State Drift Between UI and Filesystem

## Problem Statement

The Zustand store maintains in-memory state that can drift from filesystem reality. External changes (manual edits, other processes, Claude CLI operations) are invisible until manual refresh.

**Why it matters:** Users may see stale data. Plugins installed via Claude CLI won't appear. Manual config edits require restart.

## Findings

### Evidence

**File:** `tui/src/lib/store.ts`

**Line 88:** State initialized once at module load
```typescript
tools: getToolInstances(),
```

**Lines 172-173:** Refresh requires explicit call
```typescript
set({ installedPlugins: installedWithStatus, marketplaces, tools: getToolInstances() });
```

### Drift Scenarios

1. **External Installation:**
   - User runs `claude plugin install foo` in terminal
   - Blackbook UI doesn't show `foo` until refresh

2. **Manual Config Edit:**
   - User edits `~/.config/blackbook/config.toml`
   - Changes not reflected until restart

3. **Concurrent Blackbook:**
   - User runs blackbook in two terminals
   - Each sees different state

## Proposed Solutions

### Option A: File Watchers (Recommended for Key Files)
**Pros:** Automatic updates, good UX
**Cons:** Complexity, potential performance impact
**Effort:** Medium
**Risk:** Low

```typescript
import { watch } from "fs";

function watchConfig(callback: () => void): void {
  const configPath = getConfigPath();
  const manifestPath = manifestPath();

  watch(configPath, { persistent: false }, (event) => {
    if (event === 'change') callback();
  });

  watch(manifestPath, { persistent: false }, (event) => {
    if (event === 'change') callback();
  });
}

// In store initialization
watchConfig(() => get().refreshAll());
```

### Option B: Modification Time Checks
**Pros:** Simpler than watchers, cross-platform
**Cons:** Requires periodic polling
**Effort:** Small
**Risk:** Low

```typescript
let lastConfigMtime = 0;

function checkForExternalChanges(): boolean {
  const stat = statSync(getConfigPath());
  if (stat.mtimeMs > lastConfigMtime) {
    lastConfigMtime = stat.mtimeMs;
    return true;
  }
  return false;
}

// Check before operations
async function refreshIfNeeded(): Promise<void> {
  if (checkForExternalChanges()) {
    await get().refreshAll();
  }
}
```

### Option C: Manual Refresh Only
**Pros:** Simplest, most predictable
**Cons:** Users must remember to refresh
**Effort:** None (current behavior)
**Risk:** UX issues remain

## Recommended Action

Added file watchers for config and manifest to auto-refresh state.

## Technical Details

### Affected Files
- `tui/src/lib/store.ts` - add watchers or mtime checks
- `tui/src/App.tsx` - potentially show "stale" indicator

### Files to Watch
- `~/.config/blackbook/config.toml`
- `~/.cache/blackbook/installed_items.json`
- Claude plugins directory (for claude-code instances)

## Acceptance Criteria

- [x] External config changes detected automatically
- [ ] OR: clear "Refresh" affordance in UI
- [ ] UI indicates when data may be stale
- [ ] No performance regression from watching

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during architecture review |

## Resources

- [Node.js fs.watch](https://nodejs.org/api/fs.html#fswatchfilename-options-listener)
- [chokidar package](https://www.npmjs.com/package/chokidar) (more reliable file watching)
