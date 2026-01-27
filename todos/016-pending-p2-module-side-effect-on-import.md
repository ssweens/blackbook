---
status: completed
priority: p2
issue_id: "016"
tags: [code-review, architecture, testing]
dependencies: []
---

# Module-Level Side Effect on Import

## Problem Statement

The store module calls `ensureConfigExists()` at module load time, causing a filesystem side effect when the module is imported. This makes testing difficult, causes unexpected behavior, and violates the principle of no side effects on import.

**Why it matters:** Tests may create real config files. Import order becomes important. SSR or other environments may break.

## Findings

### Evidence

**File:** `tui/src/lib/store.ts`

**Line 15:**
```typescript
// Ensure config file exists on module load
ensureConfigExists();
```

### Problems

1. **Testing:** Importing store in tests creates real config file
2. **Import Order:** If store is imported before config paths are set up, wrong location
3. **Unexpected Behavior:** Simply importing a module shouldn't touch filesystem
4. **SSR/Edge:** Would fail in serverless environments without filesystem

## Proposed Solutions

### Option A: Explicit Initialization (Recommended)
**Pros:** Clear, testable, no surprises
**Cons:** Requires calling init somewhere
**Effort:** Small
**Risk:** Low

```typescript
// store.ts
let initialized = false;

export function initializeStore(): void {
  if (initialized) return;
  ensureConfigExists();
  initialized = true;
}

// Don't call ensureConfigExists at module level

// cli.tsx
import { initializeStore } from './lib/store.js';

initializeStore();
render(<App />);
```

### Option B: Lazy Initialization
**Pros:** Automatic, no explicit call needed
**Cons:** First operation is slower
**Effort:** Small
**Risk:** Low

```typescript
let configEnsured = false;

function ensureConfig(): void {
  if (!configEnsured) {
    ensureConfigExists();
    configEnsured = true;
  }
}

// Call at start of each action that needs config
loadMarketplaces: async () => {
  ensureConfig();
  // ...
},
```

### Option C: Factory Function
**Pros:** Full control over initialization
**Cons:** Changes how store is consumed
**Effort:** Medium
**Risk:** Medium

```typescript
export function createStore(options?: { skipConfigInit?: boolean }) {
  if (!options?.skipConfigInit) {
    ensureConfigExists();
  }
  return create<Store>((set, get) => ({ ... }));
}
```

## Recommended Action

Removed module-level side effect and added explicit `initializeStore()`.

## Technical Details

### Affected Files
- `tui/src/lib/store.ts` - remove module-level side effect
- `tui/src/cli.tsx` - add initialization call

### Components Affected
- Store initialization
- Testing setup

## Acceptance Criteria

- [x] No filesystem operations on module import
- [x] Config ensured before first use
- [x] Tests can import store without side effects
- [x] Application still works correctly

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during architecture review |

## Resources

- [Pure modules](https://2ality.com/2019/10/eval-via-import.html#side-effects-in-modules)
