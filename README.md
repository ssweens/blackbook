# Blackbook

[![npm version](https://img.shields.io/npm/v/@ssweens/blackbook.svg)](https://www.npmjs.com/package/@ssweens/blackbook)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![CI](https://github.com/ssweens/blackbook/actions/workflows/ci.yml/badge.svg)](https://github.com/ssweens/blackbook/actions/workflows/ci.yml)

Plugin manager for agentic coding tools built with React/Ink. Install skills, commands, agents, and synced assets from marketplaces to Claude Code, OpenAI Codex, OpenCode, Amp, and Pi. Sync config files and shared instruction files (AGENTS.md/CLAUDE.md) across all your tools with drift detection and diff viewing.

![Blackbook TUI - Discover tab](assets/discover-tab.png)

![Blackbook TUI - Installed tab](assets/installed-tab.png)

![Blackbook TUI - Marketplaces tab](assets/marketplaces-tab.png)

![Blackbook TUI - Tools tab](assets/tools-tab.png)

![Blackbook TUI - Sync tab](assets/sync-tab.png)

## Features
- **Unified AGENTS.md/CLAUDE.md management** — Sync shared instruction files across tools with per-tool target overrides
- **Config file syncing** — Sync tool-specific configs (settings, themes, keybindings) from a central repository
- **Drift detection & diff view** — SHA256-based drift detection with unified diff viewing for changed files
- **Reverse sync (pull back)** — Pull drifted config changes from deployed instances back to the source repo
- **Multi-file sync** — Directory and glob pattern support for syncing multiple files at once
- **Unified plugin management** — Install skills, commands, agents, hooks, MCP/LSP servers across tools
- **Marketplace support** — Browse and install from official and community marketplaces
- **Pi packages** — Built-in npm marketplace for Pi coding agent extensions, themes, and custom tools
- **TUI interface** — Interactive terminal UI with tabs for Sync, Tools, Discover, Installed, and Marketplaces
- **Cross-tool sync** — Install plugins to multiple tools at once, detect incomplete installs
- **Per-component control** — Disable individual skills, commands, or agents within a plugin

## Plugin Model

Everything is a plugin. Plugins can include skills, commands, agents, hooks, MCP servers, and LSP servers.

## Supported Tools

| Tool | Config Directory | Skills | Commands | Agents | Config Sync |
|------|------------------|--------|----------|--------|-------------|
| Claude Code | `~/.claude` | ✓ | ✓ | ✓ | ✓ |
| OpenAI Codex | `~/.codex` | ✓ | — | — | ✓ |
| OpenCode | `~/.config/opencode` | ✓ | ✓ | ✓ | ✓ |
| Amp Code | `~/.config/amp` | ✓ | ✓ | ✓ | ✓ |
| Pi | `~/.pi` | ✓ | ✓* | — | ✓ |

\* Pi uses `agent/skills/` for skills and `agent/prompts/` for prompt templates (`/name` syntax)

## Installation

For local development, use Node.js 23.x and pnpm.

```bash
# Install from npm
npm install -g @ssweens/blackbook
blackbook
```

Or run directly with npx:

```bash
npx @ssweens/blackbook
```

Or clone and run from source:

```bash
git clone https://github.com/ssweens/blackbook ~/src/blackbook
cd ~/src/blackbook/tui
pnpm install
pnpm start
```

## Usage

Launch the TUI:

```bash
cd ~/src/blackbook/tui && pnpm start
```

Blackbook opens on the **Sync** tab by default.

### Navigation

| Key | Action |
|-----|--------|
| Tab / ← → | Switch tabs |
| ↑ ↓ | Navigate lists |
| Enter | Select / open details |
| Space | Install/uninstall selected plugin |
| / | Focus search (Discover/Installed) |
| d | View diff for drifted item (Sync tab) |
| p | Pull back config changes to source (Diff view) |
| R | Refresh current tab data |
| Esc | Back from details or exit search |
| q | Quit |

### Shortcuts

- **Discover/Installed**: `s` cycle sort (name/installed), `r` reverse sort, `R` refresh tab data
- **Marketplaces**: `u` update marketplace, `r` remove marketplace, `R` refresh all marketplaces/packages
- **Tools**: `Enter` open detail, `i` install, `u` update, `d` uninstall, `Space` toggle enabled, `e` edit config dir, `R` refresh detection
- **Sync**: `y` sync selected items (missing/drifted assets/configs/plugins and tool updates; press twice to confirm), `R` refresh sync inputs

Blackbook also refreshes data when entering tabs (Discover, Installed, Marketplaces, Tools), throttled with a 30-second TTL per tab to avoid constant refetching/flicker while navigating. A loading indicator is shown across tabs (including Sync) while refresh is in progress.

## Configuration

Blackbook uses YAML configuration files:

```
~/.config/blackbook/config.yaml       # Primary config
~/.config/blackbook/config.local.yaml # Machine-specific overrides (optional, gitignored)
```

### YAML Config

```yaml
# ~/.config/blackbook/config.yaml
settings:
  source_repo: ~/src/playbook
  package_manager: pnpm     # npm | pnpm | bun

tools:
  claude-code:
    - id: default
      name: Claude
      enabled: true
      config_dir: ~/.claude
    - id: learning
      name: Claude Learning
      enabled: true
      config_dir: ~/.claude-learning

files:
  - name: CLAUDE.md
    source: CLAUDE.md         # Relative to source_repo
    target: CLAUDE.md
    pullback: true            # Enable three-way state tracking
    overrides:
      "opencode:default": AGENTS.md
  - name: Settings
    source: claude-code/settings.json
    target: settings.json
    tools: [claude-code]      # Only sync to specific tools

marketplaces:
  playbook: https://raw.githubusercontent.com/ssweens/playbook/main/.claude-plugin/marketplace.json
```

#### Local Overrides

`config.local.yaml` is deep-merged on top of `config.yaml`. Use it for machine-specific settings:

```yaml
# ~/.config/blackbook/config.local.yaml
settings:
  source_repo: ~/alternate/dotfiles

tools:
  claude-code:
    - id: default
      name: Claude
      config_dir: ~/custom/.claude
```

Arrays of objects merge by `name` or `id` key. Set a key to `null` to delete it from the base config.

#### Unified Files

The `files:` list replaces the separate `assets` and `configs` concepts:

| Feature | Description |
|---------|-------------|
| `tools` omitted | Syncs to all enabled, syncable tool instances |
| `tools: [claude-code]` | Syncs only to claude-code instances |
| `pullback: true` | Enables three-way state tracking for reverse sync |
| `overrides` | Per-instance target path overrides |

#### Three-Way State

Files with `pullback: true` use deterministic hash-based drift detection instead of timestamps:

| Drift | Meaning | Action |
|-------|---------|--------|
| `source-changed` | You edited the source file | Forward sync (source → target) |
| `target-changed` | Tool edited the config | Pullback available (target → source) |
| `both-changed` | Both sides changed | Conflict — choose forward, pullback, or skip |
| `in-sync` | No changes since last sync | Nothing to do |

State is stored in `~/.cache/blackbook/state.json`.

### Private Repositories

For private GitHub repos, set a token in your environment (optional for public URLs):

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
# or
export GH_TOKEN=ghp_xxxxxxxxxxxx
```

### Default Marketplaces

The default config includes Anthropic's official marketplace:

| Name | URL |
|------|-----|
| `claude-plugins-official` | https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json |

If you already use Claude plugins, Blackbook also reads known marketplaces from `~/.claude/plugins/known_marketplaces.json`.

### Pi Packages

Blackbook includes a built-in npm marketplace for [Pi coding agent](https://github.com/anthropics/pi) packages. Packages tagged with the `pi-package` keyword on npm are automatically discovered and can be installed directly from the Discover tab.

Pi packages can include extensions, themes, custom tools, and skills. Install/uninstall uses `pi install` and `pi remove` CLI commands.

You can also add local Pi package directories as marketplaces:

```toml
[pi-marketplaces]
my-packages = "~/src/my-pi-packages"
```

### Tools

Blackbook manages the default tool set (Claude, OpenCode, Amp, Codex, Pi) from the Tools tab. Each row shows binary detection status, installed version, and update availability.

From Tools you can:
- Open detail (`Enter`)
- Install (`i`)
- Update (`u` when update is available)
- Uninstall (`d`)
- Toggle enablement (`Space`)
- Edit config directory (`e`)

If a tool has no configured instance yet, Blackbook shows a "Not configured" synthetic row so lifecycle actions are still available.

Detection runs per-tool and updates rows incrementally with a spinner while each tool's version/status is loading. The Tools tab also shows a global "Checking tool statuses" indicator until all tool checks complete.

For updates, Blackbook uses tool-native upgrade commands when available (e.g. `claude update`, `amp update`, `opencode upgrade`) to keep the active PATH binary in sync. Claude install uses the official installer script (`curl -fsSL https://claude.ai/install.sh | bash`).

**Supported tools (default config paths):**
- Claude — `~/.claude`
- OpenCode — `~/.config/opencode`
- Amp — `~/.config/amp`
- Codex — `~/.codex`
- Pi — `~/.pi`

Choose package manager for lifecycle commands in config (used by tools that install/update via npm/bun/pnpm):

```toml
[sync]
package_manager = "npm"   # "npm" | "bun" | "pnpm"
```

Native command exceptions:
- Claude install: `curl -fsSL https://claude.ai/install.sh | bash`
- Claude update: `claude update`
- Amp update: `amp update`
- OpenCode update: `opencode upgrade`

**Supported plugin types:** skills, commands, agents, hooks, MCP servers, LSP servers.

Incomplete installs are detected when a plugin is missing from any enabled instance that supports it.


### Managing Marketplaces

**Via TUI:** Navigate to Marketplaces tab, select "Add Marketplace"

**Via config file:** Edit `~/.config/blackbook/config.toml` directly

```toml
[marketplaces]
my-marketplace = "https://raw.githubusercontent.com/user/repo/main/.claude-plugin/marketplace.json"
```

## Cache

Downloaded plugins and HTTP cache are stored in:

```
~/.cache/blackbook/
├── plugins/           # Downloaded plugin sources
├── http_cache/        # Cached marketplace data
├── assets/            # Cached asset URL sources
├── backups/           # File backups before overwrite (last 3 per file)
└── state.json         # Three-way state tracking for pullback files
```

Remote plugin marketplace responses are cached for up to 10 minutes before refetch.

## Development

```bash
cd tui
pnpm install
pnpm dev          # Run in development mode
pnpm test         # Run tests
pnpm typecheck    # Type check
pnpm build        # Build for production
```

See `docs/TEST_COVERAGE.md` for the user-flow checklist and coverage status.

```bash
cd tui
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

### TUI Code Layout

- `tui/src/cli.tsx` entry point
- `tui/src/App.tsx` app shell
- `tui/src/components/` UI components
- `tui/src/lib/config/` YAML config loading, validation (zod), merge, path resolution
- `tui/src/lib/modules/` Ansible-inspired check/apply modules (file-copy, directory-sync, symlink, backup, cleanup, plugin install/remove)
- `tui/src/lib/playbooks/` Internal YAML tool playbooks (default tool definitions)
- `tui/src/lib/state.ts` Three-way state tracking for pullback-enabled files
- `tui/src/lib/store.ts` Zustand store (main state management)
- `tui/src/lib/config.ts` Config facade (YAML loading)
- `tui/src/lib/install.ts` Legacy plugin/file sync code (being replaced by modules)
