---
status: completed
priority: p2
issue_id: "007"
tags: [code-review, error-handling, quality]
dependencies: []
---

# 23+ Silent Failure Points with Empty Catch Blocks

## Problem Statement

The codebase contains 23+ empty `catch { /* ignore */ }` blocks that silently swallow errors. Users see generic "Install failed" messages with no actionable information to debug the actual issue.

**Why it matters:** When operations fail, users have no way to know why. Is it a network issue? Permission denied? CLI not installed? Disk full? All produce the same unhelpful result.

## Findings

### Evidence

**File:** `tui/src/lib/install.ts`

| Line | Function | Hidden Error |
|------|----------|--------------|
| 109 | downloadPlugin | Git clone failures |
| 136 | loadManifest | JSON parse errors |
| 312 | uninstallPlugin | Claude CLI errors |
| 322 | uninstallPlugin | Directory removal |
| 403 | installPluginItemsToInstance | Skills dir read |
| 426 | installPluginItemsToInstance | Commands dir read |
| 449 | installPluginItemsToInstance | Agents dir read |
| 501 | uninstallPluginItemsFromInstance | File removal |
| 539 | enablePlugin | Claude CLI errors |
| 584 | disablePlugin | Claude CLI errors |
| 619 | updatePlugin | Claude CLI errors |
| 629 | updatePlugin | Directory removal |

**File:** `tui/src/lib/marketplace.ts`

| Line | Function | Hidden Error |
|------|----------|--------------|
| 24-26 | cacheGet | Cache read errors |
| 86 | fetchGitHubTree | HTTP errors |
| 91-93 | fetchGitHubTree | All fetch errors |
| 187-189 | fetchPluginContents | All fetch errors |
| 207-209 | fetchMarketplace | All fetch errors |

**File:** `tui/src/lib/config.ts`

| Line | Function | Hidden Error |
|------|----------|--------------|
| 82-84 | loadClaudeMarketplaces | JSON parse errors |

### Example Problem

```typescript
// Line 91-93 in marketplace.ts
} catch {
  return [];  // HTTP 403 rate limit? DNS failure? Parse error? WHO KNOWS!
}
```

User sees empty plugin list. Could be:
- Rate limiting (fix: set GITHUB_TOKEN)
- Network issue (fix: check connection)
- Invalid JSON (fix: report to marketplace owner)
- Typo in URL (fix: correct the URL)

## Proposed Solutions

### Option A: Structured Error Logging (Recommended)
**Pros:** Minimal code changes, immediate visibility
**Cons:** Requires users to check console
**Effort:** Small
**Risk:** Low

```typescript
} catch (e) {
  console.error(`Failed to fetch GitHub tree for ${repo}/${path}: ${e instanceof Error ? e.message : String(e)}`);
  return [];
}
```

### Option B: Result Type Pattern
**Pros:** Callers can handle errors appropriately
**Cons:** Significant refactoring, changes all signatures
**Effort:** Large
**Risk:** Medium

```typescript
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function fetchGitHubTree(...): Promise<Result<GitHubTreeItem[]>> {
  // ...
  return { ok: false, error: `HTTP ${res.status}` };
}
```

### Option C: Error Aggregation
**Pros:** Can show all errors at end of operation
**Cons:** More complex state management
**Effort:** Medium
**Risk:** Low

```typescript
// InstallResult already has errors: string[]
// Use it consistently
```

## Recommended Action

Replaced empty catches with contextual error logging and surfaced install/update errors.

## Technical Details

### Affected Files
- `tui/src/lib/install.ts` - 12+ locations
- `tui/src/lib/marketplace.ts` - 5+ locations
- `tui/src/lib/config.ts` - 1 location

### Components Affected
- All plugin operations
- Marketplace fetching
- Config loading

## Acceptance Criteria

- [x] All empty catch blocks have at least console.error logging
- [x] Error messages include context (what operation, what file/URL)
- [x] `InstallResult.errors` and `EnableResult.errors` used consistently
- [ ] Network errors suggest checking connection or token
- [ ] Permission errors suggest checking file permissions
- [ ] User-facing errors are actionable

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during silent failure review |

## Resources

- [Error handling best practices](https://www.joyent.com/node-js/production/design/errors)
