---
status: pending
priority: p3
issue_id: "019"
tags: [code-review, quality, maintainability]
dependencies: []
---

# Magic Strings Should Be Constants

## Problem Statement

The codebase has 30+ repeated magic strings that should be extracted to constants for maintainability and type safety.

**Why it matters:** Typos cause silent bugs. Renaming requires find-replace. No IDE autocomplete.

## Findings

### Evidence

| String | Occurrences | Files |
|--------|-------------|-------|
| `"claude-code"` | 15+ | install.ts, config.ts |
| `"main"` (branch) | 6 | install.ts, marketplace.ts, config.ts |
| `"SKILL.md"` | 10+ | install.ts |
| `".md"` (extension) | 15+ | install.ts, marketplace.ts |
| `"skills"`, `"commands"`, `"agents"`, `"hooks"` | 30+ | Multiple files |
| `"user"`, `"project"` (scope) | 5+ | Multiple files |

## Proposed Solutions

### Option A: Constants File (Recommended)
**Pros:** Centralized, type-safe, IDE-friendly
**Cons:** One more file
**Effort:** Small
**Risk:** None

```typescript
// constants.ts
export const TOOL_IDS = {
  CLAUDE_CODE: "claude-code",
  OPENCODE: "opencode",
  AMP_CODE: "amp-code",
  OPENAI_CODEX: "openai-codex",
} as const;

export const DEFAULT_BRANCH = "main";

export const COMPONENT_TYPES = ["skills", "commands", "agents", "hooks"] as const;
export type ComponentType = typeof COMPONENT_TYPES[number];

export const SKILL_MANIFEST = "SKILL.md";

export const EXTENSIONS = {
  MARKDOWN: ".md",
  JSON: ".json",
} as const;

export const SCOPES = {
  USER: "user",
  PROJECT: "project",
} as const;
```

## Recommended Action

Create constants file and update imports.

## Technical Details

### Affected Files
- New: `tui/src/lib/constants.ts`
- Update: `tui/src/lib/install.ts`
- Update: `tui/src/lib/config.ts`
- Update: `tui/src/lib/marketplace.ts`

## Acceptance Criteria

- [ ] Constants file created
- [ ] All magic strings replaced with constants
- [ ] TypeScript gets type safety from const assertions
- [ ] No functionality changes

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2025-01-27 | Created | Identified during pattern review |
