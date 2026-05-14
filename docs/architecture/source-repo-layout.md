# Source Repo Layout

The source repo (configured via `settings.source_repo` in `~/.config/blackbook/config.yaml`)
holds the canonical copy of every artifact that Blackbook syncs to your AI tools.

## Canonical layout

```
<source_repo>/
├── skills/<name>/SKILL.md          # standalone skills, freely synced to any enabled tool
│   ├── references/                  # supporting docs (optional)
│   ├── scripts/                     # helper scripts (optional)
│   └── assets/                      # supporting assets (optional)
│
├── commands/<name>.md              # standalone slash-commands
│
├── agents/<name>.md                # standalone subagents
│
├── assets/                          # files synced to tools (CLAUDE.md, DEVELOPMENT.md, etc.)
│   ├── AGENTS.md
│   └── ...
│
├── config/                          # per-tool config snippets (APPEND_SYSTEM.md, etc.)
│   ├── pi/
│   └── ...
│
└── plugins/<name>/                  # real Claude-style plugins
    ├── .claude-plugin/plugin.json
    ├── skills/                      # plugin-owned skills (NOT browsable as standalone)
    ├── commands/                    # plugin-owned commands
    └── agents/                      # plugin-owned agents
```

## Why two locations for skills?

Blackbook distinguishes:

- **Standalone skills** (`skills/<name>/`) — discovered globally, syncable to any tool,
  managed via the Library tab's "Skills" section
- **Plugin-owned skills** (`plugins/<name>/skills/<sub>/`) — discovered as part of a
  Claude plugin that's registered in a marketplace; managed via the parent plugin's
  detail view

A skill ends up in `plugins/<name>/` **only if** that plugin has a real
`.claude-plugin/plugin.json` AND is published through a marketplace. Otherwise it
belongs in `skills/<name>/`.

## Legacy layout (auto-detected, manual fix expected)

Older source repos may have skills wrapped in plugin folders without marketplace
registration:

```
<source_repo>/plugins/<name>/skills/<name>/SKILL.md
```

Blackbook detects this as **legacy-plugin** layout and surfaces a yellow warning
in the skill detail view. **Fix it manually** by moving the skill into the canonical
location:

```bash
cd <source_repo>
git mv plugins/<name>/skills/<name> skills/<name>
# If plugins/<name>/ is now empty (or only has README.md / .claude-plugin/),
# remove it too:
git rm -r plugins/<name>
git commit -m "move <name> skill to canonical layout"
```

## Detection rules

For each skill found on disk (in any tool's `skills/` dir), Blackbook scans the source
repo in this order:

1. `<repo>/skills/<name>/SKILL.md` → **canonical**
2. `<repo>/plugins/<name>/skills/<name>/SKILL.md` → **legacy-plugin**
3. (not found) → **missing** (skill exists only on disk, not in source control)

The detail view shows the current layout state with a colored indicator:
- 🟢 `✓ canonical` — already in the right place
- 🟡 `⚠ legacy plugin-wrapped` — migration recommended
- 🔘 `(not tracked)` — never added to source repo
