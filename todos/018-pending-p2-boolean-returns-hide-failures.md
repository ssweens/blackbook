---
status: completed
priority: p2
issue_id: "018"
tags: [code-review, error-handling, api-design]
dependencies: []
---

# Boolean Returns Hide Failure Reasons

## Problem Statement

Functions like `createSymlink()` return `boolean` for success/failure, hiding the actual reason for failure. Callers can't distinguish between "source doesn't exist", "permission denied", "symlink failed", or "rename failed".

**Why it matters:** Debugging is impossible. Error messages are generic and unhelpful.

## Findings

### Evidence

**File:** `tui/src/lib/install.ts`

**Lines 147-207:** `createSymlink()` returns boolean
```typescript
export function createSymlink(
  source: string,
  target: string,
  pluginName?: string,
  itemKind?: string,
  itemName?: string
): boolean {
  if (!existsSync(source)) return false;  // Why? Source missing
  // ...
  } catch {
    // ...
    return false;  // Why? Permission? Rename failed?
  }
}
```

**Lines 217-221:** `removeSymlink()` same issue
```typescript
export function removeSymlink(target: string): boolean {
  if (!isSymlink(target)) return false;  // Not a symlink? Or error checking?
  unlinkSync(target);
  return true;
}
```

### Caller Impact

```typescript
if (createSymlink(source, target)) {
  // Great!
} else {
  // What went wrong? No idea. Can only say "failed"
}
```

## Proposed Solutions

### Option A: Result Type (Recommended)
**Pros:** Clear error reasons, type-safe
**Cons:** More verbose
**Effort:** Medium
**Risk:** Low

```typescript
type SymlinkResult =
  | { success: true }
  | { success: false; code: SymlinkErrorCode; message: string };

type SymlinkErrorCode =
  | 'SOURCE_NOT_FOUND'
  | 'TARGET_EXISTS'
  | 'PERMISSION_DENIED'
  | 'SYMLINK_FAILED'
  | 'RENAME_FAILED';

export function createSymlink(
  source: string,
  target: string,
  options?: { pluginName?: string; itemKind?: string; itemName?: string }
): SymlinkResult {
  if (!existsSync(source)) {
    return { success: false, code: 'SOURCE_NOT_FOUND', message: `Source does not exist: ${source}` };
  }
  // ...
}
```

### Option B: Throw Exceptions
**Pros:** Simpler API, stack traces
**Cons:** Requires try/catch at call sites
**Effort:** Small
**Risk:** Low

```typescript
export function createSymlink(source: string, target: string): void {
  if (!existsSync(source)) {
    throw new Error(`Cannot create symlink: source does not exist: ${source}`);
  }
  // ...
}
```

### Option C: Error Output Parameter
**Pros:** Backwards compatible signature
**Cons:** Awkward API
**Effort:** Small
**Risk:** Low

```typescript
export function createSymlink(
  source: string,
  target: string,
  error?: { message?: string }
): boolean {
  if (!existsSync(source)) {
    if (error) error.message = `Source not found: ${source}`;
    return false;
  }
  // ...
}
```

## Recommended Action

Switched to structured `SymlinkResult` with error codes and messages.

## Technical Details

### Affected Files
- `tui/src/lib/install.ts` - `createSymlink()`, `removeSymlink()`, `isSymlink()`

### Functions to Update
- `createSymlink()` - multiple failure modes
- `removeSymlink()` - could fail on unlinkSync
- Potentially others returning boolean for complex operations

## Acceptance Criteria

- [x] `createSymlink()` returns structured result with error details
- [x] `removeSymlink()` returns structured result
- [x] Callers updated to use new return type
- [x] Error messages are actionable
- [x] Unit tests verify correct error codes

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during pattern review |

## Resources

- [Result type pattern](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)
