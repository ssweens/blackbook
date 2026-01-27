---
status: completed
priority: p2
issue_id: "013"
tags: [code-review, ux, robustness]
dependencies: []
---

# No Validation of External Dependencies

## Problem Statement

The code assumes `git` and `claude` CLI are installed and available, but never checks. If they're missing, operations fail with cryptic error messages (or silently fail due to empty catch blocks).

**Why it matters:** Users get unhelpful errors. First-time users may not realize they need git installed. Users without Claude CLI enabled will see failures.

## Findings

### Evidence

**File:** `tui/src/lib/install.ts`

**Line 94:** Git assumed available
```typescript
await execAsync(`git clone --depth 1 --branch "${ref}" "${repoUrl}" "${tempDir}"`);
// If git not installed: Error: Command failed: git clone ...
// /bin/sh: git: command not found
```

**Lines 33-40:** Claude CLI assumed available
```typescript
async function execClaudeCommand(instance: ToolInstance, args: string): Promise<void> {
  await execAsync(`claude plugin ${args}`, { ... });
}
// If claude not installed: similar cryptic error
```

### User Experience Problem

1. User installs blackbook
2. Tries to install a plugin
3. Gets error: "Error: Command failed: git clone..."
4. No indication that git needs to be installed
5. Or worse: empty catch swallows the error, plugin just "fails"

## Proposed Solutions

### Option A: Preflight Checks on Startup (Recommended)
**Pros:** Clear upfront, one-time cost
**Cons:** Slightly slower startup
**Effort:** Small
**Risk:** Low

```typescript
interface DependencyStatus {
  name: string;
  available: boolean;
  version?: string;
  required: boolean;
  message?: string;
}

async function checkDependencies(): Promise<DependencyStatus[]> {
  const deps: DependencyStatus[] = [];

  // Check git
  try {
    const { stdout } = await execAsync('git --version');
    deps.push({ name: 'git', available: true, version: stdout.trim(), required: true });
  } catch {
    deps.push({
      name: 'git',
      available: false,
      required: true,
      message: 'Git is required for downloading plugins. Install from https://git-scm.com/',
    });
  }

  // Check claude CLI (only if claude instances enabled)
  if (hasEnabledClaudeInstances()) {
    try {
      const { stdout } = await execAsync('claude --version');
      deps.push({ name: 'claude', available: true, version: stdout.trim(), required: false });
    } catch {
      deps.push({
        name: 'claude',
        available: false,
        required: false,
        message: 'Claude CLI not found. Claude Code plugins will be installed via direct file copy.',
      });
    }
  }

  return deps;
}
```

### Option B: Just-in-Time Checks
**Pros:** No startup cost, checks only when needed
**Cons:** Error appears later in workflow
**Effort:** Small
**Risk:** Low

```typescript
async function requireGit(): Promise<void> {
  try {
    await execAsync('git --version');
  } catch {
    throw new Error(
      'Git is required to download plugins but was not found. ' +
      'Please install Git from https://git-scm.com/'
    );
  }
}
```

### Option C: Graceful Degradation
**Pros:** Still works without some deps
**Cons:** More complex logic
**Effort:** Medium
**Risk:** Medium

## Recommended Action

Added dependency checks before git/claude operations and clearer error messages.

## Technical Details

### Affected Files
- `tui/src/lib/install.ts` - add checks before git/claude operations
- `tui/src/cli.tsx` or startup - preflight checks
- `tui/src/lib/store.ts` - expose dependency status

### Dependencies to Check
- `git` - required for plugin download
- `claude` - optional, for Claude Code plugin management

## Acceptance Criteria

- [x] Checks before required dependencies are used
- [x] Clear error messages when dependencies missing
- [ ] UI shows dependency status (optional)
- [x] Documentation lists prerequisites
- [x] Unit test: mock missing git, verify clear error

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during architecture review |

## Resources

- [which npm package](https://www.npmjs.com/package/which) (for finding executables)
