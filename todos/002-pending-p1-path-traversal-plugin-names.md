---
status: completed
priority: p1
issue_id: "002"
tags: [code-review, security, critical]
dependencies: []
---

# Path Traversal in Plugin Names

## Problem Statement

Plugin names, skill names, command names, and agent names from untrusted marketplace JSON are used directly in `path.join()` without validation. An attacker can use path traversal sequences (`../`) to write files outside the intended config directories.

**Why it matters:** This vulnerability allows writing arbitrary files anywhere the user has write access, potentially overwriting SSH keys, shell configs, or other sensitive files.

## Findings

### Evidence

**File:** `tui/src/lib/install.ts`

**Line 54:** Plugin directory uses unvalidated names
```typescript
const pluginDir = join(pluginsDir, plugin.marketplace, plugin.name);
```

**Line 391:** Skill destination uses unvalidated entry name
```typescript
const dest = join(instance.configDir, instance.skillsSubdir, entry);
```

**Line 663:** Skill target from plugin.skills array
```typescript
const source = join(sourcePath, "skills", skill);
const target = join(instance.configDir, instance.skillsSubdir, skill);
```

Similar patterns at lines: 116, 319, 414, 437, 686, 705

### Attack Vector

A malicious marketplace returns:
```json
{
  "name": "../../../.ssh/authorized_keys",
  "skills": ["../../../.bashrc"],
  "source": "./plugins/malicious"
}
```

This would write attacker-controlled content to `~/.ssh/authorized_keys` or `~/.bashrc`.

## Proposed Solutions

### Option A: Path Validation Helper (Recommended)
**Pros:** Centralized, reusable, comprehensive protection
**Cons:** Must be applied consistently everywhere
**Effort:** Medium
**Risk:** Low

```typescript
import { resolve, relative } from "path";

function safePath(base: string, ...segments: string[]): string {
  // Validate each segment
  for (const seg of segments) {
    if (seg.includes('..') || seg.includes('/') || seg.includes('\\') || seg.includes('\0')) {
      throw new Error(`Invalid path segment: ${seg}`);
    }
  }

  // Resolve and verify containment
  const result = resolve(base, ...segments);
  const rel = relative(base, result);

  if (rel.startsWith('..') || resolve(rel) === result) {
    throw new Error(`Path traversal detected: ${result} escapes ${base}`);
  }

  return result;
}
```

### Option B: Sanitize Names on Load
**Pros:** Single point of sanitization
**Cons:** May break legitimate plugin names with special chars
**Effort:** Small
**Risk:** Medium

```typescript
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}
```

### Option C: Both A + B
**Pros:** Defense in depth
**Cons:** More complexity
**Effort:** Medium
**Risk:** Lowest

## Recommended Action

Added `safePath()` + name validation and applied it to plugin install/link paths.

## Technical Details

### Affected Files
- `tui/src/lib/install.ts` - lines 54, 116, 319, 391, 414, 437, 663, 686, 705

### Components Affected
- Plugin download
- Plugin installation
- Skill/command/agent linking
- Backup creation

## Acceptance Criteria

- [x] `safePath()` helper created and tested
- [x] All `path.join()` calls with external data replaced with `safePath()`
- [x] Plugin names validated against strict pattern on marketplace fetch
- [x] Skill/command/agent names validated before use
- [x] Unit tests for path traversal attempts
- [ ] Integration test verifying containment

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during security review |

## Resources

- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)
- [Node.js path.resolve](https://nodejs.org/api/path.html#pathresolvepaths)
