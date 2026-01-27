---
status: pending
priority: p3
issue_id: "023"
tags: [code-review, quality, consistency]
dependencies: []
---

# parseGithubRepoFromUrl Returns Different Types

## Problem Statement

The `parseGithubRepoFromUrl()` function exists in two files with the same name but returns different types.

**Why it matters:** Confusing, error-prone, violates principle of least surprise.

## Findings

### Evidence

**File:** `tui/src/lib/install.ts` line 42:
```typescript
function parseGithubRepoFromUrl(url: string): { repo: string; ref: string } | null {
  // Returns object
}
```

**File:** `tui/src/lib/marketplace.ts` line 46:
```typescript
function parseGithubRepoFromUrl(url: string): [string, string] | null {
  // Returns tuple
}
```

## Proposed Solutions

### Option A: Unify to Single Function (Recommended)
**Pros:** Consistent, no confusion
**Cons:** Requires picking one style
**Effort:** Small
**Risk:** Low

```typescript
// In a shared utils.ts
interface GitHubRepoInfo {
  repo: string;
  ref: string;
}

export function parseGithubRepoFromUrl(url: string): GitHubRepoInfo | null {
  const rawMatch = url.match(/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)/);
  if (rawMatch) return { repo: rawMatch[1], ref: rawMatch[2] };

  const gitMatch = url.match(/github\.com\/([^/]+\/[^/.]+)(?:\.git)?/);
  if (gitMatch) return { repo: gitMatch[1], ref: "main" };

  return null;
}
```

## Technical Details

### Affected Files
- `tui/src/lib/install.ts` - remove local function, import shared
- `tui/src/lib/marketplace.ts` - remove local function, import shared, update usages
- New utils file - add shared function

## Acceptance Criteria

- [ ] Single `parseGithubRepoFromUrl()` function
- [ ] Consistent return type (object preferred for clarity)
- [ ] All usages updated
- [ ] Tests pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2025-01-27 | Created | Identified during pattern review |
