---
status: completed
priority: p1
issue_id: "001"
tags: [code-review, security, critical]
dependencies: []
---

# Command Injection via Plugin Names

## Problem Statement

Plugin names from untrusted marketplace JSON are interpolated directly into shell commands using string concatenation with `execAsync()`. A malicious marketplace can provide plugin names containing shell metacharacters that execute arbitrary commands on the user's system.

**Why it matters:** This is a complete system compromise vulnerability. An attacker controlling a marketplace can execute any command with the user's privileges, including `rm -rf ~/*`, installing malware, or exfiltrating credentials.

## Findings

### Evidence

**File:** `tui/src/lib/install.ts`

**Line 34:** execClaudeCommand interpolates args directly
```typescript
await execAsync(`claude plugin ${args}`, {
  env: { ...process.env, CLAUDE_CONFIG_DIR: instance.configDir },
});
```

**Line 94:** git clone with interpolated ref and repoUrl
```typescript
await execAsync(`git clone --depth 1 --branch "${ref}" "${repoUrl}" "${tempDir}"`);
```

**Line 267:** Plugin name passed to shell
```typescript
await execClaudeCommand(instance, `install "${plugin.name}"`);
```

### Attack Vector

A malicious marketplace returns:
```json
{
  "name": "test\"; rm -rf ~/*; echo \"",
  "source": "./plugins/test"
}
```

When installed, this executes:
```bash
claude plugin install "test"; rm -rf ~/*; echo ""
```

Similar attacks work for `ref` (git branch injection) and `repoUrl`.

## Proposed Solutions

### Option A: Use execFile with Array Arguments (Recommended)
**Pros:** Complete protection against shell injection, standard security practice
**Cons:** Requires refactoring all exec calls
**Effort:** Medium
**Risk:** Low

```typescript
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);

async function execClaudeCommand(instance: ToolInstance, command: string, pluginName: string): Promise<void> {
  await execFileAsync("claude", ["plugin", command, pluginName], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: instance.configDir },
  });
}

// For git:
await execFileAsync("git", ["clone", "--depth", "1", "--branch", ref, repoUrl, tempDir]);
```

### Option B: Strict Input Validation
**Pros:** Can be added quickly as defense in depth
**Cons:** Allowlist may be too restrictive or miss edge cases
**Effort:** Small
**Risk:** Medium (validation bypass possible)

```typescript
const SAFE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function validatePluginName(name: string): void {
  if (!SAFE_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid plugin name: ${name}`);
  }
}
```

### Option C: Both A + B
**Pros:** Defense in depth
**Cons:** More code
**Effort:** Medium
**Risk:** Lowest

## Recommended Action

Refactored to `execFile` with argument arrays and added validation for plugin names, refs, and repo URLs.

## Technical Details

### Affected Files
- `tui/src/lib/install.ts` - lines 34, 94, 267, 310, 537, 582, 617, 1030

### Components Affected
- Plugin installation
- Plugin uninstallation
- Plugin enable/disable
- Plugin update
- Plugin sync

## Acceptance Criteria

- [x] All `execAsync()` calls replaced with `execFile()` using array arguments
- [x] Plugin names validated against strict pattern before any operation
- [x] Git refs validated against pattern `^[a-zA-Z0-9._/-]+$`
- [x] Repository URLs validated as proper URLs
- [x] Unit tests added for validation functions
- [ ] Security test added attempting injection

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during security review |

## Resources

- [Node.js child_process security](https://nodejs.org/api/child_process.html#child_processexecfilefile-args-options-callback)
- [OWASP Command Injection](https://owasp.org/www-community/attacks/Command_Injection)
