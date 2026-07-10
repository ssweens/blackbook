# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Pi package install detection now scans pi's managed install at `~/.pi/agent/npm/node_modules/` (the only place `pi install` / `pi update` ever writes) in addition to global npm/pnpm/bun. Previously Blackbook only knew about global installs, so a successful `pi update` of an npm package would still report "Update command completed, but it still appears out of date" when a stale global install of the same package was on disk — the global version was being read as the "installed" one even though pi never uses it. When both a pi-managed and a global install of the same package exist, the pi-managed version is now reported as installed, and any extra global managers are still listed in `viaManagers` so uninstall cleans them up.
- Uninstalling a Pi package now also runs `pi remove <name>` when the package is detected as installed via pi's managed location, so removal covers the actual install path instead of leaving it behind.

### Fixed
- Pi bridge installs, updates, uninstalls, and marketplace removals now keep local marketplace/plugin state aligned with pi-plugins. Local marketplace sources stay pointed at the real source-repo directory (for example `/Users/ssweens/src/playbook`) instead of repointing pi-plugins state at Blackbook's compatibility cache.
- Installed-tab plugin rows now include repo-prescribed marketplace plugins even before they are installed locally, so `source_repo` / marketplace entries show up as `in git` instead of disappearing until install.
- Pi bridge plugin detection, per-tool status, and diff views now share one resolver path instead of mixing bridge state with guessed `~/.pi/agent/skills|prompts` paths.
- Pi bridge plugin component paths now follow the bridge's real namespaced install layout: skills under `${os.tmpdir()}/pi-plugins-user-skills/<plugin>-<skill>`, prompts under `${os.tmpdir()}/pi-plugins-user-prompts/<plugin>:<command>.md`, and agents under `~/.pi/agent/agents/pi-plugins-<plugin>-<agent>.md`.
- Plugin/skill detail headers no longer show `drifted` as an item-wide badge for plugin instances; drift remains a per-tool designation on the instance rows.
- Eliminated load-time and navigation flicker in the TUI by making tab layouts respect the actual terminal height. Replaced hardcoded tab container heights (`installed: 34`, etc.) in `App.tsx` with a `useContentHeight()` hook that budgets rows after chrome (TabBar, hint/status bars, padding, notifications). All tabs now receive a `contentHeight` prop and cap their list heights so the rendered frame never exceeds the terminal, preventing Ink's tall-write flicker path.
- `InstalledTab` now dynamically distributes its list budget across Files, Namespaces, Skills, Plugins, and Pi Packages sections. If the terminal is too small, the preview panel is automatically hidden so the lists still fit.
- `DiscoverTab`, `SyncTab`, `ToolsTab`, and `MarketplacesTab` now size their lists from `contentHeight` instead of fixed defaults.

## [0.24.12] - 2026-06-07

### Fixed
- Esc from a skill detail now returns to the namespace detail view instead of the main Installed list, matching user navigation expectations.
- "Track in Source Repo" for skills now follows symlinks when copying (`dereference: true`), so skills installed as symlinks (e.g. from `.agents/skills/` into `.claude/skills/`) are committed as actual content instead of broken relative symlinks.
- `pullbackSkillToSource` now uses namespace-aware paths (`skills/<namespace>/<name>/`) when creating skills for the first time in the source repo.
- Track/pullback actions now report actual success/failure counts instead of silently failing. If a skill can't be tracked, you'll see an error notification rather than a false "Tracked X skills" message.

### Fixed (Playbook repo)
- Replaced 3 broken symlink commits (`ux-heuristics`, `refactoring-ui`, `ui-ux-pro-max`) with actual file content in the playbook source repo. The symlinks pointed to `../../.agents/skills/` which only resolved from the tool install directory, not from the playbook repo clone.

## [0.24.11] - 2026-05-27

### Fixed
- Esc no longer requires a second keypress to close Plugin and Skill detail views in the Installed tab. Root cause was an Ink v7 bug: when a rendered frame exceeded terminal rows, Ink wrote directly to stdout via `clearTerminal + output`, bypassing logUpdate, and the next short render whose output matched logUpdate's stale `previousOutput` was silently skipped. Patched Ink via `tui/scripts/patch-ink.mjs` (idempotent, auto-applied via `postinstall`/`predev`/`prebuild`/`prestart`) to prime logUpdate's state from the tall-write branch.
- ItemDetail now windows the action list to fit the terminal (`rows - chrome`, min 4 visible) with `↑/↓ more above/below` indicators, so detail views never exceed terminal height in the first place.
- Plugin drift compute is now deferred 300ms after detail open and bounded to 4 components / 2 tool-instances concurrent git subprocesses, so the libuv event queue stays free for stdin input while drift runs.
- Removed legacy detail-state shims (`setDetailPlugin`/`setDetailFile`/`setDetailSkill`/`setDetailNamespace`); all detail open/close paths now use the unified `setDetail` setter and read current store state in async callbacks, preventing stale-closure resurrections of a closed detail after async drift resolved.

## [0.24.10] - 2026-05-26

### Fixed
- Explicit `Sync to tool` actions now force-sync `both-changed` file instances, so Pi config/file drift is actually pushed when selected from item detail.
- Local `settings.source_repo` Pi package prescriptions are now read from the source repo's `config/blackbook/config.yaml`, fixing installed packages like `pi-mcp-adapter` incorrectly showing as `not in git`.
- Pi bridge marketplace staging now emits valid regex escaping for relative MCP/source paths, fixing `Unexpected ,` syntax failures during Pi plugin installs.

## [0.24.10] - 2026-05-26

### Changed
- Local `config.yaml` `pi_packages` is no longer used as a prescription source.
- Pi package prescription reads now come only from source-repo config (`config/blackbook/config.yaml`) via local source repo path or URL fetch.
- Pi package track/remove/delete actions now mutate source-repo config only (local config is no longer treated as "in git" truth).

## [0.24.9] - 2026-05-26

### Fixed
- `settings.source_repo` as URL/SSH now supports direct Pi package prescription reads without requiring local source-repo materialization.
- Pi package prescription reads now fetch remote `config/blackbook/config.yaml` on demand and cache `pi_packages` in-memory for the current process.
- Pi package write actions (`track`, `remove`, `delete everywhere`) now transparently use a Blackbook-managed writable git workspace under cache, commit, and push automatically.
- Kept user workflow git-free while preserving fully automated source-repo updates for package prescriptions.

## [0.24.8] - 2026-05-26

### Fixed
- Upgraded `ink` from v5 to v7 and `react` from v18 to v19 to fix a crash when blackbook is installed inside a host environment (e.g. pi) that already has React 19 in its node_modules. Previously, `zustand` would resolve to the host's React 19 while `ink`'s renderer used blackbook's bundled React 18, causing `Cannot read properties of null (reading 'useCallback')` on startup.

## [0.24.7] - 2026-05-26

### Fixed
- Pi bridge compatibility now targets `@ssweens/pi-plugins` (including local-package installs from Pi settings) instead of `pi-claude-marketplace`.
- Pi plugin install staging no longer writes runtime artifacts into the current working repository.
- Pi bridge marketplace staging now uses Blackbook cache (`~/.cache/blackbook/pi-bridge-marketplaces`) instead of repo-local paths.
- Local Claude marketplace checkouts with manifest path-form MCP declarations are staged into Pi-compatible marketplace copies before install.
- Duplicate Pi marketplace records are repointed to the staged compatibility source to avoid stale-source install failures.

## [0.23.0] - 2026-05-18

### Added
- **Universal Action Contract** (`docs/plans/action-contract-checklist.md`) — the single source of truth for all mutations (skills, plugins, files, Pi packages, namespaces, tools).
- Full compliance sweep across `handleEntityAction()`, `handleNamespaceTreeAction()`, tool lifecycle, Sync tab, and legacy marketplace code.
- `refreshDetail()` in store now handles ALL artifact kinds uniformly (including tools and namespaces) using fresh store data.
- Enforcement tests for the full matrix (namespace install, multi-instance, expand/collapse during action, detail preservation).
- Updated `tasks/todo.md` and `tasks/lessons.md` with final convergence status and new patterns.

### Changed
- All non-destructive actions now preserve detail view + tree state (no more unnecessary closes).
- `refreshDetail()` is the ONLY post-mutation detail update path.
- Version bumped to 0.23.0.

### Fixed
- All remaining stale closure and refresh bugs across the app.
- 100% contract compliance for core flows (namespace tree was already compliant; legacy paths now match).
- **Pi standalone skill detection compatibility** — non-flat tools (including Pi) now detect both namespaced (`skills/<namespace>/<skill>/SKILL.md`) and legacy flat (`skills/<skill>/SKILL.md`) skill layouts, so `ssmp` skills installed on disk are correctly shown as installed in the app.
- **Namespace tree skill detail** — pressing Enter on a skill-header in the namespace tree now opens the full standalone skill detail view (identical to opening a skill from the Skills section), with per-tool status, pullbacks, uninstalls, and delete-everywhere actions.

### Tests
- 477/477 passing (added contract enforcement tests + Pi standalone-scan compatibility regressions for flat->namespaced install/migration).
- Full tmux visual verification completed for all tabs, namespace tree actions, multi-instance Claude, Sync tab (no ghosts, immediate updates, correct counts).

[0.24.10]: https://github.com/ssweens/blackbook/compare/v0.24.9...v0.24.10
[0.24.9]: https://github.com/ssweens/blackbook/compare/v0.24.8...v0.24.9
[0.24.8]: https://github.com/ssweens/blackbook/compare/v0.24.7...v0.24.8
[0.24.7]: https://github.com/ssweens/blackbook/compare/v0.24.6...v0.24.7
[0.24.6]: https://github.com/ssweens/blackbook/compare/v0.24.5...v0.24.6
[0.24.5]: https://github.com/ssweens/blackbook/compare/v0.24.4...v0.24.5
[0.24.4]: https://github.com/ssweens/blackbook/compare/v0.24.3...v0.24.4
[0.24.3]: https://github.com/ssweens/blackbook/compare/v0.24.2...v0.24.3
[0.24.2]: https://github.com/ssweens/blackbook/compare/v0.24.1...v0.24.2
[0.24.1]: https://github.com/ssweens/blackbook/compare/v0.24.0...v0.24.1
[0.24.0]: https://github.com/ssweens/blackbook/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/ssweens/blackbook/compare/v0.21.4...v0.23.0

## [0.24.6] - 2026-05-23

### Changed
- **Pi plugin support is now bridge-gated**: Pi plugin actions are enabled only when all required Pi packages are installed:
  - `npm:pi-claude-marketplace`
  - `npm:pi-subagents`
  - `npm:pi-mcp-adapter`
- Pi plugin lifecycle actions (install/update/uninstall/sync) are routed through Pi bridge commands via `pi -p` + `/claude:plugin ...` (no Blackbook projection fallback).
- Added `npm:pi-claude-marketplace` to prescribed `pi_packages` in playbook config so bridge enablement is source-controlled.
- Integration tests and plugin status gating updated to reflect bridge-backed Pi behavior.

## [0.24.5] - 2026-05-21

### Fixed
- Sync tab cursor capped partway through the list when more items loaded after first render. `syncPreview` memo in `App.tsx` only depended on the stable store action, so `maxIndex` froze to the initial batch even though `SyncTab` itself rendered the full list. Added the same data-source deps that `SyncTab` uses so the memo recomputes when files/plugins/skills/pi packages/marketplaces refresh.

## [0.24.4] - 2026-05-21

### Changed
- Diff file list now spells out `NEW in source → not yet in <instance>` for missing files and `EXTRA in <instance> → not in source` for extras, so a brand-new file is obvious instead of relying on the `[+]` glyph alone.
- Updated legend to match.

## [0.24.3] - 2026-05-20

### Changed
- **Single canonical skill-diff path** — extracted `buildSkillDiffTarget()` in `tui/src/lib/diff.ts` and wired it into every entry point that shows a skill detail view:
  - **Sync tab**: `d` on drifted skill row.
  - **Skill detail**: Enter on a drifted per-tool row (now `type: "diff"` instead of `"status"`).
  - **Namespace tree**: Enter on a drifted skill-tool node.
- No more divergent implementations — one helper, one behavior.

## [0.24.2] - 2026-05-20

### Fixed
- **Drifted skills now show which tool and which side drifted** in both Sync tab and namespace tree:
  - Sync tab: `Drifted on Pi (disk)` or `Drifted on Pi (source)` based on git status heuristic.
  - Namespace tree skill headers: `2 tools, 1 missing, drifted on Pi` instead of generic `drifted`.
- **Press `d` on a drifted skill in Sync tab to open diff view** — `openDiffFromSyncItem` now handles skills, building a diff of `SKILL.md` (source vs disk) for the first drifted instance.

## [0.24.1] - 2026-05-20

### Changed
- Tab bar now shows number prefixes on every tab (`1 Sync`, `2 Tools`, `[3] Discover`, etc.) so keyboard shortcuts are visible at a glance.
- Removed broken "(1-6 or tab to switch)" hint — the Tab key was never wired for tab switching.

## [0.24.0] - 2026-05-20

### Added
- **Remove from git** action in every artifact detail view (Pi packages, plugins, skills, namespaces, files).
  - Removes the source-repo prescription/copy only — local tool installs are untouched.
  - Auto-commits and pushes to the source repo immediately; no manual git steps required.
  - **Pi package**: removes `pi_packages` prescription from `config.yaml` and source repo config, then git add/commit/push.
  - **Plugin**: removes plugin dir and `marketplace.json` entry from source repo, then git add/commit/push.
  - **Skill**: removes source repo skill dir, then git add/commit/push.
  - **Namespace**: removes all tracked skill dirs in one commit+push.
  - **File**: removes source file and `config.yaml` entry from both local and source repo config, then git add/commit/push.
- **Installed tab Pi packages now always alphabetical** — default sort uses strict alphabetical order with stable `sourceType`/`source` tiebreakers; installed-first grouping removed.
- **Installed tab shows prescribed (in git) Pi packages** even when not yet installed locally — base filter now includes `installed || recommended`.

### Fixed
- **Pi package install-state source-specific** — `loadPiSettings()` no longer merges global package-manager scan into settings, preventing a local `pi-web-access` install from incorrectly marking the npm `pi-web-access` row as installed.

### Tests
- 484/484 passing.
- Added E2E regression: `shows both installed and in-git-not-installed pi package variants in alphabetical default order`.

## [Unreleased]

### Fixed
- **Multi-instance tool support in namespace tree** — uninstall, sync, and pullback actions now correctly distinguish between multiple instances of the same tool (e.g. `Claude` vs `Claude (Learning)` both using `claude-code` toolId).
  - Uninstall loop now iterates unique `(toolId, instanceId)` pairs from skill installations.
  - Sync and pullback count calculations now check both `toolId` **and** `instanceId`.
  - Action labels now show instance names (`Claude`, `Claude (Learning)`) instead of generic toolIds.
  - Fixed React key collisions that were causing Ink `at ink-box` errors and ghost lines.

## [0.21.3] - 2026-05-17

### Added
- **Expandable tree view for namespace skill detail** — namespace detail now renders an interactive two-level tree instead of a flat action list:
  - **▶/▼ skill rows**: press `→` or `Enter` on a skill row to expand it, revealing per-tool status rows and actions. Press `←` to collapse.
  - **Per-tool status rows**: expanded skills show `└─ Claude: Synced`, `└─ OpenCode: Missing`, etc. for each tool instance.
  - **Per-tool actions**: expanded skills expose `Sync to <tool>`, `Re-sync to <tool> (overwrites disk)`, `Pull to source from <tool>`, `Uninstall from <tool>`, `Uninstall from all tools`, and `Delete everywhere` for each individual skill.
  - **Navigation**: `↑`/`↓` move cursor through the tree (including expanded nodes); `←` on a tool row jumps to parent skill.
- New `NamespaceDetail` component (`components/NamespaceDetail.tsx`) with `buildSkillNodes()` and `buildTreeNodes()` helpers that compute a flat renderable tree from a `NamespaceGroup`.
- Namespace tree input handling in `App.tsx` via `handleNamespaceTreeAction()` — routes per-skill mutations (install, uninstall, pullback, delete) and namespace-level bulk operations (sync, resync, delete everywhere) through spinner-wrapped callbacks.

### Changed
- Namespace detail view no longer uses the flat `ItemDetail` + `buildItemActions` path. Instead, it renders `NamespaceDetail` with its own tree navigation and cursor management.
- `expandedSkills` state added to `App.tsx` to track which skills in the namespace tree are expanded. Cleared on detail close.
- `actionIndex` is automatically clamped when the tree expands/collapses to prevent out-of-bounds cursor.

### Removed
- Old flat namespace action list (skill rows as `open_skill` actions, namespace-level uninstall actions) replaced by the tree view. The `open_skill` action type remains in the `ItemAction` union for potential future use.

## [0.21.2] - 2026-05-17

### Added
- **Namespace-level bulk operations** for skill namespaces in the Installed tab.
  - Namespaced skills are now grouped into collapsible namespace rows (e.g. `ssmp`) showing skill count, tool scope, missing/drifted counts, and a truncated skill list.
  - Press `Enter` on a namespace row to open a detail view with bulk actions:
    - `Sync all N missing skills` — installs every missing skill in the namespace to all enabled tools.
    - `Re-sync all N drifted skills (overwrites disk)` — overwrites drifted installs for every skill in the namespace.
    - `Delete all N skills in <namespace>` — destructive bulk delete everywhere (tool installs + source repo) for the entire namespace.
  - New `NamespaceGroup` type in `install.ts` with `groupSkillsByNamespace()`, `syncNamespaceToAllMissing()`, `resyncNamespaceDrifted()`, and `deleteNamespaceEverywhere()`.
  - `ManagedItem` extended with `_namespace` field; `ItemKind` now includes `"namespace"`.
  - `ItemDetail.tsx` now renders `NamespaceMetadata` with summary stats and skill list.
  - `action-dispatch.ts` handles namespace-specific `sync` (via `syncNamespace`/`resyncNamespace` callbacks) and `delete_everywhere` (via `deleteNamespaceEverywhere`).
- **Individual skill selection from namespace detail** — each skill in a namespace is now listed as a selectable action row. Press `Enter` on a skill to open its individual detail view with full per-tool actions (sync, uninstall, pullback, etc.).
- **Per-tool namespace uninstall** — namespace detail now offers `Uninstall all from <tool>` for each tool where the namespace is installed, removing every skill in that namespace from a single tool instance.
- **`Uninstall from all tools`** namespace action — removes every skill in the namespace from all tools (non-destructive; source repo untouched).
- **Missing namespace-level functions** in `install.ts`: `uninstallNamespaceAll()`, `uninstallNamespaceFromInstance()`, and `pullbackNamespaceToSource()` for complete namespace skill suite coverage.

### Fixed
- Replaced dynamic `require()` calls in `InstalledTab.tsx` with static ESM imports to prevent `require is not defined` crash in the built distribution.

## [0.21.1] - 2026-05-17

### Changed
- Skill listings now display the plugin namespace for namespaced installs: `ssmp/agentic-audio-sensory-system` instead of just `agentic-audio-sensory-system`. This applies to the Installed tab, skill detail header, Sync tab, and Sync preview.
- Sync selection keys for skills now include the namespace to prevent collisions between same-named skills from different plugins.

## [0.21.0] - 2026-05-17

### Added
- **Namespaced plugin component install for non-Claude tools**. Plugin-owned skills, commands, and agents are now installed under a plugin namespace directory for all tools except Claude Code:
  - **Before (flat):** `~/.pi/agent/skills/midi-drum-production/SKILL.md`
  - **After (namespaced):** `~/.pi/agent/skills/music-production/midi-drum-production/SKILL.md`
- New playbook schema field `plugin_flat_install` (default `false`). Set to `true` for Claude Code, which handles plugins natively via its own plugin cache and `plugin.json`.
- `ToolTarget` and `ToolInstance` now carry `pluginFlatInstall: boolean` so install, scan, toggle, and status logic can branch correctly.

### Changed
- `installPluginItemsToInstance`, `linkPluginToInstance`, `togglePluginComponent`, `getPluginToolStatus`, and component scanning now use namespaced destination paths (`<skillsDir>/<pluginName>/<skillName>/`) for non-flat tools.
- `getStandaloneSkills` recursively scans the skills directory for non-flat tools to discover nested plugin-owned skills.
- Plugin skill discovery on non-Claude tool disks now descends into `<pluginName>/` subdirectories.
- Integration tests updated to reflect namespaced paths; the "shared-skill" conflict test is replaced with an independence test since same-named skills from different plugins no longer collide on disk.

### Fixed
- Claude Code user skills that were nested under category folders (e.g. `~/.claude/skills/music-production/...`) were silently ignored by Claude. Blackbook now correctly installs Claude plugin skills through Claude's native plugin system (flat), while installing the same plugin's skills namespaced for Pi/OpenCode/Codex/Amp.

## [0.20.6] - 2026-05-17

### Added
- Pi packages now have a destructive `Delete everywhere` action that removes the local/global package install and deletes the matching `pi_packages` prescription from both the active config and the source repo Blackbook config when present, matching the complete-delete workflows for files, skills, and plugins.

## [0.20.5] - 2026-05-17

### Fixed
- Pi package uninstall now removes npm packages from the globally detected package manager even when the package is installed locally but absent from Pi settings, fixing `No matching package found for npm:...` failures for packages such as `pi-powerline-footer`.
- Pi package uninstall now cleans up mismatched global package manager installs after `pi remove` succeeds, so packages do not remain installed via Bun/pnpm when Pi used another manager.

## [0.20.4] - 2026-05-17

### Added
- `pi_packages` config entries now prescribe desired Pi packages from the synced Blackbook config/source repo, so in-git packages appear in Discover, Installed, and Sync even before they are locally installed.
- Installed local-only Pi packages can be tracked back into `pi_packages` with a `Track in source repo` action.
- Recoverable installed plugins that are no longer prescribed can be tracked back into the source repo marketplace with `Track in source repo`.

### Changed
- Installed local-only Pi packages now show `not in git`, and installed plugins whose marketplace prescription disappeared now show `no longer in marketplace` or `marketplace removed` instead of silently blending into installed state.

## [0.20.3] - 2026-05-16

### Fixed
- Reduced navigation and reload flicker by keeping a single boot-time initial tab refresh, removing tab-switch/tab-mount refresh effects (including repeated Tools status detection), preserving loaded rows during refresh, debouncing the global refresh indicator, and replacing idle loading spinners with explicit `Press R` empty states.

## [0.20.2] - 2026-05-16

### Fixed
- Stabilized Discover plugin-list keyboard navigation so row selection, preview content, and Enter-opened detail stay in sync while scrolling, sorting, and reversing.
- Increased Discover tab vertical space to prevent Ink clipping from hiding the selected row while the preview continued updating.
- Claude-discovered marketplaces can now be removed from the marketplace detail view via Claude's native `claude plugin marketplace remove <name>` path.
- Installed plugin classification now includes marketplace-prescribed plugins whose components exist on tool disks, even after stale plugin cache/manifest records are removed.
- Plugin update actions now refresh an already-open detail view so version and update-available metadata updates immediately.

### Changed
- Removed legacy `compound-docs` from the playbook source repo and cleaned stale compound-engineering cache/tool artifacts so the current `compound-engineering-plugin` marketplace is the only prescription source.

### Tests
- Added deep Discover-tab E2E coverage for non-editing navigation, row/preview/detail mapping, sorting, reversing, and Escape behavior.
- Added store regressions for installed-plugin classification after stale marketplace cleanup and open-detail refresh after plugin updates.
- 451/451 passing.

## [0.20.1] - 2026-05-15

### Added
- **Track in source repo** action for skills not yet in the source repo — copies the skill, commits, and pushes in one action.
- **Auto-commit+push** on all pullback/track actions so the user never needs to interact with git directly.

### Changed
- **`R` refresh** now pulls the source repo (`git pull --rebase --autostash`) before reloading data. Auto-refreshes after mutations skip git.
- **Startup** awaits source repo pull before loading any data, so new skills pushed from elsewhere are visible immediately.
- **Source repo pull** uses `--rebase --autostash` to handle divergent branches cleanly.

### Removed
- **Layout detection** (`canonical`/`legacy-plugin`/`missing`) from skill detail view — replaced with simple "in git" or "not in git".
- **Multi-state git status** rendering (`clean`/`modified`/`untracked`/`unknown`) from detail views and list badges — replaced with single `not in git` badge for skills without a source repo path.

## [0.20.0] - 2026-05-15

### Added
- **Plugin version awareness**: installed and latest plugin versions are tracked end-to-end. The Installed list shows an `update available` badge; the detail view shows `Version: 2.26.5 → 3.8.2`; the action menu offers `Update 2.26.5 → 3.8.2` instead of a generic "Update now".
- **Remote marketplace source inspection**: for Claude-discovered marketplaces backed by GitHub repos, Blackbook fetches the plugin's `plugin.json` metadata and component tree directly from the remote repo (via tarball listing). No local marketplace clones or stale Claude checkout paths are used as source of truth.
- **Cross-marketplace upgrade detection**: when the same plugin name exists in multiple configured marketplaces, the newest available version is selected as the upgrade target regardless of which marketplace the currently installed copy came from.
- **Per-tool installed version in detail rows**: Claude instance status rows show the installed version from `installed_plugins.json`.

### Changed
- **Plugin update uses Claude's native `update` command** with the marketplace-qualified plugin id (`name@marketplace`), ensuring Claude's own plugin manager handles the update for Claude instances.
- **Plugin install/uninstall uses marketplace-qualified ids** for Claude instances to avoid ambiguity when the same plugin exists in multiple marketplaces.
- **Installed plugin detail prefers installed copy** over marketplace row when refreshing, so version/update metadata survives detail panel refreshes.
- **Plugin component display shows latest prescribed set only** — old installed component names (e.g. bare `frontend-design`) no longer appear alongside new names (e.g. `ce-frontend-design`) in the detail view.
- **Standalone skill ownership uses union of old + new names** internally, so deployed artifacts under either naming scheme are attributed to the plugin and don't leak into the Skills section.
- **Local marketplace sources are ignored** — `fetchMarketplace` returns empty for local paths. The configured marketplace URL (remote) is the only prescription surface.
- **Marketplace metadata loaded before installed classification** — if the store has no marketplace plugin data when `loadInstalledPlugins` runs, it fetches marketplaces first so version/component merge is correct on first load.

### Removed
- **Plugin installer conventions module** (`plugin-installer-conventions.ts`) — the hardcoded prefix table for compound-engineering's `ce-*` naming is deleted. Plugin ownership is now determined by the remote marketplace's declared plugin source tree.
- **Local marketplace scanning for plugin ownership** — the code that scanned sibling plugin directories from local marketplace checkouts to attribute skills is removed.

### Fixed
- **Detail panel stale after update**: `refreshDetail` now prefers the installed plugin copy (with merged version metadata) over the bare marketplace row, so the detail view reflects the updated version immediately after an update action.
- **Plugin status cache key** now includes marketplace, version, and component lists, preventing stale cache hits when the plugin object changes between loads.

## [0.19.0] - 2026-05-14

### Added
- **Skills as first-class artifacts** in the Library view alongside Files, Plugins, and Pi Packages.
  - Discovery: walks each enabled tool's `skillsSubdir` AND the source repo's `<repo>/skills/**` recursively (supports nested namespaces like `skills/gbrain/<name>/`).
  - Multi-tool aggregation: one row per skill name showing all tool instances where it's installed ("All tools" when present everywhere).
  - Source-only skills (in source repo but not installed yet) are surfaced as "source only" with `Sync to …` actions.
  - Filters out plugin-owned skills; recognizes the compound-engineering custom installer's `ce-*` prefix when that plugin is installed.
- **Skill detail view** with SKILL.md frontmatter (description, version, author), source repo path, layout indicator (canonical / legacy-plugin / missing), git status, all install paths, and a compact 2-level contents tree.
- **Full skill action menu**: per-tool sync, per-tool re-sync (for drifted), per-tool pullback, per-tool uninstall, plus bulk actions:
  - `Sync to all N missing tools` (when only missing > 1)
  - `Re-sync from source to all N drifted tools (overwrites disk)` (when only drifted > 1)
  - `Sync from source to all (N missing, M drifted)` (when both)
  - `Uninstall from all tools`
- **Delete-everywhere action** for skills, plugins, and files (always last in action menu, red, after "Back"). Removes from every tool install + source repo / plugin cache / config.yaml entry as appropriate.
- **Skills in the Sync tab**: new `Skill drift (N)` section alongside Tool binary updates, File drift, and Plugin drift. Bulk `y to sync` handler covers all four artifact kinds uniformly.
- **Section headers in the Sync list** to delineate tool / file / skill / plugin items.
- **Git status indicators** for skills and files (`✓ clean (committed)` / `✎ modified (uncommitted changes)` / `⚠ untracked (not yet added to git)`), shown in list rows AND detail metadata.
- **Layout detection** for skills in the source repo (canonical, legacy plugin-wrapped, missing). Informational only — migrations are manual via `git mv`.
- **Universal source-path renderer** (`lib/source-presentation.ts`) — the internal `~/.cache/blackbook/source_repos/…` path is never shown to the user. Source paths render as `<owner>/<repo> · relative/path` everywhere (Settings, detail views, etc.).
- **"Source Repo" in Settings** now shows the git remote URL (e.g. `git@github.com:owner/playbook.git`) instead of the internal cache path.
- **Plugin hooks detection**: hook-only plugins (like `learning-output-style`) now show their `Hooks` component and per-tool install state, courtesy of falling back to Claude's `installed_plugins.json` as the source of truth for any non-component-scannable plugin.

### Changed
- **Unified detail state**: replaced 4 per-kind detail vars (`detailPlugin`, `detailFile`, `detailSkill`, `detailPiPackage`) and 3 separate refresh functions with a single discriminated union `detail: DetailArtifact | null` in the store. `setDetail` and `refreshDetail` cover all artifact kinds; `handleEscape` and `handleEnterOnList` no longer need 4-way branching.
- **Unified drift vocabulary**: every user-facing surface now says "drifted" (badge, status row, action label, Sync tab section, banner). Internal type identifiers (`status: "changed"`, `driftKind: "target-changed"`) are unchanged.
- **Skill install + drift state combined**: per-instance status row in the detail view shows `Installed (synced)` (green) or `Installed (drifted)` (yellow) — single label conveys both presence and content match.
- **Compact skill detail metadata**: long skill descriptions truncated to 240 chars; "Installed at" capped to first 4 paths with `(+N more)`; contents tree shows top-level only. Title + key info now always visible on big skills (e.g. `agentic-app-creator` with 6 install paths and 33MB of bundled refs).
- **Section navigation includes Skills** (Tab cycles Files → Skills → Plugins → Pi Packages).
- **Installed tab height** increased and per-section `flexShrink={0}` added so Ink no longer squishes items off-screen when content overflows.
- **Marketplace plugin detection**: when opening a plugin from the Marketplaces tab, we now look up the merged installed version (which has scanned hooks/components from the cache) so the detail view renders the same regardless of entry point.

### Fixed
- **Plugin uninstall state** persisted as "installed" after uninstall — Claude's `installed_plugins.json` was being read but never written. `uninstallPlugin`, `uninstallPluginFromInstance`, and `deletePluginEverywhere` now clean up that file so subsequent scans reflect the new state.
- **Esc handler priority**: pressing Esc with a sticky notification showing previously had the notification eat the keypress, requiring two Esc presses (or another key) to dismiss the detail. Esc now runs before the sticky-notification consumer.
- **`require is not defined`** in `deleteFileEverywhere` — replaced lazy `require()` calls with static ESM imports.
- **ESM correctness**: `repairPiPackageManager` re-export, `writeFileSync` import in install.ts.
- **selectedLibraryItem index map** now accounts for the Skills section (previously off-by-one when selecting a plugin).
- **`require is not defined`** in `base.ts` `atomicWriteFile` / `atomicCopyDir` — replaced with top-level fs imports.

### Refactored
- Single unified `detail` state in the store with a discriminated union (`{ kind: "plugin"|"file"|"skill"|"piPackage"; data; drift? }`). `setDetailPlugin` / `setDetailPiPackage` kept as thin mirrors for backward compatibility with tests.
- Single `refreshDetail()` in the store; `refreshDetailPlugin` and `refreshDetailPiPackage` become thin shims (plugin shim also recomputes drift).
- `getSkillActions` action ordering: status rows → bulk → per-tool re-sync (drifted) → per-tool sync (missing) → per-tool pullback → per-tool uninstall → bulk uninstall → back → destructive delete.
- Drift orientation in `computeFileDetail` aligned with GitHub-style convention (local = head/`+`, source = base/`-`). Three diff tests updated to match.

### Tests
- 446/446 passing.
- New e2e helper `openPluginDetail()` in `app.e2e.test.tsx` that sets both legacy `detailPlugin` and new unified `detail` fields; 11 fixtures migrated.

## [0.18.1] - 2026-03-11

### Fixed
- Source repo status now refreshes immediately after pullback — `refreshAll()` clears the git status cache so Settings reflects repo changes without waiting for the 60-second TTL or restarting the app.

## [0.18.0] - 2026-03-10

### Added
- Unified item architecture (`ManagedItem`) with shared `ItemList`, `ItemDetail`, and centralized action dispatch.
- Unified marketplace presentation for plugin and Pi marketplace rows/details.
- Plugin pullback actions for drifted instances (`Pull to source from <instance>`) with aligned `p` shortcuts in detail and diff views.
- Installed tab loading placeholders for all sections (Files, Plugins, Pi Packages).

### Changed
- Refresh model is now startup scan + manual refresh (`R`) only (removed navigation-triggered and watcher-driven auto-refresh behavior).
- Source repo status is prewarmed/cached for faster Settings rendering.
- Sync-tab plugin drilldown via `d` now opens plugin detail to match other detail-first workflows.

### Fixed
- "Install to Pi" for local source-repo marketplaces now resolves plugin sources relative to repo root when marketplace is under `.claude-plugin/`.
- Per-tool plugin install/uninstall actions correctly target intended instances in unified dispatch.
- Plugin update behavior now only updates instances where plugin is already installed.
- Drift display consistency fixes: suppress noisy `Changed +0 -0` and only mark changed when per-instance diffs exist.

## [0.17.2] - 2026-03-02

### Added
- Brew formula registry entries for Claude Code, OpenCode, and Codex — enables install-method-aware uninstall.
- `detectInstallMethodFromPath()` utility for consistent binary origin detection across the codebase.

### Changed
- Uninstall now matches the detected install method (e.g. `brew uninstall` for brew-installed tools) instead of always using the preferred package manager.
- Tool detail "Migrate to preferred" logic accounts for native install strategies, not just brew vs npm.
- Tool detail labels simplified: "Installed via:" instead of "Detected Install Method:".

### Fixed
- Pi settings loader handles object package entries (e.g. `{ source: "npm:foo", extensions: [...] }`) — was crashing on non-string array items.

## [0.17.1] - 2026-02-28

### Fixed
- Local marketplace plugin sources (e.g. `./plugins/eval-model`) now resolve relative to the repo root, not the `.claude-plugin/` directory — fixes plugins showing "Not supported" with empty components.
- Settings panel diff viewer: stripped git metadata headers, truncated long lines at 100 chars, fixed-height scrollable diff panel (12 lines) with ↑/↓ scroll and Esc to close.
- Settings panel layout stability: all menu items render at constant 1-line height with a single hint line at a fixed position — eliminates jumpiness when navigating.

## [0.17.0] - 2026-02-28

### Added
- **Config management setting** (`config_management`, off by default) gates visibility of tool config files (settings.json, etc.) — files always shown, configs only when enabled.
- **Source repo git status** in Settings panel showing branch, ahead/behind, and pending changes with commit & push and pull actions.
- **Diff viewer** for source repo pending changes — select a changed file in Settings to expand/collapse its git diff inline with syntax-colored +/- lines.
- **Per-tool install/uninstall** actions in plugin detail view — install or remove a plugin from individual tool instances, not just all-or-nothing.
- **Auto-detect source repo marketplace** on setup and pull — automatically registers `.claude-plugin/marketplace.json` from the source repo as a local marketplace.
- **Detect plugins installed in Claude skills/commands/agents directories** — scans tool component dirs directly, not just the plugins cache, and matches against marketplace plugins by name.
- **Detect npm-installed Pi packages** from global node_modules — checks for `pi.extensions` or `keywords: ["pi-package"]` in package.json and adds as `npm:<name>` sources.
- **Playbook `kind` field** (`tool` or `self`) — Blackbook itself is `kind: self` and excluded from plugin tool status, install targets, and installed plugin scanning.
- **npm pi-package pagination** — fetches all results from npm registry (was capped at 250, now fetches all 400+ packages).

### Changed
- Removed `pullback` field from config — pullback actions are always available for any drifted file.
- Removed redundant config entries from files array (OpenCode, Amp, Codex, Claude configs) — these auto-inject from playbook `config_files` when `config_management` is enabled.
- "Not configured" label for synthetic tools replaced with empty string (just detection icon).
- Search box hidden on Discover dashboard — only shown in sub-views (plugins/pi-packages list) and Installed tab where filtering is meaningful.
- Build script now cleans playbooks directory before copying to prevent stale files.

### Fixed
- Local marketplaces always read fresh from disk — no HTTP caching applied to file:// sources.
- Source repo marketplace uses local clone path instead of raw GitHub URL (private repos return 404).
- Stale remote marketplace URLs auto-replaced with local paths on pull.
- `tools:` field on file entries correctly scopes which tool instances the file targets — does not determine file vs config classification.
- Config files correctly gated by `config_management` setting.
- TOML config fully removed — all config now uses YAML (`config.yaml`).
- Early return in Claude plugin detection fixed when `plugins/cache` directory doesn't exist.

## [0.16.1] - 2026-02-28

### Fixed
- Source setup wizard now triggers based on config state (`source_repo` not set) instead of a sentinel file, fixing wizard not appearing on fresh machines.

## [0.16.0] - 2026-02-27

### Added
- Auto-inject playbook-declared config files into the file status list at runtime, making tool config files (Pi Config, OpenCode Config, Amp Config, Codex Config) visible in the UI with pullback capability without manual `config.yaml` entries.
- Config file declarations for OpenCode (`opencode.json`), Amp (`settings.json`), and Codex (`config.toml`) playbooks.

### Changed
- Installed tab now shows a single unified **Files** section instead of separate Configs and Assets sections.
- File detail view shows tool scope for all files and uses `source_repo` from YAML config instead of separate config/asset repo paths.
- Pullback availability is now gated on the `file.pullback` flag directly instead of inferring from file type.
- Pi playbook `config_dir` corrected from `~/.pi` to `~/.pi/agent` (matching actual Pi directory structure); component install paths adjusted accordingly.

### Fixed
- Bun-installed tool binaries (`~/.bun/bin/`) now correctly detected in install method check.
- Install method mismatch check relaxed to pass when preferred package manager is among detected methods (was requiring it to be the only one).

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

[Unreleased]: https://github.com/ssweens/blackbook/compare/v0.21.3...HEAD
[0.21.3]: https://github.com/ssweens/blackbook/compare/v0.21.2...v0.21.3
[0.21.2]: https://github.com/ssweens/blackbook/compare/v0.21.1...v0.21.2
[0.21.1]: https://github.com/ssweens/blackbook/compare/v0.21.0...v0.21.1
[0.21.0]: https://github.com/ssweens/blackbook/compare/v0.20.6...v0.21.0
[0.20.6]: https://github.com/ssweens/blackbook/compare/v0.20.5...v0.20.6
[0.20.5]: https://github.com/ssweens/blackbook/compare/v0.20.4...v0.20.5
[0.20.4]: https://github.com/ssweens/blackbook/compare/v0.20.3...v0.20.4
[0.20.3]: https://github.com/ssweens/blackbook/compare/v0.20.2...v0.20.3
[0.20.2]: https://github.com/ssweens/blackbook/compare/v0.20.1...v0.20.2
[0.20.1]: https://github.com/ssweens/blackbook/compare/v0.20.0...v0.20.1
[0.20.0]: https://github.com/ssweens/blackbook/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/ssweens/blackbook/compare/v0.18.1...v0.19.0
[0.18.1]: https://github.com/ssweens/blackbook/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/ssweens/blackbook/compare/v0.17.2...v0.18.0
[0.17.2]: https://github.com/ssweens/blackbook/compare/v0.17.1...v0.17.2
[0.17.1]: https://github.com/ssweens/blackbook/compare/v0.17.0...v0.17.1
[0.17.0]: https://github.com/ssweens/blackbook/compare/v0.16.1...v0.17.0
[0.16.1]: https://github.com/ssweens/blackbook/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/ssweens/blackbook/compare/v0.14.0...v0.16.0
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
