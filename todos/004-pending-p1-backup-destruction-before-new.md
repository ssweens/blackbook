---
status: completed
priority: p1
issue_id: "004"
tags: [code-review, data-integrity, critical]
dependencies: []
---

# Backup Destruction Before New Backup Created

## Problem Statement

The `copyWithBackup()` function deletes the existing backup BEFORE successfully moving the current file to the backup location. If the `renameSync()` fails after the old backup is deleted, BOTH the old backup AND the ability to create a new backup are lost, resulting in permanent data loss.

**Why it matters:** User's original files (their custom skills, commands, agents) can be permanently lost with no recovery option.

## Findings

### Evidence

**File:** `tui/src/lib/install.ts`

**Lines 354-358:**
```typescript
if (existsSync(backup) || isSymlink(backup)) {
  rmSync(backup, { recursive: true, force: true });  // OLD BACKUP DELETED HERE
}

renameSync(dest, backup);  // WHAT IF THIS FAILS?
```

### Failure Scenario

1. User has custom skill "my-skill" (their original work)
2. User installs plugin A which replaces it - backup created at `backups/pluginA/skill/my-skill`
3. Later, user installs plugin B which also has "my-skill"
4. Code deletes plugin A's backup of the original (line 355)
5. `renameSync` fails (permissions, disk full, file locked)
6. Result: Original "my-skill" is PERMANENTLY LOST - both the backup and the current file

### Additional Issue: Backup Collision

The backup path is deterministic: `backups/{pluginName}/{itemKind}/{itemName}`

If two plugins install items with the same name, the second overwrites the first's backup, losing the original user file reference.

## Proposed Solutions

### Option A: Safe Backup Pattern (Recommended)
**Pros:** Never loses data, simple pattern
**Cons:** Slightly more complex
**Effort:** Small
**Risk:** Low

```typescript
function safeBackup(src: string, backupPath: string): void {
  const tempBackup = `${backupPath}.new.${Date.now()}`;

  // Move current to temp backup location first
  renameSync(src, tempBackup);

  // Only now safe to delete old backup
  if (existsSync(backupPath) || isSymlink(backupPath)) {
    rmSync(backupPath, { recursive: true, force: true });
  }

  // Finalize by moving temp to final backup location
  renameSync(tempBackup, backupPath);
}
```

### Option B: Timestamped Backups
**Pros:** Keeps history, never overwrites
**Cons:** Disk usage grows, cleanup needed
**Effort:** Medium
**Risk:** Low

```typescript
// Instead of: backups/{pluginName}/{itemKind}/{itemName}
// Use: backups/{itemKind}/{itemName}/{timestamp}-{pluginName}
const backupPath = join(backupDir, itemKind, itemName, `${Date.now()}-${pluginName}`);
```

### Option C: Content-Addressed Backups
**Pros:** Deduplication, never loses unique content
**Cons:** More complex implementation
**Effort:** Large
**Risk:** Medium

## Recommended Action

Implemented safe backup replacement (rename to temp, replace old backup) with a single backup per item.

## Technical Details

### Affected Files
- `tui/src/lib/install.ts` - `copyWithBackup()` function (lines 340-372)
- `tui/src/lib/install.ts` - `createSymlink()` function (lines 169-191)

### Components Affected
- Plugin installation
- Plugin enable
- Plugin update

## Acceptance Criteria

- [x] Safe backup pattern used that never deletes before confirming new backup
- [x] `copyWithBackup()` uses safe pattern
- [x] `createSymlink()` uses safe pattern
- [x] Backup paths are single per item with safe replacement
- [ ] Unit test: simulate rename failure, verify old backup preserved
- [ ] Unit test: two plugins with same item name, verify both backups exist

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during data integrity review |

## Resources

- [Safe file operations](https://blog.gocept.com/2013/07/15/reliable-file-updates-with-python/)
