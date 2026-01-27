---
status: completed
priority: p2
issue_id: "012"
tags: [code-review, bug, ux]
dependencies: []
---

# Tilde Expansion Not Implemented

## Problem Statement

The code recognizes `~` as indicating a local path but never actually expands it to the user's home directory. If a user enters `~/.config/plugins`, it's stored literally and will fail to resolve correctly.

**Why it matters:** Operations may fail silently or create files in unexpected locations (literally named `~` directory).

## Findings

### Evidence

**File:** `tui/src/lib/config.ts`

**Lines 411, 429:**
```typescript
const isLocal = url.startsWith("/") || url.startsWith("~");  // Recognizes ~
// But ~ is never expanded!
```

### Problem Scenario

1. User edits config.toml:
   ```toml
   [tools.claude-code]
   config_dir = "~/.claude-alt"
   ```
2. Code reads config_dir as literal string `"~/.claude-alt"`
3. `path.join()` with `~` creates path like `/current/dir/~/.claude-alt`
4. Operations fail or create wrong directory

### Also Affects

- Marketplace URLs starting with `~`
- Any user-provided path in config

## Proposed Solutions

### Option A: Expand Tilde on Load (Recommended)
**Pros:** Simple, handles all cases
**Cons:** May surprise users if they expect literal `~`
**Effort:** Small
**Risk:** Low

```typescript
import { homedir } from "os";

function expandPath(p: string): string {
  if (p === '~') {
    return homedir();
  }
  if (p.startsWith('~/')) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

// Apply when loading config
const configDir = expandPath(instance.configDir);
```

### Option B: Expand on Save
**Pros:** Config file shows actual paths
**Cons:** Users can't use `~` as shorthand in file
**Effort:** Small
**Risk:** Low

### Option C: Expand on Use
**Pros:** Preserves original in config
**Cons:** Must remember to expand everywhere
**Effort:** Medium
**Risk:** Medium

## Recommended Action

Added `expandPath()` for `~` in config and marketplace paths.

## Technical Details

### Affected Files
- `tui/src/lib/config.ts` - path handling
- Anywhere configDir is used

### Components Affected
- Config loading
- Tool instance resolution
- Marketplace URL handling

## Acceptance Criteria

- [x] `expandPath()` helper created
- [x] All user-provided paths expanded on load
- [x] Paths with `~` work correctly
- [ ] Unit test: `~/foo` expands to `/Users/xxx/foo` (or equivalent)
- [x] Documentation: mention tilde expansion is supported

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during architecture review |

## Resources

- [Path expansion in shells](https://www.gnu.org/software/bash/manual/html_node/Tilde-Expansion.html)
