---
status: pending
priority: p3
issue_id: "025"
tags: [code-review, quality, dead-code]
dependencies: []
---

# Potentially Unused Exports

## Problem Statement

Some exported functions may not be used anywhere in the codebase, indicating potential dead code.

**Why it matters:** Dead code increases maintenance burden, confusion, and bundle size.

## Findings

### Evidence

**File:** `tui/src/lib/install.ts`

**Potentially unused:**
- `linkPluginToInstance()` (lines 648-721) - Appears to be legacy; current flow uses `installPluginItemsToInstance()` instead
- `removeSymlink()` (lines 217-221) - Exported but may not be used externally

## Proposed Solutions

### Option A: Audit and Remove (Recommended)
**Pros:** Cleaner codebase
**Cons:** Requires careful verification
**Effort:** Small
**Risk:** Low (if verified unused)

Steps:
1. Search for all usages of each export
2. Check if used in tests
3. Remove if truly unused

### Option B: Mark as Internal
**Pros:** Documents intent
**Cons:** Still have the code
**Effort:** Trivial
**Risk:** None

```typescript
/** @internal - may be removed in future versions */
export function linkPluginToInstance(...) { }
```

## Technical Details

### Affected Files
- `tui/src/lib/install.ts`

### Exports to Audit
- `linkPluginToInstance`
- `removeSymlink`
- Any other exports not imported elsewhere

## Acceptance Criteria

- [ ] All exports verified as used or removed
- [ ] No dead code remaining
- [ ] Tests updated if any test-only exports removed

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2025-01-27 | Created | Identified during pattern review |
