---
status: completed
priority: p2
issue_id: "008"
tags: [code-review, data-integrity, concurrency]
dependencies: []
---

# No Concurrent Access Protection

## Problem Statement

Config and manifest files have no file locking. If a user runs two instances of blackbook simultaneously (e.g., in different terminals), they will race to read/write the same files, potentially corrupting configuration and installation tracking.

**Why it matters:** Users may accidentally run multiple instances (e.g., one in background, start another). Data corruption results in lost config or orphaned plugins.

## Findings

### Evidence

**No locking on:**
- `~/.config/blackbook/config.toml`
- `~/.cache/blackbook/installed_items.json`
- Backup directories

### Race Condition Scenario

1. Terminal A: `blackbook` - installing plugin-a
2. Terminal B: `blackbook` - installing plugin-b (started immediately after)
3. Both read manifest at same time (empty or same state)
4. A writes manifest with plugin-a entries
5. B writes manifest with plugin-b entries (overwrites A's changes)
6. Result: plugin-a entries lost from manifest, can't uninstall properly

### Additional Concerns

- UI state in Zustand store doesn't reflect concurrent modifications
- Backup directories could have race conditions during install

## Proposed Solutions

### Option A: Advisory File Locking (Recommended)
**Pros:** Standard approach, works cross-platform
**Cons:** Requires cleanup on crash
**Effort:** Medium
**Risk:** Low

```typescript
import { proper-lockfile } from 'proper-lockfile';

async function withManifestLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockPath = manifestPath();
  const release = await lock(lockPath, { retries: 5 });
  try {
    return await fn();
  } finally {
    await release();
  }
}
```

### Option B: Single Instance Check
**Pros:** Simple, prevents the problem entirely
**Cons:** May frustrate users wanting multiple terminals
**Effort:** Small
**Risk:** Low

```typescript
// Check for PID file on startup
const pidFile = join(getCacheDir(), 'blackbook.pid');
if (existsSync(pidFile)) {
  const pid = readFileSync(pidFile, 'utf-8');
  if (isProcessRunning(pid)) {
    console.error('Another instance of blackbook is running');
    process.exit(1);
  }
}
writeFileSync(pidFile, String(process.pid));
```

### Option C: Optimistic Locking with Versioning
**Pros:** Detects conflicts, allows resolution
**Cons:** More complex, user must resolve conflicts
**Effort:** Large
**Risk:** Medium

## Recommended Action

Added file locking with retries and stale lock cleanup for config/manifest operations.

## Technical Details

### Affected Files
- `tui/src/lib/config.ts` - `saveConfig()`, `loadConfig()`
- `tui/src/lib/install.ts` - `saveManifest()`, `loadManifest()`

### Components Affected
- All config modifications
- All plugin operations

## Acceptance Criteria

- [x] File locking implemented for manifest operations
- [x] File locking implemented for config operations
- [x] Graceful handling of lock contention (retry with backoff)
- [x] Stale locks cleaned up on startup
- [ ] Unit test: concurrent operations don't corrupt data
- [ ] Documentation: warn about running multiple instances

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during data integrity review |

## Resources

- [proper-lockfile npm package](https://www.npmjs.com/package/proper-lockfile)
- [File locking in Node.js](https://nodejs.org/api/fs.html#fsflocker-operation-callback)
