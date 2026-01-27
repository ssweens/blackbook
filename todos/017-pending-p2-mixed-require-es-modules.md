---
status: completed
priority: p2
issue_id: "017"
tags: [code-review, quality, consistency]
dependencies: []
---

# Mixed require() with ES Modules

## Problem Statement

The codebase uses ES Module imports (`import { ... } from "fs"`) but also has a stray `require("fs")` call, mixing module systems inconsistently.

**Why it matters:** Inconsistency, potential bundler issues, tree-shaking problems, confusing for contributors.

## Findings

### Evidence

**File:** `tui/src/lib/marketplace.ts`

**Line 19:**
```typescript
const stat = require("fs").statSync(path);  // CommonJS require
```

But at the top of the file:
```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";  // ES import
```

The `statSync` function should just be added to the existing import.

## Proposed Solutions

### Option A: Add to Existing Import (Recommended)
**Pros:** Simple, consistent
**Cons:** None
**Effort:** Trivial
**Risk:** None

```typescript
// Change line 1:
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "fs";

// Change line 19:
const stat = statSync(path);
```

## Recommended Action

Updated to use ES module imports only.

## Technical Details

### Affected Files
- `tui/src/lib/marketplace.ts` - line 1 (import) and line 19 (usage)

## Acceptance Criteria

- [x] No `require()` calls in ES module files
- [x] All fs functions imported from "fs" at top of file
- [ ] Linter rule added to prevent future `require()` in ES modules (optional)

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during pattern review |

## Resources

- [ES Modules in Node.js](https://nodejs.org/api/esm.html)
