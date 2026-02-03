# Test Coverage

This project tracks coverage by critical user journeys and system boundaries.

## Test Suite Summary
- **Total Tests:** 151
- **Test Files:** 11

## Critical Paths
- [x] Plugin discovery list loads
- [x] Plugin detail view shows actions and tool status
- [x] Plugin install/update/uninstall flow
- [x] Sync preview generation for partial installs
- [x] Discover → plugin detail → install to all tools (E2E)
- [x] Install failure notification stays on detail (E2E)
- [x] Config multi-file sync (directory, glob patterns)
- [x] Asset path resolution (URLs, absolute, home-relative, relative)

## Boundaries
- [x] Marketplace fetch (remote marketplace.json)
- [x] Tool config loading and updates
- [x] Plugin install/uninstall/update adapters
- [x] Asset sync adapters (hashing + drift detection)
- [x] Config sync adapters (hashing + drift detection, tool-specific filtering, multi-file mappings)
- [x] Diff computation (line counts, unified diff hunks, binary detection)
- [x] Asset repo config parsing (`sync.assets_repo`)
- [x] Multi-file asset mappings (`[[assets.files]]`, `[assets.files.overrides]`)
- [x] Asset source path resolution (`resolveAssetSourcePath`)
- [x] Pi package source type detection (`getSourceType`)
- [x] Pi local marketplace scanning (`scanLocalMarketplace`)
- [ ] Marketplace add/remove persistence

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
- [x] Discover → open plugin → install to all tools → remain on detail view
- [ ] Discover → open plugin → install single tool → success notification
- [ ] Discover → open plugin → update → tool statuses refresh
- [ ] Installed → open plugin → uninstall → removed from list
- [ ] Installed → open asset → sync to all tools → success notification
- [ ] Installed → open config → sync to matching tool → success notification
- [ ] Sync → select items → sync → success summary
- [ ] Marketplaces → add marketplace → appears in list and discover results
- [ ] Marketplaces → update marketplace → updated timestamp shown
- [ ] Tools → toggle enabled → tool list reflects new status
- [ ] Search + sort → filters and ordering update list correctly
- [x] Drifted asset → View diff → shows file list with +N/-N counts
- [x] Drifted config → View diff → shows multi-file list with counts
- [ ] Sync tab → press 'd' on drifted item → opens diff view
- [ ] Sync tab → press 'd' on missing item → opens missing summary

## User Journeys (Problem Paths)
- [x] Install failure surfaces error notification without leaving detail view
- [ ] Update failure surfaces error notification with context
- [ ] Install with no enabled tools shows error notification
- [x] Sync with no drift/missing shows "All enabled instances are in sync"
- [ ] Marketplace fetch failure shows error notification
- [ ] Invalid marketplace URL rejected in add flow
- [ ] Asset source missing shows error status and blocks sync
- [ ] Config source missing shows error status and blocks sync
- [ ] Config with no matching tool instances shows empty state
- [ ] Tool config dir invalid/empty shows error notification

## Gaps (Low Priority)
- [ ] End-to-end TUI navigation across all tabs (discover → installed → tools → sync)
- [ ] Full asset lifecycle (add → drift → sync) end-to-end
- [ ] Full config lifecycle (add → drift → sync) end-to-end
- [ ] Marketplace add/remove persistence
