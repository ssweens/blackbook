# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.2] - 2026-02-27

### Added
- Pi package marketplaces now support git repository sources and cache clones locally under `~/.cache/blackbook/pi_marketplaces/`.
- Add Pi Marketplace modal now accepts local paths and git repository inputs (HTTPS/SSH/GitHub shorthand).

### Fixed
- Sync tab action hint (`Space to toggle · Press y to sync`) is now shown only when at least one syncable item exists.

## [0.15.1] - 2026-02-26

### Changed
- Tool install/update migration UX now requires explicit user choice in the action modal (`m` to toggle migration) instead of automatic fallback migration.
- Tool detail view now surfaces detected install method and a clear migration action label (`Migrate to preferred install tool: <manager>`).
- Tool lifecycle commands now run with inherited stdin to avoid native updater failures such as `stdin is not a terminal`.
- Lifecycle command preview is shown consistently in the tool action modal.

### Fixed
- Discover tab can now be selected reliably when navigating between tabs after sub-view state changes.
- Install method mismatch detection now uses observed install signals (brew path + npm/pnpm/bun globals) instead of assuming preferred manager equals current manager.
- Codex/tool migration messaging now explains current vs preferred method and defers migration until user explicitly opts in.
- Default package manager for new configs is now `npm` (was `pnpm`).

## [0.15.0] - 2026-02-26

### Added
- First-run source setup wizard to quickly add a local source directory or git repository.
- Source setup workflow that can clone a git repo into Blackbook cache (`~/.cache/blackbook/source_repos/...`) and set `settings.source_repo` automatically.
- Automatic import/use of a discovered `config.yaml` from the selected source repository.
- Tool-aware Pi visibility in the UI (Pi marketplaces/packages hidden when Pi is neither enabled nor installed).
- Clear installable state messaging in Tools list/detail for not-installed tools (`i` install action surfaced).

### Changed
- Pi package loading now keys off Pi being enabled **or** detected as installed.
- Full refresh ordering now updates tool detection before Pi package loading.
- File/directory sync tests updated to expect `missing` status when source is absent.

## [0.14.0] - 2026-02-25

### Added
- Settings tab scaffolding in the TUI, including a `SettingsPanel` for editing package manager, source repo, backup retention, and default pullback settings.
- Configurable backup retention (`settings.backup_retention`) applied across file sync modules (file copy, directory sync, glob sync, cleanup, and pullback flows).

### Changed
- Sync/installed status wording now uses explicit drift categories: `source-changed` (sync), `target-changed` (pullback), and `both-changed`.
- Installed view now shows all managed file entries (including missing ones), matching Sync tab visibility.

### Fixed
- Reduced ambiguity in sync UI labels by replacing generic "drifted" wording with change-state-specific status labels.

## [0.13.0] - 2026-02-12

### Added
- Reverse sync (pull back) for configs: press `p` in diff view to copy drifted instance files back to the source repo, making the instance version the new source of truth.
- Source/target legend in diff views showing which side is the instance and which is the source repo.

### Fixed
- Tool shortcuts (`d`, `y`, etc.) from Sync tab no longer conflict when diff/missing overlays are open.
- Spinner output stacking no longer causes duplicate status lines during concurrent tool detection.

## [0.12.1] - 2026-02-07

### Fixed
- Fix infinite re-render loop ("Maximum update depth exceeded") on Sync tab caused by sync preview `useEffect` listing its own output state (`syncPreview`, `syncArmed`) as dependencies. Incremental `toolDetection` updates triggered cascading re-renders. Replaced state deps with refs to break the feedback loop.

## [0.12.0] - 2026-02-07

### Added
- Tool lifecycle management modules: registry (`tool-registry`), managed tool rows (`tool-view`), binary/version detection (`tool-detect`), and lifecycle command runner (`tool-lifecycle`).
- Tools tab detail view with install/update/uninstall shortcuts and progress modal.
- Synthetic default tool rows for unconfigured tools so lifecycle actions are always reachable.
- `sync.package_manager` config support (`npm`/`bun`/`pnpm`) with TOML parse/save round-trip.
- New test coverage for tool registry, managed rows, detection, lifecycle commands, and package-manager config parsing.
- App-level E2E coverage for tool lifecycle version refresh (install/update/uninstall) and Sync tool update item rendering; Vitest now includes `*.test.tsx`.
- Add `plans/tool-lifecycle.md` implementation plan for tool install/update/uninstall lifecycle, package-manager behavior, synthetic tool rows, and coverage updates.

### Changed
- Sync tab is now first in the tab order (and default initial tab), followed by Tools, Discover, Installed, and Marketplaces.
- Tools tab now displays install status/version/update badges and supports opening tool detail with `Enter` instead of toggling directly.
- Tool detection now updates rows incrementally as each tool check completes (instead of waiting for all tools).
- Tools tab now shows a global progress indicator while tool status detection is still running, and clears it only after all tool checks complete.
- Tab-enter refresh now updates Discover/Installed/Marketplaces/Tools data so external changes are picked up without restarting, with a 30-second per-tab TTL to reduce repeated refetching while navigating.
- Added manual `R` refresh shortcut to reload current tab data.
- Added a global loading indicator across tabs (including Sync) while refresh operations are running.
- Reduced refresh flicker by keeping existing tab content visible during background refresh; full loading placeholders now only show when the tab has no data yet.
- Pi package detail now shows compact content counts (extensions, skills, prompts, themes) instead of rendering full item lists.

### Fixed
- Use tool-native update commands for Claude (`claude update`), Amp (`amp update`), and OpenCode (`opencode upgrade`) to update the active binary in PATH.
- Use Claude official installer script for lifecycle install (`curl -fsSL https://claude.ai/install.sh | bash`).
- Use `opencode-ai` package mapping for OpenCode lifecycle install/uninstall detection.
- Detect and warn when tool lifecycle commands succeed but the active binary version in PATH did not actually change (e.g., shadowed installs).
- Include installed tools with available updates as selectable Sync tab items.
- Prevent global key handling conflicts while Diff/Missing Summary overlays are open in Sync flow.
- Asset detail now exposes missing-instance rows that open Missing Summary.
- Config detail now exposes missing-instance rows that open Missing Summary.
- Use `config.sourceFiles` when deriving drifted/missing config instances for accurate multi-file config status.
- Use absolute paths when installing local Pi packages to ensure proper state detection
- Fix path comparison for local package installation by resolving relative paths
- Add name+marketplace fallback for package refresh in detail view
- Compact PiPackageList to single line per package (removed second line showing contents)
- Compact PiPackagePreview to match other previews (fixed 4-line height)
- Move scroll indicators to section headings as range text (e.g., "Configs (showing 1-2 of 4)")
- Remove layout-shifting ↑/↓ indicators from PluginList, AssetList, ConfigList, and PiPackageList
- Fix plugins showing as not installed when supporting tool is disabled (now always show installed if on disk)
- Reduce remote marketplace cache TTL to 10 minutes and surface cache-window info in marketplace detail.

## [0.10.1] - 2026-02-01

### Added
- Marketplace enable/disable toggle for both plugin and Pi marketplaces
- Visual status indicators (● enabled, ○ disabled) in Marketplaces tab
- npm Pi marketplace shown as built-in (non-deletable, but disableable)
- Space key to toggle marketplace enabled state

### Fixed
- LSP-only plugins now correctly show as installed when in Claude's installed_plugins.json

## [0.10.0] - 2026-02-03

### Added
- Pi packages marketplace support for discovering, installing, and managing Pi packages
- npm registry integration fetching up to 250 packages with `pi-package` keyword
- Local directory marketplace support via `[pi-marketplaces]` config section
- Download counts and popularity data from npm (weekly/monthly downloads)
- Summary cards for Plugins and Pi Packages in Discover tab (drill down with Enter)
- Sub-views for browsing full Plugins and Pi Packages lists
- Tab/Shift+Tab navigation to jump between sections in Discover/Installed tabs
- Detail view fetches full package info from npm (description, pi manifest, etc.)
- Sort options: Default, Name, Installed, Popular (press `s` to cycle)
- Default sort: installed first, then local/git alphabetically, then npm by popularity
- Install/uninstall/update Pi packages via `pi` CLI wrapper
- 8 new tests for Pi marketplace functionality (151 total)

### Changed
- Discover tab now shows summary cards for Plugins/Pi Packages instead of inline lists
- Left/Right arrows for main tab navigation (Tab now used for section navigation)
- Status bar shows Pi packages count

## [0.9.0] - 2026-02-02

### Added
- Pi skills support at `~/.pi/agent/skills/`
- Pi prompt templates (commands) support at `~/.pi/agent/prompts/`
- Screenshot capture script (`scripts/capture-screenshots.sh`) using iTerm + imagemagick
- Screenshots for all 5 tabs in README (Discover, Installed, Marketplaces, Tools, Sync)

### Changed
- README updated with new features: config sync, drift detection, diff view, multi-file sync
- Supported Tools table now shows Config Sync column and Pi capabilities

## [0.8.0] - 2026-02-02

### Added
- Diff view for drifted assets and configs showing per-file changes with +N/-N line counts
- Missing summary view for missing-only items showing file inventory
- View diff action in asset/config detail views when items are drifted
- `d` key in Sync tab to open diff/missing summary for selected item
- Instance picker when multiple tool instances are drifted
- Scrollable diff detail view with unified diff format (green/red coloring)
- `diff` npm dependency for line-based diffing
- `assets_repo` config option (defaults to `config_repo` if not set)
- Multi-file asset mappings via `[[assets.files]]` TOML sections with per-file overrides
- Flexible asset source path resolution (URLs, absolute, home-relative, relative to assets_repo)
- Enter key in Sync tab opens detail view for selected item
- Regression tests for asset path resolution and multi-file assets (14 new tests)

### Fixed
- UI section spacing between Configs/Assets/Plugins in Discover and Installed tabs
- Asset filtering crash when asset has no source (multi-file mode)

## [0.7.0] - 2026-02-02

### Added
- Multi-file config sync mappings via `[[configs.files]]` TOML sections
- Directory sync support (trailing `/` convention) and glob patterns for config sources
- Pi tool support (`~/.pi` config directory, config sync only)
- Tests for config parsing and multi-file mapping expansion

### Changed
- Config sources flatten to target directory (no subdirectory structure preserved)
- Partial config installs now show as installed but drifted (for sync visibility)
- ConfigPreview and SyncPreview show mapping summaries with file counts

### Fixed
- Config names with spaces now use safe backup labels
- Empty or missing config mappings throw clear errors

## [0.6.0] - 2026-01-31

### Added
- Config file syncing for tool-specific configurations via `[sync]` and `[[configs]]` TOML sections
- Configs appear in Discover/Installed tabs with sync status and in Sync tab for batch operations
- SHA256-based drift detection for configs (same as assets)

### Fixed
- Plugin uninstall not removing duplicate manifest entries (entries with same dest but different keys)
- Claude plugin status incorrectly showing installed after uninstall (now checks installed_plugins.json)
- Detail view closing after plugin/asset/config actions (now stays on detail and refreshes)
- UI section header alignment in Discover/Installed tabs

## [0.5.6] - 2026-01-28

### Fixed
- Missing vi import in integration test that caused build failures

## [0.5.5] - 2026-01-28

### Added
- Expanded test coverage for sync functionality and asset status helpers

### Changed
- Migrated to npm trusted publishers with OIDC for secure, token-free publishing
- Silenced expected stderr output in tests for cleaner test runs

## [0.5.4] - 2026-01-27

### Fixed
- Typecheck failures in e2e tests due to invalid ToolInstance properties and unsafe nullable handling

## [0.5.3] - 2026-01-27

### Added
- E2E tests for install-to-all-tools success and failure flows
- Test coverage documentation

## [0.5.2] - 2026-01-28

### Added
- Ink E2E tests for install-to-all-tools success and failure flows

### Fixed
- Keep plugin detail view stable when updating or repairing installs
- Avoid sync preview tests touching config locks by stubbing asset status helpers

## [0.5.1] - 2026-01-28

### Fixed
- Added warning notifications to resolve TUI build error

## [0.5.0] - 2026-01-27

### Added
- Asset syncing for user instruction files and directories with per-instance targets
- Asset drift detection and sync previews alongside plugins
- Asset configuration examples in README

### Changed
- Discover and Installed tabs now group plugins and assets
- Sync view now handles missing and drifted assets

## [0.4.3] - 2026-01-27

### Added
- Validation tests for marketplace URL handling and path safety

### Changed
- Plugin installation now uses safer execution and path validation
- File watching refreshes state when config or manifest changes
- Backups are now limited to a single backup per item with safe replacement
- Config and manifest writes are now atomic with file locking

### Fixed
- Prevented GitHub tokens from being sent to non-GitHub domains
- Improved error reporting for marketplace fetches and plugin operations
- Rollback now restores original files on partial installs

## [0.4.2] - 2026-01-26

### Added
- Plugin preview panel showing skills, commands, agents below plugin list

### Changed
- Plugin list no longer expands inline when navigating (eliminates list jumping)
- Plugin detail components section now uses compact comma-separated format

## [0.4.1] - 2026-01-26

### Added
- Multi-instance tool support with per-instance config and status
- Partial install indicator in plugin lists
- Tool instance config examples in README

### Changed
- Plugin install/repair logic now targets enabled instances
- Manifest keys now include tool instance identifiers

### Fixed
- Plugin detail actions now reliably include back navigation

## [0.4.0] - 2026-01-26

### Added
- Tools tab for managing enabled tools
- EditToolModal for changing tool config directories
- Auto-enable tools whose config dirs exist on first run
- Scrolling for MarketplaceList and ToolsList (matches PluginList)
- Sorting in Discover and Installed tabs: `s` cycles sort field (Name/Installed), `S` toggles direction
- Sort indicator displays current sort state
- Screenshot in README

### Changed
- Tools only managed when enabled in config
- Tools enablement stored in config.toml
- StatusBar shows enabled tools
- Consistent height across tabs with fixed content area
- Backups now stored in `~/.cache/blackbook/backups/` with max one per plugin
- Search uses `/` to focus, `Esc` to exit; sort keys `s`/`r` only work when search unfocused
- Blackbook marketplaces take full precedence over Claude's (removable, not read-only)
- Default config now includes `claude-plugins-official` marketplace (user can remove it)
- Symlink backups now use cache directory (consistent with copy backups)

### Fixed
- Search input bug where second character appeared before first
- Store tests no longer pollute user config file
- Plugin names now readable (white instead of grey) in Discover/Installed tabs
- Column alignment in plugin and marketplace lists

## [0.3.0] - 2026-01-26

### Added
- Sorting in Discover and Installed tabs: `s` cycles sort field (Name/Installed), `S` toggles direction
- Sort indicator displays current sort state
- Screenshot in README

### Changed
- Backups now stored in `~/.cache/blackbook/backups/` with max one per plugin
- Search uses `/` to focus, `Esc` to exit; sort keys `s`/`r` only work when search unfocused
- Blackbook marketplaces take full precedence over Claude's (removable, not read-only)
- Default config now includes `claude-plugins-official` marketplace (user can remove it)
- Symlink backups now use cache directory (consistent with copy backups)

### Fixed
- Search input bug where second character appeared before first
- Store tests no longer pollute user config file
- Plugin names now readable (white instead of grey) in Discover/Installed tabs
- Column alignment in plugin and marketplace lists

## [0.2.0] - 2025-01-26

### Added
- Claude marketplace integration: automatically imports marketplaces from `~/.claude/plugins/known_marketplaces.json`
- Claude-sourced marketplaces display "(Claude)" badge and are read-only
- Blackbook marketplaces take precedence when names conflict with Claude marketplaces
- User-configurable marketplaces via `~/.config/blackbook/config.toml`
- Add Marketplace modal in TUI for adding custom marketplace URLs
- Tool config directory overrides in config.toml
- Notifications system for install/uninstall/update feedback
- Plugin detail view with tool installation status
- "Install to all tools" repair action when plugins are partially installed

### Changed
- Marketplaces now include `source` field ("blackbook" or "claude") for origin tracking
- Config file includes helpful comments and examples when first created

## [0.1.0] - 2025-01-25

### Added
- Initial TUI implementation with Ink/React
- Plugin discovery from remote marketplaces
- Plugin installation to multiple AI coding tools:
  - Claude Code (`~/.claude`)
  - OpenCode (`~/.config/opencode`)
  - Amp Code (`~/.config/amp`)
  - OpenAI Codex (`~/.codex`)
- Skills, commands, agents, and hooks support
- MCP and LSP server detection
- Backup system for existing files before overwriting
- Manifest tracking for installed plugins
- Tab-based navigation (Discover, Installed, Marketplaces)
- Search filtering for plugins
- Keyboard-driven interface

### Fixed
- Symlink handling for plugin assets

[Unreleased]: https://github.com/ssweens/blackbook/compare/v0.14.0...HEAD
[0.14.0]: https://github.com/ssweens/blackbook/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/ssweens/blackbook/compare/v0.12.1...v0.13.0
[0.12.1]: https://github.com/ssweens/blackbook/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/ssweens/blackbook/compare/v0.10.1...v0.12.0
[0.10.1]: https://github.com/ssweens/blackbook/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/ssweens/blackbook/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/ssweens/blackbook/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/ssweens/blackbook/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/ssweens/blackbook/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ssweens/blackbook/compare/v0.5.6...v0.6.0
[0.5.6]: https://github.com/ssweens/blackbook/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/ssweens/blackbook/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/ssweens/blackbook/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/ssweens/blackbook/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/ssweens/blackbook/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/ssweens/blackbook/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/ssweens/blackbook/compare/v0.4.3...v0.5.0
[0.4.3]: https://github.com/ssweens/blackbook/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/ssweens/blackbook/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/ssweens/blackbook/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ssweens/blackbook/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ssweens/blackbook/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ssweens/blackbook/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ssweens/blackbook/releases/tag/v0.1.0
