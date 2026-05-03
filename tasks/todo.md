# TUI Performance Refactor

## Phase 1 — Foundation
- [x] U1: Zustand selectors — Replace bare `useStore()` with selector-based subscriptions
- [x] U4: Batch tool detection — Accumulate results, single `set()` update

## Phase 2 — Data
- [x] U2: Store-level memoization — Move derived state from App.tsx useMemo into store
- [x] U7: Cache plugin tool status — Memoize `getPluginToolStatus()` to eliminate fs calls

## Phase 3 — Structure
- [x] U3: Extract tab components — Split App.tsx into tab-specific components
- [x] U5: Lazy tab loading — Only fetch data for visible tabs
- [x] U6: React.memo on lists — Wrap list components to skip unnecessary re-renders

## Phase 4 — Validation
- [x] U8: Perf profiling — Lightweight measurement utility with counters for renders, store updates, fs calls, and function invocations

## Hotfix — Manual-Only Performance Mode
- [x] Disable all startup auto-loading in `App.tsx`
- [x] Disable automatic background plugin drift scans
- [x] Short-circuit heavy list filtering/sorting on unrelated tabs
- [x] Normalize path-like marketplace metadata values to valid item names
- [x] Deduplicate repeated validation error logs

## Quality Gates
- [x] All tests pass: `cd tui && pnpm test`
- [x] Type check passes: `cd tui && pnpm typecheck`
- [x] Build succeeds: `cd tui && pnpm build`

## Review
- Tab switching now performs no automatic network/file refresh work.
- Startup now performs no background loading; user controls loading via `R`.
- Repeated invalid metadata log spam is eliminated and path-like metadata is normalized.
