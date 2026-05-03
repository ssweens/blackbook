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

## Next Initiative — Playbook-Centric Rearchitecture

### Origin docs
- [x] Requirements: `docs/brainstorms/2026-05-02-local-skill-lifecycle-utility-requirements.md`
- [x] Initial (superseded) plan: `docs/plans/2026-05-02-002-local-skill-lifecycle-implementation-plan.md`
- [x] Master plan: `docs/plans/2026-05-02-003-playbook-rearchitecture-plan.md`

### Phase 1 — Tool Artifact Inventory (complete)
- [x] Inventory skeleton with current-codebase facts: `docs/architecture/tool-inventory.md`
- [x] External research pass per tool (Claude, Codex, OpenCode, Pi all verified; Amp partial)
- [x] All 11 cross-cutting substrate decisions locked
- [x] MCP support per tool documented (4/5 native; Pi excludes by design)
- [x] Bundle paradigm distinction documented (artifact bundles vs code packages)
- [x] Provenance detection specified per tool
- [x] Out-of-v1-scope concepts catalogued
- [ ] Amp full verification deferred (acceptable; common-spine-only adapter for v1)

### Phase 2 — Playbook Schema Design (draft for review)
- [x] Substrate questions resolved in Phase 1
- [x] Draft `docs/architecture/playbook-schema.md`
- [ ] User review of draft
- [ ] Validate schema against representative example playbooks (after review)

### Phase 3 — Migration Design (draft for review)
- [x] Decision: no automated forward migration; manual one-time move
- [x] Cold start (`blackbook init`) designed in detail
- [x] Adapter defaults refactor scoped
- [x] Hard-cut at v2.0; no deprecation period
- [x] Produce `docs/architecture/migration-plan.md`
- [ ] User review

### Phase 4 — Engine Rebuild (pending)
- [ ] Playbook model loader/writer (`tui/src/lib/playbook/`)
- [ ] Per-tool adapters with uniform contract (`tui/src/lib/adapters/<tool>/`)
- [ ] Bidirectional sync engine (`tui/src/lib/sync/`)
- [ ] Confirmation-gated mutation paths
- [ ] Adapter conformance test suite

### Phase 5 — UI Rebuild (pending)
- [ ] 4-tab structure: Dashboard, Playbook, Sources, Settings
- [ ] Per-tool drill-in views (tool-native)
- [ ] Drift visualization
- [ ] Confirmation flows
- [ ] e2e coverage
