# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/ssweens/blackbook/compare/v0.9.0...HEAD
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
