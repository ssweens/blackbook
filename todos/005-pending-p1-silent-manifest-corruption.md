---
status: completed
priority: p1
issue_id: "005"
tags: [code-review, data-integrity, critical]
dependencies: []
---

# Silent Manifest Corruption Handling

## Problem Statement

When the manifest file (`installed_items.json`) exists but is corrupted (invalid JSON), `loadManifest()` silently returns an empty manifest object. This means ALL installation tracking is silently discarded without any warning to the user.

**Why it matters:** Users lose all record of what plugins are installed, where backups are located, and what files belong to which plugins. They cannot properly uninstall or restore their original configurations.

## Findings

### Evidence

**File:** `tui/src/lib/install.ts`

**Lines 134-138:**
```typescript
try {
  return JSON.parse(readFileSync(path, "utf-8"));
} catch {
  return { tools: {} };  // Corrupted manifest silently becomes empty!
}
```

### Failure Scenarios

**Scenario 1: Crash During Write**
1. Plugin install writes manifest
2. Process crashes mid-write
3. Next startup: corrupted JSON
4. `loadManifest()` returns `{ tools: {} }`
5. All installation data lost, backups orphaned

**Scenario 2: Disk Error**
1. Disk develops bad sector in manifest file
2. File partially readable
3. JSON parse fails
4. Silent empty return

**Scenario 3: Manual Edit Error**
1. User edits manifest manually (troubleshooting)
2. Introduces syntax error
3. All data silently discarded

## Proposed Solutions

### Option A: Distinguish Not-Found from Parse-Error (Recommended)
**Pros:** Clear error handling, users know when something is wrong
**Cons:** May surface errors that were previously hidden
**Effort:** Small
**Risk:** Low

```typescript
export function loadManifest(cacheDir?: string): Manifest {
  const path = manifestPath(cacheDir);

  // File not existing is fine - return empty
  if (!existsSync(path)) {
    return { tools: {} };
  }

  // File exists - must be valid
  const content = readFileSync(path, "utf-8");
  try {
    return JSON.parse(content);
  } catch (e) {
    const error = `Manifest file is corrupted at ${path}: ${e instanceof Error ? e.message : String(e)}`;
    console.error(error);
    throw new Error(error);  // Don't silently lose installation data!
  }
}
```

### Option B: Return Error State
**Pros:** Caller can decide how to handle
**Cons:** Requires updating all callers
**Effort:** Medium
**Risk:** Low

```typescript
type ManifestResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; error: string; path: string };

export function loadManifest(cacheDir?: string): ManifestResult {
  // ...
}
```

### Option C: Auto-Recovery with Backup
**Pros:** Attempts to recover
**Cons:** May hide real issues
**Effort:** Medium
**Risk:** Medium

```typescript
// Try to load, if corrupt, check for .bak, warn user
```

## Recommended Action

Manifest parsing now throws with a clear error; callers surface failures.

## Technical Details

### Affected Files
- `tui/src/lib/install.ts` - `loadManifest()` function

### Components Affected
- All plugin operations that read manifest
- Uninstall (needs manifest to find backups)
- Status checking

## Acceptance Criteria

- [x] `loadManifest()` throws on parse errors (not file-not-found)
- [x] Error message includes file path and parse error details
- [x] Callers updated to handle potential throws
- [x] UI shows meaningful error when manifest is corrupt
- [x] Unit test: corrupt manifest file throws with clear message
- [ ] Consider: backup manifest before operations

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during silent failure review |

## Resources

- [Fail fast principle](https://www.martinfowler.com/ieeeSoftware/failFast.pdf)
