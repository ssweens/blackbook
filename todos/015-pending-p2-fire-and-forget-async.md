---
status: completed
priority: p2
issue_id: "015"
tags: [code-review, bug, async]
dependencies: []
---

# Fire-and-Forget Async Call in addMarketplace

## Problem Statement

In the `addMarketplace` store action, `updateMarketplace()` is called without `await`, making it a fire-and-forget operation. Errors from this async call are lost, and the caller doesn't know if the marketplace was successfully fetched.

**Why it matters:** User adds a marketplace, sees "success", but plugins never load due to a hidden fetch error.

## Findings

### Evidence

**File:** `tui/src/lib/store.ts`

**Lines 377-378:**
```typescript
notify(`Added marketplace "${name}"`, "success");

// Fetch plugins for the new marketplace
get().updateMarketplace(name);  // NO AWAIT!
```

### Problem

1. User adds marketplace
2. `notify()` shows success immediately
3. `updateMarketplace(name)` starts fetching in background
4. If fetch fails (network error, invalid URL, 404), error is unhandled
5. User sees empty marketplace with no explanation

## Proposed Solutions

### Option A: Await and Handle Error (Recommended)
**Pros:** Proper error handling, user knows outcome
**Cons:** Slightly slower perceived response
**Effort:** Small
**Risk:** Low

```typescript
addMarketplace: async (name, url) => {
  const { notify } = get();
  const marketplaces = get().marketplaces;
  if (marketplaces.some((m) => m.name === name)) {
    notify(`Marketplace "${name}" already exists`, "error");
    return;
  }

  addMarketplaceToConfig(name, url);

  set({
    marketplaces: [
      ...marketplaces,
      {
        name,
        url,
        isLocal: url.startsWith("/"),
        plugins: [],
        availableCount: 0,
        installedCount: 0,
        autoUpdate: false,
        source: "blackbook",
      },
    ],
  });

  notify(`Fetching plugins from "${name}"...`, "info");

  try {
    await get().updateMarketplace(name);
    notify(`Added marketplace "${name}" with ${get().marketplaces.find(m => m.name === name)?.availableCount || 0} plugins`, "success");
  } catch (e) {
    notify(`Added marketplace "${name}" but failed to fetch plugins: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
},
```

### Option B: Background with Error Notification
**Pros:** Fast initial response
**Cons:** Two notifications
**Effort:** Small
**Risk:** Low

```typescript
notify(`Added marketplace "${name}"`, "success");

get().updateMarketplace(name).catch((e) => {
  notify(`Failed to fetch plugins from "${name}": ${e.message}`, "error");
});
```

## Recommended Action

Errors from marketplace refresh are now caught and surfaced to the user.

## Technical Details

### Affected Files
- `tui/src/lib/store.ts` - `addMarketplace` action (line 347)

### Components Affected
- Marketplace adding

## Acceptance Criteria

- [x] `updateMarketplace` awaited or error handled
- [x] User notified of fetch success/failure
- [x] No unhandled promise rejections

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-27 | Completed | Implemented fixes and updated tests |
| 2025-01-27 | Created | Identified during pattern review |

## Resources

- [Unhandled rejections in Node.js](https://nodejs.org/api/process.html#event-unhandledrejection)
