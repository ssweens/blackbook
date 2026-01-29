# Test Coverage

This project tracks coverage by critical user journeys and system boundaries.

## Critical Paths
- [x] Plugin discovery list loads
- [x] Plugin detail view shows actions and tool status
- [x] Plugin install/update/uninstall flow
- [x] Sync preview generation for partial installs
- [x] Discover → plugin detail → install to all tools (E2E)
- [x] Install failure notification stays on detail (E2E)

## Boundaries
- [x] Marketplace fetch (remote marketplace.json)
- [x] Tool config loading and updates
- [x] Plugin install/uninstall/update adapters
- [x] Asset sync adapters (hashing + drift detection)
- [ ] Marketplace add/remove persistence

## User Journeys (Happy Paths)
- [x] Discover → open plugin → install to all tools → remain on detail view
- [ ] Discover → open plugin → install single tool → success notification
- [ ] Discover → open plugin → update → tool statuses refresh
- [ ] Installed → open plugin → uninstall → removed from list
- [ ] Installed → open asset → sync to all tools → success notification
- [ ] Sync → select items → sync → success summary
- [ ] Marketplaces → add marketplace → appears in list and discover results
- [ ] Marketplaces → update marketplace → updated timestamp shown
- [ ] Tools → toggle enabled → tool list reflects new status
- [ ] Search + sort → filters and ordering update list correctly

## User Journeys (Problem Paths)
- [x] Install failure surfaces error notification without leaving detail view
- [ ] Update failure surfaces error notification with context
- [ ] Install with no enabled tools shows error notification
- [x] Sync with no drift/missing shows “All enabled instances are in sync”
- [ ] Marketplace fetch failure shows error notification
- [ ] Invalid marketplace URL rejected in add flow
- [ ] Asset source missing shows error status and blocks sync
- [ ] Tool config dir invalid/empty shows error notification

## Gaps
- [ ] End-to-end TUI navigation across all tabs (discover → installed → tools → sync)
- [ ] Full asset lifecycle (add → drift → sync) end-to-end
