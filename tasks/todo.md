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

## Plugin Version Awareness / Repo-Prescribed State Hotfix
- [x] Preserve latest plugin versions from marketplace/local plugin metadata
- [x] Read installed Claude plugin versions from `installed_plugins.json`
- [x] Mark installed plugins outdated when installed/latest versions differ
- [x] Surface explicit update labels such as `Update 2.27.0 → 3.8.2`
- [x] Add tests for version detection and cross-marketplace installed-version merge
- [x] Verify typecheck/tests/build
- [x] Visually inspect TUI behavior

## Core Use Cases To Keep Simple
- [x] Know what plugins are installed/prescribed from configured repos/marketplaces
- [x] Make latest-and-greatest update/add obvious and one-action
- [x] Detect repo-prescribed additions/updates/removals, not arbitrary private installer conventions
- [x] Surface local-only/new artifacts as easy to add intentionally
- [x] Make remove-everywhere explicit and safe

## Discover Navigation Regression Deep Dive
- [x] Add deep E2E coverage for Discover tab non-editing navigation
- [x] Scrub dashboard → plugin list → row navigation → detail mapping → escape/back behavior
- [x] Verify list selection, preview, and Enter target stay in sync across enough rows to catch repeats/skips
- [x] Run typecheck/tests and visually verify Discover navigation

## Compound Engineering Installed Status Regression
- [x] Mark marketplace plugins installed from actual tool component status, even when an old installed marketplace key was removed/renamed
- [x] Keep marketplace installed counts derived from plugin rows after status enrichment
- [x] Add store regression coverage for stale installed marketplace key + present tool components
- [x] Refresh open plugin detail after successful update so version/update metadata changes immediately

## Manual Cleanup — Legacy Compound Engineering Artifacts
- [x] Inventory stale compound-engineering marketplace/cache/tool artifacts on disk
- [x] Remove old legacy marketplace/plugin/cache records without touching current `compound-engineering-plugin` v3.8.2 sources
- [x] Remove legacy standalone skill/agent artifacts only when clearly owned by old compound-engineering installs
- [x] Remove `compound-docs` from active tool dirs, playbook source cache, and playbook source repo
- [x] Refresh/verify Blackbook no longer sees stale old compound artifacts

## Review
- Tab switching now performs no automatic network/file refresh work.
- Startup now performs no background loading; user controls loading via `R`.
- Repeated invalid metadata log spam is eliminated and path-like metadata is normalized.
- Plugin classification now uses configured remote marketplace URLs plus their declared remote source paths; local marketplace JSON/checkouts are ignored.
- Compound-engineering shows as one plugin with Pi/OpenCode/Amp synced, `Update 2.26.5 → 3.8.2`, and only non-prescribed OpenCode helper skills remain standalone.
