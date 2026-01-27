---
status: pending
priority: p3
issue_id: "024"
tags: [code-review, quality, bug-risk]
dependencies: []
---

# Variable Shadowing in Loops

## Problem Statement

There's variable shadowing where a loop variable has the same name as an outer variable.

**Why it matters:** Can cause subtle bugs if the wrong variable is referenced. Makes code harder to read.

## Findings

### Evidence

**File:** `tui/src/lib/install.ts`

**Line 472 and 480:**
```typescript
const key = instanceKey(instance);  // Outer 'key'
// ...
for (const [key, item] of Object.entries(toolManifest.items)) {  // Shadows outer 'key'
```

## Proposed Solutions

### Option A: Rename Loop Variable (Recommended)
**Pros:** Clear, no shadowing
**Cons:** Minor rename
**Effort:** Trivial
**Risk:** None

```typescript
const instanceKeyStr = instanceKey(instance);
// ...
for (const [itemKey, item] of Object.entries(toolManifest.items)) {
```

## Technical Details

### Affected Files
- `tui/src/lib/install.ts` - `uninstallPluginItemsFromInstance()` function

## Acceptance Criteria

- [ ] No variable shadowing
- [ ] ESLint rule enabled to catch future cases (optional)

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2025-01-27 | Created | Identified during pattern review |
