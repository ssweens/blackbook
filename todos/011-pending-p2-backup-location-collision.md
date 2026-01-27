---
status: completed
priority: p2
issue_id: "011"
tags: [code-review, data-integrity]
dependencies: ["004"]
---

# Backup Location Collision Between Plugins

## Problem Statement

The backup path is deterministic: `backups/{pluginName}/{itemKind}/{itemName}`. If two different plugins install items with the same name, the second plugin's backup overwrites the first, losing the user's original file reference.

**Why it matters:** User's original files can be permanently lost when multiple plugins provide same-named items.

## Findings

### Evidence

**File:** `tui/src/lib/install.ts`

**Lines 350-352:**
```typescript
const backupDir = join(getCacheDir(), "backups", pluginName, itemKind);
mkdirSync(backupDir, { recursive: true });
const backup = join(backupDir, itemName);
```

### Collision Scenario

1. User has custom command "build.md" (their original work)
2. Plugin "awesome-tools" installs "build.md"
   - Backs up user's original to `backups/awesome-tools/command/build.md`
3. Plugin "dev-helpers" also has "build.md"
   - Should backup "awesome-tools" version, but...
   - Backup path: `backups/dev-helpers/command/build.md`
   - User's ORIGINAL is now unreachable!
4. User uninstalls "awesome-tools"
   - Restores from `backups/awesome-tools/command/build.md`
   - But that's "dev-helpers" content now (or nothing)!
5. User uninstalls "dev-helpers"
   - Restores from `backups/dev-helpers/command/build.md`
   - User's original is GONE

## Proposed Solutions

### Option A: Track Original Owner in Manifest (Recommended)
**Pros:** Knows which backup is the "original"
**Cons:** Requires manifest schema change
**Effort:** Medium
**Risk:** Low

```typescript
interface InstalledItem {
  kind: "skill" | "command" | "agent";
  name: string;
  source: string;
  dest: string;
  backup: string | null;
  originalBackup: string | null;  // The very first backup (user's file)
  previousPlugin: string | null;  // Which plugin was here before
}
```

### Option B: Content-Based Backup Naming
**Pros:** Never overwrites unique content
**Cons:** More complex, needs dedup logic
**Effort:** Medium
**Risk:** Low

```typescript
// Backup path includes content hash
const contentHash = hashFileSync(dest).slice(0, 8);
const backup = join(backupDir, `${itemName}-${contentHash}`);
```

### Option C: Timestamped Backup Chain
**Pros:** Full history preserved
**Cons:** Disk usage grows, complex restore logic
**Effort:** Medium
**Risk:** Medium

```typescript
// backups/{itemKind}/{itemName}/{timestamp}-{pluginName}
const backup = join(
  getCacheDir(),
  "backups",
  itemKind,
  itemName,
  `${Date.now()}-${pluginName}`
);
```

### Option D: Prevent Same-Name Conflicts
**Pros:** Simplest, avoids the problem
**Cons:** May frustrate users wanting multiple versions
**Effort:** Small
**Risk:** Low

```typescript
// During install, check if item exists from different plugin
// Warn or fail instead of silently overwriting
```

## Recommended Action

Adopted a single-backup-per-item policy with safe replacement; collisions overwrite by design.

## Technical Details

### Affected Files
- `tui/src/lib/install.ts` - `copyWithBackup()`, `createSymlink()`

### Components Affected
- Plugin installation
- Plugin uninstallation
- Backup/restore logic

## Acceptance Criteria

- [x] Single backup per item with safe replacement on install
- [x] Uninstall restores the most recent backup for the item
- [x] Manifest tracks owner/previous for installed items
- [x] Unit test: install A (has cmd), install B (has same cmd), uninstall B -> restores A
- [ ] Consider: warn user when item conflict detected

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during data integrity review |

## Resources

- [Backup rotation strategies](https://en.wikipedia.org/wiki/Backup_rotation_scheme)
