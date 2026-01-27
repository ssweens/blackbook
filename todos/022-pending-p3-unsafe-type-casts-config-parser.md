---
status: pending
priority: p3
issue_id: "022"
tags: [code-review, quality, type-safety]
dependencies: []
---

# Unsafe Type Casts in Config Parser

## Problem Statement

The TOML parser in config.ts uses unsafe type assertions that bypass TypeScript's type checking.

**Why it matters:** If the interface changes, these lines won't trigger compile errors but will cause runtime issues.

## Findings

### Evidence

**File:** `tui/src/lib/config.ts`

**Lines 183, 186, 193, 196:**
```typescript
(result.tools![currentTool] as Record<string, string>)[normalizedKey] = value;
(currentInstance as Record<string, string>)[normalizedKey] = value;
(result.tools![currentTool] as Record<string, boolean>)[normalizedKey] = value;
(currentInstance as Record<string, boolean>)[normalizedKey] = value;
```

## Proposed Solutions

### Option A: Typed Setters (Recommended)
**Pros:** Type-safe, clear intent
**Cons:** More verbose
**Effort:** Small
**Risk:** Low

```typescript
function setToolConfigValue(
  config: ToolConfig,
  key: keyof ToolConfig,
  value: string | boolean
): void {
  if (key === 'enabled' && typeof value === 'boolean') {
    config.enabled = value;
  } else if (key === 'configDir' && typeof value === 'string') {
    config.configDir = value;
  }
}
```

### Option B: Use a TOML Parser Library
**Pros:** Battle-tested, handles edge cases
**Cons:** Dependency
**Effort:** Medium
**Risk:** Low

```typescript
import { parse } from '@iarna/toml';

export function loadConfig(configPath?: string): TomlConfig {
  const path = configPath || getConfigPath();
  if (!existsSync(path)) return { marketplaces: {}, tools: {} };

  const content = readFileSync(path, "utf-8");
  return parse(content) as TomlConfig;  // Still needs validation
}
```

## Technical Details

### Affected Files
- `tui/src/lib/config.ts` - TOML parser section

## Acceptance Criteria

- [ ] No unsafe `as Record<string, T>` casts
- [ ] Type-safe property assignment
- [ ] Parser still handles all valid config formats

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2025-01-27 | Created | Identified during pattern review |
