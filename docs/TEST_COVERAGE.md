# Test Coverage

This project tracks coverage by critical user journeys and system boundaries.

## Test Suite Summary
- **Total Tests:** 472
- **Test Files:** 41

## Critical Paths
- [x] Plugin discovery list loads
- [x] Discover plugin keyboard navigation preserves row/preview/detail selection mapping across scrolling, sorting, reversing, Enter, and Escape (E2E)
- [x] Marketplace plugin rows stay installed when tool components exist even if an old installed marketplace key was removed/renamed
- [x] Plugin update refreshes an already-open detail view with fresh installed/latest version metadata
- [x] Plugin detail view shows actions and tool status
- [x] Installed tab includes managed file entries with diff/missing detail access
- [x] Plugin install/update/uninstall flow
- [x] Plugin per-component enable/disable config parsing and round-trip
- [x] Sync preview generation for partial installs
- [x] Discover → plugin detail → install to all tools (E2E)
- [x] Install failure notification stays on detail (E2E)
- [x] Config multi-file sync (directory, glob patterns)
- [x] Asset path resolution (URLs, absolute, home-relative, relative)
- [x] Tool lifecycle core flows (registry/view/detect/command adapters)
- [x] Tools lifecycle UI refreshes version/status after install → update → uninstall (E2E)
- [x] Sync tab shows tool update items with installed/latest version delta (E2E)
- [x] Discover and Sync include in-git Pi packages that are missing locally
- [x] Installed local-only Pi packages and orphaned plugins expose explicit not-in-git/marketplace status badges
- [x] Startup hydrates the initial tab automatically while avoiding cross-tab blocking
- [x] Tab switching does not auto-refresh tab data, tab loaders, or Tools detection after the boot refresh (E2E)
- [x] Non-silent refreshes preserve already-loaded plugin/file rows instead of flipping loaded flags false
- [x] YAML config loading with zod validation
- [x] First-launch bootstrap creates config.yaml with inferred tools and prepopulated file entries
- [x] YAML config.local.yaml deep merge with merge-by-key semantics
- [x] Unified files list with check/apply module orchestration
- [x] File sync routes directory sources through `directory-sync` (avoids EISDIR in file-copy)
- [x] Three-way state tracking (source-changed, target-changed, both-changed drift detection)
- [x] Playbook config_files auto-injection for uncovered targets
- [x] Override-based coverage prevents duplicate synthetic entries
- [x] Pullback detection and target → source sync
- [x] Conflict detection for both-changed files
- [x] Cleanup detection of orphaned state entries
- [x] Plugin install/remove via module wrappers

## Boundaries
- [x] Marketplace fetch (remote marketplace.json)
- [x] Tool config loading and updates
- [x] Plugin install/uninstall/update adapters
- [x] Asset sync adapters (hashing + drift detection)
- [x] Config sync adapters (hashing + drift detection, tool-specific filtering, multi-file mappings)
- [x] Diff computation (line counts, unified diff hunks, binary detection)
- [x] Asset repo config parsing (`sync.assets_repo`)
- [x] Multi-file asset mappings (`[[assets.files]]`, `[assets.files.overrides]`)
- [x] Plugin component config parsing (`[plugins.*.*]` sections)
- [x] Plugin component config save/load round-trip
- [x] Plugin component config cleanup of empty entries
- [x] Asset source path resolution (`resolveAssetSourcePath`)
- [x] Pi package source type detection (`getSourceType`)
- [x] Pi local marketplace scanning (`scanLocalMarketplace`)
- [x] Repo-prescribed `pi_packages` merge with marketplace/local package state
- [x] Pi package uninstall falls back to the detected global package manager when Pi settings has no matching package
- [x] Pi package uninstall cleans up mismatched global package manager installs after `pi remove`
- [x] Pi package delete-everywhere removes local installs and matching `pi_packages` prescriptions from active and source-repo configs
- [x] Local-only Pi package tracking writes `pi_packages` back to YAML config
- [x] Recoverable orphan plugin tracking copies plugin contents into the source repo marketplace
- [x] Tool lifecycle registry + managed tool rows (synthetic default rows)
- [x] Tool binary/version detection adapters (`which`, `--version`, `npm view`)
- [x] Tool lifecycle command adapters (install/update/uninstall with timeout/cancel)
- [ ] Marketplace add/remove persistence
- [ ] Reverse config sync (instance → source with backup)

## Config & Asset Path Tests (asset-paths.test.ts)
- [x] `assets_repo` config parsing from sync section
- [x] `assets_repo` without `config_repo`
- [x] `getAssetsRepoPath()` returns assetsRepo when set
- [x] `getAssetsRepoPath()` falls back to configRepo
- [x] `resolveAssetSourcePath()` passes through http URLs
- [x] `resolveAssetSourcePath()` passes through https URLs
- [x] `resolveAssetSourcePath()` expands home-relative paths
- [x] `resolveAssetSourcePath()` passes through absolute paths
- [x] `[[assets.files]]` section parsing
- [x] `[assets.files.overrides]` section parsing
- [x] Mixed simple and multi-file assets
- [x] Multiple `[[assets.files]]` in same asset
- [x] Asset without source (multi-file only)

## Diff Engine Tests (diff.test.ts)
- [x] `computeDiffCounts` - line counting (add/remove)
- [x] `computeDiffCounts` - identical content
- [x] `computeDiffCounts` - empty strings
- [x] `computeUnifiedDiff` - hunk structure
- [x] `computeUnifiedDiff` - context lines
- [x] `computeUnifiedDiff` - multiple hunks
- [x] `isBinaryFile` - detection by extension
- [x] `computeFileDetail` - real file comparison
- [x] `buildAssetDiffTarget` - per-instance targets
- [x] `buildAssetMissingSummary` - missing file lists
- [x] `buildConfigDiffTarget` - config file targets
- [x] `buildConfigMissingSummary` - missing config files
- [x] `getDriftedAssetInstances` - filters drifted
- [x] `getMissingAssetInstances` - filters missing

## Config Sync Tests (config-sync.test.ts)
- [x] Expands mappings with directories and globs
- [x] Supports legacy source/target format
- [x] Throws when mappings have no files

## User Journeys (Happy Paths)
- [x] Discover → navigate plugin list → Enter opens the highlighted plugin, not an adjacent/stale row
- [x] Discover → open plugin → install to all tools → remain on detail view
- [ ] Discover → open plugin → manage components → toggle skill → disabled in config
- [ ] Discover → open plugin → install single tool → success notification
- [ ] Discover → open plugin → update → tool statuses refresh
- [ ] Installed → open plugin → uninstall → removed from list
- [ ] Installed → open file → sync to all tools → success notification
- [ ] Installed → open file → sync to matching tool → success notification
- [ ] Sync → select items → sync → success summary
- [ ] Sync → tool update item selected → updates binary version status
- [ ] Marketplaces → add marketplace → appears in list and discover results
- [ ] Marketplaces → update marketplace → updated timestamp shown
- [ ] Manual tab refresh (`R`) reloads current tab data
- [ ] Tools → toggle enabled → tool list reflects new status
- [ ] Tools → detection in progress shows global checking indicator until all tool checks complete
- [ ] Global loading indicator appears across tabs (including Sync) during refresh operations
- [ ] Search + sort → filters and ordering update list correctly
- [x] Drifted file → View diff → shows file list with +N/-N counts
- [ ] Sync tab → press 'd' on drifted item → opens diff view
- [ ] Sync tab → press 'd' on missing item → opens missing summary
- [ ] Diff view → press 'p' on file diff → pulls instance files back to source repo
- [ ] Reverse sync backs up source file before overwriting
- [ ] Reverse sync skips files that are already in sync

## User Journeys (Problem Paths)
- [x] Install failure surfaces error notification without leaving detail view
- [x] Local-only Pi package uninstall succeeds when `pi remove npm:...` reports no matching Pi settings package
- [x] Pi package delete-everywhere removes the in-git source-repo prescription instead of leaving the package to reappear on refresh
- [ ] Update failure surfaces error notification with context
- [ ] Install with no enabled tools shows error notification
- [x] Sync with no drift/missing shows "All enabled instances are in sync"
- [ ] Marketplace fetch failure shows error notification
- [ ] Invalid marketplace URL rejected in add flow
- [ ] File source missing shows error status and blocks sync
- [ ] File with no matching tool instances shows empty state
- [ ] Tool config dir invalid/empty shows error notification

## Settings Tab
- [ ] Settings tab displays all 4 settings (package_manager, source_repo, backup_retention, default_pullback)
- [ ] Enum setting (package_manager) cycles through values on Enter
- [ ] Boolean setting (default_pullback) toggles on Enter
- [ ] Text setting (source_repo) enters edit mode on Enter, saves on Enter, cancels on Esc
- [ ] Number setting (backup_retention) enters edit mode, validates range 1-100
- [ ] Settings persist to config.yaml after change
- [ ] Settings tab keyboard guard allows tab navigation but delegates up/down/enter to panel
- [x] Source repo actions include Pull latest entry and upstream state visibility logic is unit tested

## Gaps (Low Priority)
- [ ] End-to-end TUI navigation across all tabs (discover → installed → tools → sync → settings)
- [ ] Full file lifecycle (add → drift → sync) end-to-end
- [ ] Marketplace add/remove persistence
