# Blackbook TUI

Plugin manager for AI coding tools, built with React/Ink.

## Features

- **Discover**: Browse plugins from configured marketplaces
- **Installed**: Manage installed plugins (enable/disable/update/uninstall)
- **Marketplaces**: Add/remove/update marketplace sources

Supports: Claude Code, OpenCode, Amp, OpenAI Codex

## Usage

```bash
# Development
npm run dev

# Build
npm run build

# Run built version
npm start
```

## Keybindings

| Key | Action |
|-----|--------|
| Tab / ← → | Switch tabs |
| ↑ ↓ | Navigate list |
| Enter | Select / Open details |
| Space | Toggle enable/disable or install |
| Esc | Go back |
| q | Quit |

### Marketplace tab

| Key | Action |
|-----|--------|
| u | Update marketplace |
| r | Remove marketplace |

## Configuration

Edit `tools.toml` in the repo root to configure marketplaces:

```toml
[marketplaces]
official = "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json"
my-plugins = "/path/to/local/marketplace.json"
```

## Architecture

```
tui/
├── src/
│   ├── cli.tsx          # Entry point
│   ├── App.tsx          # Main app component
│   ├── components/      # UI components
│   │   ├── TabBar.tsx
│   │   ├── SearchBox.tsx
│   │   ├── PluginList.tsx
│   │   ├── PluginDetail.tsx
│   │   ├── MarketplaceList.tsx
│   │   ├── MarketplaceDetail.tsx
│   │   ├── HintBar.tsx
│   │   └── StatusBar.tsx
│   └── lib/             # Core logic
│       ├── types.ts     # TypeScript types
│       ├── config.ts    # Tool/config loading
│       ├── marketplace.ts # Marketplace fetching
│       ├── install.ts   # Plugin install/link operations
│       └── store.ts     # Zustand state management
```

## Simplified Model

Everything is a **Plugin**. Plugins can contain:
- Skills (SKILL.md directories)
- Commands (.md files)
- Agents (.md files)
- Hooks
- MCP servers
- LSP servers

This simplifies the original Python implementation which had separate tabs for Items and Tools.
