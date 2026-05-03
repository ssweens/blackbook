# TUI Performance Refactor

## Phase 1 — Foundation
- [x] U1: Zustand selectors — Replace bare `useStore()` with selector-based subscriptions
- [x] U4: Batch tool detection — Accumulate results, single `set()` update

## Phase 2 — Data
- [ ] U2: Store-level memoization — Move derived state from App.tsx useMemo into store
- [x] U7: Cache plugin tool status — Memoize `getPluginToolStatus()` to eliminate fs calls

## Phase 3 — Structure
- [ ] U3: Extract tab components — Split App.tsx into tab-specific components
- [ ] U5: Lazy tab loading — Only fetch data for visible tabs
- [x] U6: React.memo on lists — Wrap list components to skip unnecessary re-renders

## Phase 4 — Validation
- [ ] U8: Perf profiling — Measure before/after improvements

## Quality Gates
- [ ] All tests pass: `cd tui && pnpm test`
- [ ] Type check passes: `cd tui && pnpm typecheck`
- [ ] Build succeeds: `cd tui && pnpm build`
