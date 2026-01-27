---
status: pending
priority: p3
issue_id: "020"
tags: [code-review, quality, dry]
dependencies: []
---

# Instance Partitioning Pattern Duplicated 7 Times

## Problem Statement

The pattern of separating Claude instances from non-Claude instances is duplicated 7 times in install.ts.

**Why it matters:** DRY violation. If logic changes, must update 7 places.

## Findings

### Evidence

**File:** `tui/src/lib/install.ts`

Same pattern at lines: 262-263, 305-306, 532-533, 577-578, 612-613, 1025-1026

```typescript
const claudeInstances = enabledInstances.filter((instance) => instance.toolId === "claude-code");
const nonClaudeInstances = enabledInstances.filter((instance) => instance.toolId !== "claude-code");
```

## Proposed Solutions

### Option A: Helper Function (Recommended)
**Pros:** Single source of truth, cleaner code
**Cons:** Minor indirection
**Effort:** Small
**Risk:** None

```typescript
interface PartitionedInstances {
  claude: ToolInstance[];
  other: ToolInstance[];
}

function partitionInstancesByClaudeCode(instances: ToolInstance[]): PartitionedInstances {
  return {
    claude: instances.filter(i => i.toolId === "claude-code"),
    other: instances.filter(i => i.toolId !== "claude-code"),
  };
}

// Usage
const { claude, other } = partitionInstancesByClaudeCode(enabledInstances);
```

## Technical Details

### Affected Files
- `tui/src/lib/install.ts` - add helper, update 7 call sites

## Acceptance Criteria

- [ ] Helper function created
- [ ] All 7 occurrences updated to use helper
- [ ] No functionality changes
- [ ] Tests still pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2025-01-27 | Created | Identified during pattern review |
