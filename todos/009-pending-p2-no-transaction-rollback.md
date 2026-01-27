---
status: completed
priority: p2
issue_id: "009"
tags: [code-review, data-integrity, architecture]
dependencies: ["003", "004"]
---

# No Transaction/Rollback Mechanism

## Problem Statement

The `installPluginItemsToInstance()` function performs multiple file operations without any rollback capability. If the install fails after copying some items, the system is left in a partial state with no recovery mechanism.

**Why it matters:** Partial installs leave tools in inconsistent states. Some skills work, others don't. The user's original files may be partially backed up, partially overwritten.

## Findings

### Evidence

**File:** `tui/src/lib/install.ts`

**Lines 374-468:** `installPluginItemsToInstance()`
```typescript
// Copies skills one by one
for (const entry of readdirSync(skillsDir)) {
  // copyWithBackup for each skill
  // If copy #3 of 5 fails, #1 and #2 remain
}
// Same for commands, agents
// Manifest saved at end
```

### Failure Scenario

1. Plugin has 5 skills
2. Skills 1-3 copied successfully
3. Skill 4 fails (disk full, permission denied)
4. Exception thrown, function exits
5. Manifest NOT saved (because we exited early)
6. Skills 1-3 exist but aren't tracked
7. User's original skills 1-3 are backed up but backup locations unknown
8. Next install attempt: no backups made for 1-3 (files already exist)

## Proposed Solutions

### Option A: Transaction Log Pattern (Recommended)
**Pros:** Full recovery capability, standard pattern
**Cons:** More complex implementation
**Effort:** Medium
**Risk:** Low

```typescript
interface PendingOperation {
  id: string;
  type: 'install' | 'uninstall';
  plugin: string;
  items: Array<{
    kind: string;
    name: string;
    source: string;
    dest: string;
    backupPath: string;
    status: 'pending' | 'copied' | 'complete';
  }>;
  startedAt: string;
}

async function installWithTransaction(plugin: Plugin, instance: ToolInstance): Promise<void> {
  const txLog = join(getCacheDir(), 'pending_operations.json');

  // Write pending operation before starting
  const tx: PendingOperation = { ... };
  writeFileSync(txLog, JSON.stringify(tx));

  try {
    for (const item of tx.items) {
      // Copy item
      item.status = 'copied';
      writeFileSync(txLog, JSON.stringify(tx));  // Update progress
    }

    // All done, remove transaction log
    unlinkSync(txLog);
  } catch (e) {
    // Rollback: use transaction log to restore backups
    await rollbackTransaction(tx);
    throw e;
  }
}

// On startup, check for pending_operations.json and recover
```

### Option B: Two-Phase Commit
**Pros:** Clean separation of prepare and commit
**Cons:** More complex
**Effort:** Large
**Risk:** Medium

### Option C: Compensating Actions Only
**Pros:** Simpler than full transactions
**Cons:** May not handle all failure cases
**Effort:** Small
**Risk:** Medium

```typescript
const copiedItems: Array<{ dest: string; backup: string | null }> = [];

try {
  // Copy all items, track what was done
} catch (e) {
  // Rollback: remove copied items, restore backups
  for (const item of copiedItems.reverse()) {
    rmSync(item.dest);
    if (item.backup) renameSync(item.backup, item.dest);
  }
  throw e;
}
```

## Recommended Action

Added per-install rollback to restore backups and clean partial installs.

## Technical Details

### Affected Files
- `tui/src/lib/install.ts` - `installPluginItemsToInstance()`, `installPlugin()`

### Components Affected
- Plugin installation
- Plugin enable
- Plugin update

## Acceptance Criteria

- [x] Install operations can be rolled back on failure
- [ ] Startup checks for incomplete operations and recovers
- [x] Backups are restored if install fails midway
- [x] No orphaned files left on failure
- [x] Unit test: simulate failure at each step, verify rollback
- [ ] Integration test: kill process mid-install, verify recovery on restart

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during architecture review |

## Resources

- [Transaction patterns](https://martinfowler.com/eaaCatalog/unitOfWork.html)
- [Saga pattern](https://microservices.io/patterns/data/saga.html)
