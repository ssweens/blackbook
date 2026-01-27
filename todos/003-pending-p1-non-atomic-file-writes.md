---
status: completed
priority: p1
issue_id: "003"
tags: [code-review, data-integrity, critical]
dependencies: []
---

# Non-Atomic Config and Manifest Writes

## Problem Statement

Configuration (`config.toml`) and manifest (`installed_items.json`) files are written using direct `writeFileSync()` calls. If the process crashes, is killed, or the system loses power during the write, the file will be corrupted (truncated or partially written), causing complete data loss.

**Why it matters:** A single interrupted write can lose ALL tool configurations and ALL installation tracking, leaving the user unable to manage or uninstall plugins.

## Findings

### Evidence

**File:** `tui/src/lib/config.ts`

**Line 287:** Config file written directly
```typescript
writeFileSync(path, lines.join("\n"));
```

**File:** `tui/src/lib/install.ts`

**Line 144:** Manifest written directly
```typescript
writeFileSync(path, JSON.stringify(manifest, null, 2));
```

### Failure Scenario

1. User is running blackbook, modifying tool settings
2. System crashes mid-write (power loss, OOM kill, Ctrl+C)
3. On next startup, `loadConfig()` or `loadManifest()` finds corrupted file
4. Config: Returns empty object, loses all marketplaces and tool instances
5. Manifest: Returns empty object, loses all installation tracking and backup references

## Proposed Solutions

### Option A: Atomic Write Helper (Recommended)
**Pros:** Industry standard pattern, reliable, simple to implement
**Cons:** Slightly more code
**Effort:** Small
**Risk:** Low

```typescript
import { writeFileSync, renameSync, fsyncSync, openSync, closeSync } from "fs";
import { dirname, join } from "path";

function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = dirname(filePath);
  const tempPath = join(dir, `.${Date.now()}.${process.pid}.tmp`);

  // Write to temp file
  const fd = openSync(tempPath, 'w');
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);  // Ensure data is flushed to disk
  } finally {
    closeSync(fd);
  }

  // Atomic rename (on POSIX, rename is atomic if same filesystem)
  renameSync(tempPath, filePath);
}
```

### Option B: Write-Ahead Logging
**Pros:** Full recovery capability
**Cons:** More complex, overkill for this use case
**Effort:** Large
**Risk:** Medium

### Option C: Backup Before Write
**Pros:** Can recover previous version
**Cons:** Still has a window of corruption
**Effort:** Small
**Risk:** Medium

## Recommended Action

Implemented atomic writes for config and manifest.

## Technical Details

### Affected Files
- `tui/src/lib/config.ts` - `saveConfig()` function
- `tui/src/lib/install.ts` - `saveManifest()` function

### Components Affected
- All config modifications
- All plugin install/uninstall/enable/disable operations

## Acceptance Criteria

- [x] `atomicWriteFileSync()` helper created
- [x] `saveConfig()` uses atomic write
- [x] `saveManifest()` uses atomic write
- [x] Unit test verifying temp file cleanup on success
- [ ] Manual test: kill process during write, verify no corruption

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during data integrity review |

## Resources

- [Atomic file writes](https://rcrowley.org/2010/01/06/things-unix-can-do-atomically.html)
- [fsync for durability](https://lwn.net/Articles/457667/)
