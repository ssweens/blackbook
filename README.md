# Blackbook

Plugin manager for agentic coding tools. Install skills, commands, and agents from marketplaces to Claude Code, OpenAI Codex, OpenCode, and Amp.

## Features

- **Unified plugin management** across multiple AI coding tools
- **Marketplace support** - Browse and install from official and community marketplaces
- **TUI interface** - Interactive terminal UI for plugin discovery and management
- **Cross-tool sync** - Install plugins to multiple tools at once

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

- **Tab / ←→** - Switch between Discover, Installed, Marketplaces tabs
- **↑↓** - Navigate lists
- **Enter** - Select/view details
- **Space** - Quick install/uninstall
- **Esc** - Go back
- **q** - Quit

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
# These extend the built-in defaults (official, compound-engineering)
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

These are included by default and don't need to be added:

| Name | URL |
|------|-----|
| `official` | Anthropic's official Claude plugins |
| `compound-engineering` | Compound Engineering community plugins |

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

## Related

- [playbook](https://github.com/ssweens/playbook) - Personal plugin marketplace
