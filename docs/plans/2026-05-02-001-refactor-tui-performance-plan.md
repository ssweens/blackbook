---
title: "Refactor: Fix TUI Performance and Responsiveness"
type: refactor
status: active
date: 2026-05-02
---

# Refactor: Fix TUI Performance and Responsiveness

## Overview

The Blackbook TUI is slow, laggy, and unresponsive. Keystrokes feel delayed, tab switches stall, and the initial load is painful. The root cause is architectural: a 1919-line monolithic `App.tsx` that re-renders on every state change, re-computes expensive derived data on every frame, and performs blocking I/O synchronously during renders.

This plan attacks the problem from three angles:
1. **Reduce re-render frequency** — Zustand selectors, React.memo, route splitting
2. **Reduce per-render cost** — Cache derived data, batch state updates, eliminate filesystem calls from render path
3. **Reduce blocking I/O** — Lazy tab data, deferred drift computation, async file loading

---

## Problem Frame

The TUI has three distinct performance problems that compound:

**P1. Render cascades:** `useStore()` in `App.tsx` subscribes to the *entire* Zustand store. Every `set()` call — tool detection progress, notification dismissal, incremental state updates — triggers a full `App.tsx` re-render. With tool detection updating state once per tool, a 5-tool setup causes 5+ full re-renders before the user can interact.

**P2. Expensive render work:** `App.tsx` runs ~15 `useMemo` hooks on every render that call `pluginToManagedItem()`, which calls `getPluginToolStatus()`, which calls `getToolInstances()` and performs `existsSync()` filesystem checks — for *every plugin*, *every render*. A user with 20 plugins and 5 tools triggers 100 filesystem checks per keystroke.

**P3. Blocking startup I/O:** `refreshAll()` on startup fetches all marketplaces, scans all installed plugins, detects all tools, and checks all file sync statuses — sequentially and synchronously. The UI is frozen until everything completes.

These problems compound: the blocking I/O creates the slow startup, the incremental state updates during I/O create render cascades, and the expensive per-render work makes each re-render feel like a freeze.

---

## Requirements Trace

- R1. Keystroke → visual update latency must feel instant (< 50ms perceived)
- R2. Tab switch must not trigger full data reload or noticeable stall
- R3. Startup must show UI immediately and load data incrementally
- R4. No behavioral regressions in any tab (discover, installed, sync, tools, marketplaces, settings)
- R5. All existing tests continue to pass
- R6. Memory usage must not grow unboundedly with caching

---

## Scope Boundaries

- **In scope:** Zustand store architecture, App.tsx decomposition, render-path optimization, data caching, tab-level lazy loading
- **Out of scope:** Rewriting the sync engine, changing the marketplace fetch protocol, adding virtual scrolling (not needed yet — windowing already exists), redesigning the UI layout
- **Deferred to follow-up work:** Web worker offloading for drift computation, persistent on-disk cache for marketplace data beyond existing HTTP cache

---

## Context & Research

### Relevant Code and Patterns

- `tui/src/App.tsx` — 1919-line monolithic component; single `useStore()` call destructures ~40 properties; contains all input handlers, all useMemo chains, all modal state
- `tui/src/lib/store.ts` — Zustand store with 50+ actions; `refreshAll()` sequentially calls `loadMarketplaces()`, `refreshToolDetection()`, `loadPiPackages()`, `loadFiles()`
- `tui/src/lib/managed-item.ts` — `pluginToManagedItem()` calls `getPluginToolStatus()` → `getToolInstances()` → `existsSync()` for each plugin skill/command/agent on every invocation
- `tui/src/components/ItemList.tsx` — Already has windowing (`computeWindow`) but receives new arrays on every parent render, causing React key churn and re-render of all visible rows
- `tui/src/lib/input-hooks.ts` — `useListInput`, `useDetailInput`, `useDiffInput` are instantiated in `App.tsx` and recreated on every render because their dependency arrays include objects that change reference
- `tui/src/lib/plugin-status.ts` — `getPluginToolStatus()` does filesystem probing with `existsSync()` for every component of every plugin

### Key Metrics (Pre-Refactor)

- App.tsx: 1919 lines, ~40 useMemo/useEffect/useState hooks, ~15 useMemo conversions
- Store: Single global store, no selectors, all components re-render on any state change
- pluginToManagedItem: Called ~3× per plugin per render (installedPlugins, filteredPlugins, marketplaceBrowsePlugins)
- getPluginToolStatus: Called inside pluginToManagedItem; does O(plugins × tools × components) filesystem checks
- refreshAll: 4 sequential blocking phases (marketplace fetch → tool detection → pi packages → file sync checks)

---

## Key Technical Decisions

1. **Zustand selectors over single store subscription:** Replace `const { a, b } = useStore()` with `useStore(s => s.a)` or `useShallow` for object slices. This is the highest-impact change — it eliminates the root cause of render cascades.

2. **Store-level derived state with memoization:** Move `managedItems`, `filteredPlugins`, `filteredFiles`, etc. from `App.tsx` useMemo into the Zustand store computed with a lightweight memoization pattern (e.g., `derive` helper or separate computed store). Derived data should only recompute when its *inputs* change, not on every render.

3. **Route-based component splitting:** Extract each tab into its own component (`SyncTab`, `DiscoverTab`, `InstalledTab`, `ToolsTab`, `MarketplacesTab`, `SettingsTab`). Each tab subscribes only to the state it needs. This isolates re-renders to the active tab.

4. **Batch tool detection updates:** Instead of one `set()` per tool detected, accumulate results and batch-update once at the end. This turns N re-renders into 1.

5. **Lazy tab data loading:** Only run `loadFiles()` when the Sync or Installed tab is active. Only run `loadMarketplaces()` when Discover or Marketplaces is active. The Settings tab needs almost no data.

6. **Cache plugin tool status:** `getPluginToolStatus()` results are pure functions of (plugin, toolInstances). Cache the result and invalidate only when `toolInstances` change (rare) or when plugin install/uninstall happens (explicit action).

---

## Open Questions

### Resolved During Planning

- **Q: Should we use Zustand's `subscribeWithSelector` middleware?**
  A: No — plain Zustand with selector functions is sufficient and avoids middleware complexity. The built-in selector equality check works for primitives; `useShallow` from zustand/shallow handles object slices.

- **Q: Should derived state live in the store or in a separate computed module?**
  A: In the store, using a `computed` pattern. This keeps data flow unidirectional and makes it easy for any component to access derived data without prop drilling.

- **Q: Should we keep `App.tsx` as the input handler hub or distribute input?**
  A: Keep global input in `App.tsx` but move tab-specific input into tab components. Global shortcuts (tab cycling, quit, search focus) stay at the top. Tab-specific navigation (up/down in lists) moves down.

### Deferred to Implementation

- **Q: Exact memoization strategy for derived state — manual memo vs. proxy-based auto-tracking?**
  A: Start with explicit selector memoization; evaluate proxy-based (e.g., `zustand-computed`) if manual becomes unwieldy.

- **Q: Should file sync checks be fully async with incremental UI updates?**
  A: Deferred — first pass makes them lazy per-tab. Full async streaming is a follow-up optimization.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Before (Current)

```
App.tsx ──useStore()──> Entire Store
    │                        │
    ├── useMemo(managedPlugins) ──> pluginToManagedItem × N ──> fs.existsSync × N×C
    ├── useMemo(managedFiles) ────> fileToManagedItem × N
    ├── useMemo(filteredPlugins) ─> sort + filter
    ├── useMemo(filteredFiles) ───> sort + filter
    ├── useEffect(tool detection) ──> set() per tool ──> re-render App
    ├── useEffect(drift for all) ───> computeItemDrift × N plugins
    └── useInput() ──> every keystroke re-renders App
```

### After (Target)

```
App.tsx ──useStore(s=>s.tab)──> only tab changes re-render App
    │
    ├── <TabBar tab={tab} />
    ├── <SearchBox value={search} />
    ├── tab === "sync"    ? <SyncTab />    : null
    ├── tab === "discover"? <DiscoverTab />: null
    ├── tab === "installed"?<InstalledTab/>: null
    ├── tab === "tools"   ? <ToolsTab />   : null
    ├── tab === "marketplaces"? <MarketplacesTab/> : null
    └── tab === "settings"? <SettingsTab />: null

Store ──selector memo──> derived state (managedPlugins, managedFiles, filteredViews)
    │
    ├── refreshToolDetection() ──> batch results ──> single set()
    ├── getPluginToolStatus() ───> cached per (plugin, toolInstances)
    └── loadFiles() ──> only called when sync/installed tab visible
```

### State Access Pattern

```
// Before — everything re-renders on any change
const { tab, marketplaces, installedPlugins, files, ... } = useStore();

// After — only tab changes re-render this component
const tab = useStore((s) => s.tab);

// After — only marketplaces/installedPlugins changes re-render this component
const filteredPlugins = useStore((s) => s.filteredPlugins);
```

---

## Implementation Units

- [ ] U1. **Add Zustand selectors and useShallow to all store consumers**

**Goal:** Eliminate the root cause of render cascades by making every component subscribe only to the state it renders.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `tui/src/App.tsx`
- Modify: `tui/src/components/ItemList.tsx`
- Modify: `tui/src/components/SyncList.tsx`
- Modify: `tui/src/components/TabBar.tsx`
- Modify: `tui/src/components/HintBar.tsx`
- Modify: `tui/src/components/StatusBar.tsx`
- Modify: `tui/src/components/Notifications.tsx`
- Modify: `tui/src/components/SettingsPanel.tsx`
- Modify: `tui/src/components/ItemDetail.tsx`
- Modify: `tui/src/components/PluginPreview.tsx`
- Modify: `tui/src/components/PiPackagePreview.tsx`
- Modify: `tui/src/components/FilePreview.tsx`
- Modify: `tui/src/components/SyncPreview.tsx`
- Modify: `tui/src/components/ToolsList.tsx`
- Modify: `tui/src/components/MarketplaceList.tsx`
- Modify: `tui/src/components/ToolDetail.tsx`
- Modify: `tui/src/components/DiffView.tsx`
- Modify: `tui/src/components/SearchBox.tsx`
- Test: `tui/src/lib/store.test.ts`

**Approach:**
- Audit every `useStore()` call in the codebase
- Replace bare `useStore()` with `useStore(s => s.specificProp)` for primitives
- Replace object/array slices with `useStore(selector, shallow)` using `zustand/shallow`
- For components that need many props, consider splitting into smaller components or using multiple selector calls
- In `App.tsx`, start by only selecting `tab` at the top level; pass tab-specific state down through tab components that have their own selectors

**Patterns to follow:**
- Zustand docs: "Selecting multiple state slices" with `shallow`

**Test scenarios:**
- Happy path: Component renders correctly with selector-based state access
- Integration: Changing a notification does not re-render ItemList
- Integration: Tool detection progress does not re-render TabBar

**Verification:**
- All existing tests pass
- Manual test: Press a key in the TUI and verify only the relevant component re-renders (can use `react-devtools-core` or console.log in components)

---

- [ ] U2. **Move derived state computation from App.tsx into the store with memoization**

**Goal:** Eliminate per-render recomputation of `managedPlugins`, `managedFiles`, `filteredPlugins`, `filteredFiles`, `filteredPiPackages`, `marketplaceRows`, etc.

**Requirements:** R1, R2, R6

**Dependencies:** U1

**Files:**
- Modify: `tui/src/lib/store.ts`
- Modify: `tui/src/App.tsx`
- Create: `tui/src/lib/store-derived.ts`
- Test: `tui/src/lib/store.test.ts`

**Approach:**
- Create a `store-derived.ts` module that exports memoized selector functions for expensive derived state
- Key selectors to memoize:
  - `selectManagedPlugins(state)` — `pluginsToManagedItems(state.installedPlugins)`
  - `selectManagedFiles(state)` — `filesToManagedItems(state.files)`
  - `selectFilteredPlugins(state, search, sortBy, sortDir)`
  - `selectFilteredFiles(state, search, sortBy, sortDir)`
  - `selectFilteredPiPackages(state, search, sortBy, sortDir)`
  - `selectMarketplaceRows(state)`
  - `selectSyncPreview(state)`
- Use a simple memoization strategy: compare input references (Zustand state is immutable, so reference equality is sufficient)
- The store should pre-compute these on every `set()` if the underlying data changed, or expose them as getter functions
- Remove the corresponding `useMemo` hooks from `App.tsx`

**Technical design:**
A lightweight computed pattern in the store:
```
function derive<T>(deps: () => any[], compute: () => T): () => T {
  let lastDeps: any[] = [];
  let lastResult: T;
  return () => {
    const nextDeps = deps();
    if (depsChanged(lastDeps, nextDeps)) {
      lastDeps = nextDeps;
      lastResult = compute();
    }
    return lastResult;
  };
}
```

**Patterns to follow:**
- Existing `useMemo` logic in `App.tsx` (lift and shift, don't rewrite algorithms)

**Test scenarios:**
- Happy path: Derived selectors return correct data
- Edge case: Selector returns cached result when inputs haven't changed
- Edge case: Selector recomputes when search string changes
- Edge case: Selector recomputes when installedPlugins array changes reference

**Verification:**
- All existing tests pass
- `console.time` around derived selectors shows zero recompute on irrelevant state changes

---

- [ ] U3. **Extract tab components from App.tsx**

**Goal:** Isolate re-renders to the active tab only. Reduce App.tsx from 1919 lines to ~200 lines (layout shell + global input + modal routing).

**Requirements:** R1, R2, R4

**Dependencies:** U1, U2

**Files:**
- Modify: `tui/src/App.tsx`
- Create: `tui/src/tabs/SyncTab.tsx`
- Create: `tui/src/tabs/DiscoverTab.tsx`
- Create: `tui/src/tabs/InstalledTab.tsx`
- Create: `tui/src/tabs/ToolsTab.tsx`
- Create: `tui/src/tabs/MarketplacesTab.tsx`
- Create: `tui/src/tabs/SettingsTab.tsx`
- Create: `tui/src/tabs/index.ts`
- Test: `tui/src/app.e2e.test.tsx`

**Approach:**
- Each tab component receives minimal props and uses its own `useStore` selectors
- Move tab-specific state and handlers from App.tsx into the corresponding tab:
  - `SyncTab`: `syncPreview`, `syncSelection`, `syncArmed`, `selectedIndex`, sync shortcuts
  - `DiscoverTab`: `filteredPlugins`, `filteredPiPackages`, `discoverSubView`, `subViewIndex`, summary cards
  - `InstalledTab`: `managedFiles`, `managedPlugins`, `managedPiPackages`, `selectedIndex`, search, sort
  - `ToolsTab`: `managedTools`, `toolDetection`, `detailTool`, tool shortcuts
  - `MarketplacesTab`: `marketplaceRows`, `selectedMarketplaceRow`
  - `SettingsTab`: already mostly self-contained
- Keep in App.tsx:
  - Modal/diff/detail overlay routing (these are global)
  - Global shortcuts (tab cycling, quit, R refresh)
  - SearchBox (shared between discover and installed)
- Move `useListInput`, `useDetailInput`, `useDiffInput` calls into the tabs that use them
- The detail overlays (ItemDetail, DiffView, etc.) can remain rendered by App.tsx since they float over any tab

**Execution note:** Do this as a pure move refactor first — copy existing JSX and handlers into tab files with minimal changes, verify tests pass, then clean up.

**Patterns to follow:**
- Existing component structure in `tui/src/components/`

**Test scenarios:**
- Happy path: Each tab renders the same content as before
- Happy path: Tab switching works with left/right arrows
- Integration: Detail overlay opens correctly from each tab
- Edge case: Rapid tab switching doesn't crash or lose state

**Verification:**
- All existing tests pass
- `App.tsx` line count < 300
- No regressions in any tab's visual output

---

- [ ] U4. **Batch tool detection state updates**

**Goal:** Turn N incremental re-renders into 1 batched re-render during tool detection.

**Requirements:** R1, R3

**Dependencies:** U1

**Files:**
- Modify: `tui/src/lib/store.ts`
- Test: `tui/src/lib/store.test.ts`

**Approach:**
- In `refreshToolDetection()`, accumulate all results in a local object first
- After all `detectTool()` calls complete (whether success or error), do a single `set()` that updates both `toolDetection` and `toolDetectionPending` atomically
- This eliminates the intermediate re-renders that happen as each tool reports back
- Consider using `Promise.allSettled` instead of `Promise.all` so one failing detection doesn't stall the batch

**Patterns to follow:**
- Existing `refreshToolDetection` structure in `store.ts`

**Test scenarios:**
- Happy path: All tools detected, single state update
- Edge case: One tool detection fails, others still update
- Edge case: Empty tool registry (no re-renders)

**Verification:**
- All existing tests pass
- `react-devtools` or console.log shows only 1 re-render during tool detection instead of N

---

- [ ] U5. **Lazy-load tab data — only fetch when tab is visible**

**Goal:** Eliminate blocking startup I/O for tabs the user isn't looking at.

**Requirements:** R2, R3

**Dependencies:** U3

**Files:**
- Modify: `tui/src/lib/store.ts`
- Modify: `tui/src/App.tsx`
- Modify: `tui/src/tabs/SyncTab.tsx`
- Modify: `tui/src/tabs/DiscoverTab.tsx`
- Modify: `tui/src/tabs/InstalledTab.tsx`
- Modify: `tui/src/tabs/ToolsTab.tsx`
- Modify: `tui/src/tabs/MarketplacesTab.tsx`
- Test: `tui/src/app.e2e.test.tsx`

**Approach:**
- Remove the global `refreshAll()` call from the startup `useEffect` in App.tsx
- Each tab component calls its own data loader on mount (via `useEffect`):
  - `DiscoverTab`: `loadMarketplaces()`, `loadPiPackages()`
  - `InstalledTab`: `loadInstalledPlugins()`, `loadFiles()`, `loadPiPackages()`
  - `SyncTab`: `getSyncPreview()` (which depends on plugins + files + tools)
  - `ToolsTab`: `refreshManagedTools()`, `refreshToolDetection()`
  - `MarketplacesTab`: `loadMarketplaces()`, `loadPiPackages()`
  - `SettingsTab`: minimal — `refreshAll()` is overkill, just load what's needed
- Use the existing `TAB_REFRESH_TTL_MS` pattern to prevent redundant reloads
- Keep the manual `R` refresh shortcut working globally
- The `sync` tab still needs plugin + file data, but it can share what's already loaded by other tabs rather than re-fetching

**Patterns to follow:**
- Existing `refreshTabData()` in App.tsx

**Test scenarios:**
- Happy path: App starts and shows UI immediately with loading indicators
- Happy path: Switching to Discover tab triggers marketplace load
- Happy path: Switching to Installed tab triggers plugin/file load
- Integration: Data loaded by one tab is available to another without re-fetch
- Edge case: Rapid tab switching doesn't trigger redundant loads

**Verification:**
- All existing tests pass
- App renders UI within < 100ms of process start (measured with `console.time`)

---

- [ ] U6. **Memoize list components with React.memo and stable keys**

**Goal:** Prevent `ItemList`, `SyncList`, and `MarketplaceList` from re-rendering when parent changes but their props don't.

**Requirements:** R1, R6

**Dependencies:** U2, U3

**Files:**
- Modify: `tui/src/components/ItemList.tsx`
- Modify: `tui/src/components/SyncList.tsx`
- Modify: `tui/src/components/MarketplaceList.tsx`
- Modify: `tui/src/components/ToolsList.tsx`
- Modify: `tui/src/components/TabBar.tsx`
- Modify: `tui/src/components/SearchBox.tsx`
- Modify: `tui/src/components/HintBar.tsx`
- Modify: `tui/src/components/StatusBar.tsx`
- Test: `tui/src/components/ItemList.test.tsx` (if exists, else create)

**Approach:**
- Wrap `ItemList`, `SyncList`, `MarketplaceList`, `ToolsList`, `TabBar`, `SearchBox`, `HintBar`, `StatusBar` with `React.memo`
- Ensure stable array references pass to these components (guaranteed by U2 store-level memoization)
- Ensure stable function references for callbacks (may need `useCallback` in parent tabs, or move callbacks into the memoized child)
- For `ItemList`, the `key` prop on rows uses `${item.kind}:${item.marketplace}:${item.name}` — this is already stable
- Verify that `computeWindow` in ItemList doesn't recompute unnecessarily by ensuring `items` reference is stable

**Patterns to follow:**
- React.memo best practices: memoize the component, not the props

**Test scenarios:**
- Happy path: Parent re-renders but memoized child does not
- Edge case: Child re-renders correctly when its specific props change

**Verification:**
- All existing tests pass
- React DevTools Profiler shows list components skipping re-render on parent keystrokes

---

- [ ] U7. **Cache plugin tool status to eliminate filesystem calls from render path**

**Goal:** Remove the O(plugins × tools × components) `existsSync` calls that happen on every render.

**Requirements:** R1, R6

**Dependencies:** U2

**Files:**
- Modify: `tui/src/lib/plugin-status.ts`
- Modify: `tui/src/lib/managed-item.ts`
- Modify: `tui/src/lib/store.ts`
- Test: `tui/src/lib/plugin-status.test.ts` (if exists, else create)

**Approach:**
- `getPluginToolStatus(plugin)` is a pure function of `(plugin, toolInstances)`
- Cache results in a `Map<string, ToolInstallStatus[]>` keyed by `JSON.stringify(plugin) + toolInstancesVersion`
- Invalidate the cache when:
  - `toolInstances` change (config edit, tool enable/disable)
  - A plugin is installed or uninstalled (explicit action)
- Store the cache in the Zustand store or as a module-level variable with explicit invalidation
- `pluginToManagedItem()` should receive pre-computed tool statuses from the cache instead of calling `getPluginToolStatus()` directly
- Consider also caching `getToolInstances()` if config reads are expensive (they read YAML from disk)

**Patterns to follow:**
- Existing `getPluginToolStatus` and `pluginToManagedItem` contract

**Test scenarios:**
- Happy path: Cache returns correct status on first call
- Happy path: Cache returns same result without filesystem calls on second call
- Edge case: Cache invalidates when toolInstances change
- Edge case: Cache invalidates after plugin install/uninstall
- Integration: `pluginToManagedItem` uses cached status correctly

**Verification:**
- All existing tests pass
- No `existsSync` calls during keystroke handling (can verify by monkey-patching fs in a test or using a performance trace)

---

- [ ] U8. **Profile, measure, and verify end-to-end improvements**

**Goal:** Quantify the improvement and ensure no regressions.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** U1–U7

**Files:**
- Create: `tui/src/lib/perf.ts`
- Create: `tui/src/lib/perf.test.ts`
- Modify: `tui/src/cli.tsx` (optional — add `--perf` flag)

**Approach:**
- Create a lightweight `perf.ts` utility for timing and counting:
  - `perf.mark(name)` / `perf.measure(name)` for timing key operations
  - `perf.count(name)` for counting re-renders, filesystem calls, etc.
  - Disabled by default, enabled via env var `BLACKBOOK_PERF=1`
- Add marks around:
  - `App.tsx` render time
  - `refreshAll()` total time
  - `loadFiles()` time
  - `pluginToManagedItem()` call count
  - `getPluginToolStatus()` call count
  - `existsSync` call count (monkey-patch during perf mode)
- Run before/after measurements on a representative setup (e.g., 3 marketplaces, 20 plugins, 5 tools)
- Document the results in a comment at the top of `perf.ts`

**Test scenarios:**
- Happy path: Perf utility measures operations correctly
- Edge case: Perf utility is a no-op when disabled

**Verification:**
- All existing tests pass
- Startup time reduced by ≥ 50%
- Keystroke re-render count reduced by ≥ 80%
- `existsSync` calls during idle interaction reduced to zero

---

## System-Wide Impact

- **Interaction graph:** The Zustand store is the central dependency. Changing how components subscribe affects every component in the tree. The `useStore` hook is used in ~15 components.
- **Error propagation:** No change to error handling patterns. Store actions remain the same.
- **State lifecycle risks:** Caching `getPluginToolStatus` introduces a cache invalidation requirement. If invalidation is missed, the UI may show stale install status. Mitigation: invalidate on all explicit install/uninstall actions and on config changes.
- **API surface parity:** No external API changes.
- **Unchanged invariants:** All existing Zustand actions (`installPlugin`, `loadFiles`, etc.) keep their signatures and behavior. Only the *subscription pattern* changes.

---

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Stale cache in plugin tool status | Medium | Medium | Invalidate aggressively on all mutating actions; add test coverage |
| Tab component split breaks existing e2e tests | Medium | High | Do pure move first; run e2e tests after each unit; keep App.tsx routing intact |
| Selector refactoring misses a subscription, causing UI to not update | Medium | High | Use TypeScript strict mode; test all interactive flows; add integration tests |
| Memory leak from memoized derived state | Low | Low | Ensure memoization uses bounded caches; don't memoize per-search-term (that's what useMemo in component is for) |
| Lazy tab loading creates race conditions | Low | Medium | Use existing `tabRefreshInFlightRef` pattern; avoid overlapping loads |

---

## Phased Delivery

### Phase 1 — Foundation (U1, U4)
Selectors + batching. Highest impact, lowest risk. Should make the TUI feel immediately more responsive.

### Phase 2 — Data (U2, U7)
Store-level memoization + plugin status cache. Eliminates the expensive per-render work.

### Phase 3 — Structure (U3, U5, U6)
Tab extraction + lazy loading + component memoization. Completes the architecture cleanup.

### Phase 4 — Validation (U8)
Measure and verify. Document the gains.

---

## Documentation / Operational Notes

- Update `tui/README.md` (if it exists) or `AGENTS.md` with guidance on:
  - Always use Zustand selectors, never bare `useStore()`
  - Keep derived state in the store, not in component useMemo
  - Add `React.memo` to new list components
- The perf utility can be left in the codebase for future debugging

---

## Sources & References

- **Origin:** User report — TUI slow and clunky
- Related code: `tui/src/App.tsx`, `tui/src/lib/store.ts`, `tui/src/lib/managed-item.ts`, `tui/src/lib/plugin-status.ts`
- Related tests: `tui/src/app.e2e.test.tsx`
- External docs: [Zustand selectors guide](https://docs.pmnd.rs/zustand/guides/prevent-rerenders-with-equality-fn)
