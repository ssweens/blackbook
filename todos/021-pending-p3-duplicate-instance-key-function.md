---
status: pending
priority: p3
issue_id: "021"
tags: [code-review, quality, dry]
dependencies: []
---

# Duplicate instanceKey() Function

## Problem Statement

The `instanceKey()` function is defined identically in two files.

**Why it matters:** DRY violation. Changes must be synchronized.

## Findings

### Evidence

**File:** `tui/src/lib/store.ts` line 51:
```typescript
function instanceKey(toolId: string, instanceId: string): string {
  return `${toolId}:${instanceId}`;
}
```

**File:** `tui/src/lib/install.ts` line 29:
```typescript
function instanceKey(instance: ToolInstance): string {
  return `${instance.toolId}:${instance.instanceId}`;
}
```

Note: Slightly different signatures but same purpose.

## Proposed Solutions

### Option A: Export from One Location (Recommended)
**Pros:** Single source of truth
**Cons:** Minor import addition
**Effort:** Small
**Risk:** None

```typescript
// In types.ts or a utils.ts
export function instanceKey(instance: ToolInstance): string;
export function instanceKey(toolId: string, instanceId: string): string;
export function instanceKey(instanceOrToolId: ToolInstance | string, instanceId?: string): string {
  if (typeof instanceOrToolId === 'string') {
    return `${instanceOrToolId}:${instanceId}`;
  }
  return `${instanceOrToolId.toolId}:${instanceOrToolId.instanceId}`;
}
```

## Technical Details

### Affected Files
- `tui/src/lib/install.ts` - remove local function, import shared
- `tui/src/lib/store.ts` - remove local function, import shared
- New or existing utils file - add shared function

## Acceptance Criteria

- [ ] Single `instanceKey()` function
- [ ] Both files import from same location
- [ ] All existing usages work

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2025-01-27 | Created | Identified during pattern review |
