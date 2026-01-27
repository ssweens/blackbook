# Blackbook

Plugin manager for agentic coding tools built with React/Ink. Install skills, commands, and agents from marketplaces to Claude Code, OpenAI Codex, OpenCode, and Amp.

![Blackbook TUI](assets/discover-tab.png)

## Features

- **Unified plugin management** across multiple AI coding tools
- **Marketplace support** - Browse and install from official and community marketplaces
- **TUI interface** - Interactive terminal UI for plugin discovery and management
- **Cross-tool sync** - Install plugins to multiple tools at once

## Plugin Model

Everything is a plugin. Plugins can include skills, commands, agents, hooks, MCP servers, and LSP servers.

## Supported Tools

| Tool | Config Directory | Skills | Commands | Agents |
|------|------------------|--------|----------|--------|
| Claude Code | `~/.claude` | ✓ | ✓ | ✓ |
| OpenAI Codex | `~/.codex` | ✓ | — | — |
| OpenCode | `~/.config/opencode` | ✓ | ✓ | ✓ |
| Amp Code | `~/.config/amp` | ✓ | ✓ | ✓ |

## Installation

```bash
# Clone and run TUI
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

### Navigation

| Key | Action |
|-----|--------|
| Tab / ← → | Switch tabs |
| ↑ ↓ | Navigate lists |
| Enter | Select / open details |
| Space | Install/uninstall selected plugin |
| / | Focus search (Discover/Installed) |
| Esc | Back from details or exit search |
| q | Quit |

### Shortcuts

- **Discover/Installed**: `s` cycle sort (name/installed), `r` reverse sort
- **Marketplaces**: `u` update marketplace, `r` remove marketplace

## Configuration

Blackbook uses a single config file at `~/.config/blackbook/config.toml`.

### Config File Location

```
~/.config/blackbook/config.toml
```

Or set `XDG_CONFIG_HOME` to use a custom location.

### Example Configuration

```toml
# ~/.config/blackbook/config.toml

# Marketplaces to fetch plugins from
# These extend the initial defaults and any Claude marketplaces
[marketplaces]
playbook = "https://raw.githubusercontent.com/ssweens/playbook/main/.claude-plugin/marketplace.json"
my-private = "https://raw.githubusercontent.com/myorg/plugins/main/.claude-plugin/marketplace.json"

# Override tool config directories (optional)
[tools.claude-code]
config_dir = "~/.claude"

[tools.opencode]
config_dir = "~/.config/opencode"
```

### Default Marketplaces

The default config includes Anthropic's official marketplace:

| Name | URL |
|------|-----|
| `claude-plugins-official` | https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json |

If you already use Claude plugins, Blackbook also reads known marketplaces from `~/.claude/plugins/known_marketplaces.json`.

### Private Repositories

For private GitHub repos, set a token in your environment:

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx
# or
export GH_TOKEN=ghp_xxxxxxxxxxxx
```

Get a token at: https://github.com/settings/tokens (requires `repo` scope)

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
└── http_cache/        # Cached marketplace data
```

## Development

```bash
cd tui
pnpm install
pnpm dev          # Run in development mode
pnpm test         # Run tests
pnpm typecheck    # Type check
pnpm build        # Build for production
```

### TUI Code Layout

- `tui/src/cli.tsx` entry point
- `tui/src/App.tsx` app shell
- `tui/src/components/` UI components
- `tui/src/lib/` config, marketplace, install, state

## Related

- [playbook](https://github.com/ssweens/playbook) - Personal plugin marketplace
