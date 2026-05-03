---
date: 2026-05-02
status: phase-1-complete
phase: 1
plan: docs/plans/2026-05-02-003-playbook-rearchitecture-plan.md
---

# Tool Artifact Inventory

Authoritative reference for every artifact each supported tool exposes, the disk layout, version-sensitive details, and provenance detection mechanisms. Phase 2 (schema) and Phase 3 (migration) build on this.

## Conventions

- **Common spine** = artifact types that several tools share and that the playbook can host once for many destinations: `skills`, `commands`, `agents`, `AGENTS.md`, `MCP`.
- **Tool-specific** = artifact types unique to one tool (e.g., Codex `apps`/connectors, Claude output styles).
- **Bundle** = a versioned, atomically-installed unit that contains multiple artifacts. Two paradigms exist:
  - **Artifact bundle** (Claude plugin, Codex plugin) — manifest + bundled artifacts, marketplace-distributed
  - **Code package** (Pi package, OpenCode plugin) — npm/git module with runtime hooks + bundled artifacts
- **User-managed** = user authors or pulls from upstream; playbook should govern.
- **Tool-managed** = tool itself writes (caches, runtime state); playbook should not own.

---

## Claude Code

**Identity**
- Binary: `claude`
- npm: `@anthropic-ai/claude-code`
- brew: `claude-code`
- Default config dir: `~/.claude`
- Multi-instance: yes

**Common spine support**
- `skills/` — folder per skill, each with `SKILL.md` + assets (agentskills.io)
- `commands/` — markdown files registered as user commands
- `agents/` — markdown files defining sub-agents
- `AGENTS.md` (newer) + legacy `CLAUDE.md` (still supported)
- `MCP` — native; `.mcp.json` (project) and via plugin manifests
- `hooks/` — JSON hook definitions

**Tool-specific**
- **Plugins** (artifact bundle paradigm)
  - Manifest in plugin folder root + registered in `~/.claude/plugins/installed_plugins.json`
  - Bundle contents: skills, commands, agents, MCP servers, hooks
  - Distributed via marketplace (`.claude-plugin/marketplace.json`)
  - Versioned, install/update/uninstall lifecycle
- **Output styles**, **statuslines**, **projects** — exist; not in v1 inventory scope
- **Marketplace**: native concept, `.claude-plugin/marketplace.json`

**Disk layout (user-scope)**
```
~/.claude/
├── settings.json
├── AGENTS.md                # newer
├── CLAUDE.md                # legacy alias
├── .mcp.json                # MCP servers (also plugin-contributed)
├── skills/<name>/SKILL.md
├── commands/<name>.md
├── agents/<name>.md
├── hooks/<name>.json
└── plugins/
    ├── installed_plugins.json
    └── <plugin-name>/       # plugin source (skills/commands/etc bundled inside)
```

**Bundle registry**: `~/.claude/plugins/installed_plugins.json` declares which plugins are installed and which artifacts they contribute. Symlink resolution as secondary check.

---

## Codex (OpenAI Codex CLI)

**Identity**
- Binary: `codex`
- npm: `@openai/codex`
- brew: `codex`
- Default config dir: `~/.codex` (env `CODEX_HOME`)
- Multi-instance: not currently surfaced

**Common spine support**
- `skills/` — agentskills.io compatible. Codex also installs **system skills** at `~/.codex/skills/.system/` (tool-managed; do not govern via playbook).
- `commands/` — slash commands. Verify dir name; may use `prompts/` for custom prompts (separate from plugin-contributed commands).
- `agents/` — supported (verified via plugin-creator skill which scaffolds `agents/`)
- `AGENTS.md` — yes; hierarchical (project-walk-up). When `child_agents_md` feature flag is on, Codex adds extra precedence guidance.
- `MCP` — native; `[mcp_servers.<name>]` table in `~/.codex/config.toml` (TOML). Per-tool approval overrides. Managed via `codex mcp {list,get,add,remove,login,logout}`.
- `hooks/` — supported via plugin scaffold (`hooks.json` or `hooks/` dir)

**Tool-specific**
- **Plugins** (artifact bundle paradigm — near-identical to Claude)
  - Manifest at `<plugin>/.codex-plugin/plugin.json`
  - Bundle contents: `skills/`, `hooks` (`hooks.json` or dir), `mcpServers` (`./.mcp.json`), `apps` (`./.app.json`), `assets/`, `scripts/`
  - Versioned (semver), `name`, `interface` (display metadata), `category`, `capabilities`
  - Marketplace at `<repo>/.agents/plugins/marketplace.json` or `~/.agents/plugins/marketplace.json`
  - Plugin manager: `codex-rs/core/src/plugins/` (manager, store, marketplace, startup_sync)
  - Lifecycle: install/list/uninstall via app-server endpoints
- **Apps (connectors)** — Codex-unique. Cloud connectors like ChatGPT apps. Manifest `./.app.json` inside plugins. v1 scope: out (defer to v2).

**Disk layout**
```
~/.codex/
├── config.toml              # main config; [mcp_servers.*], [features.*]
├── AGENTS.md
├── skills/
│   ├── <name>/SKILL.md      # user skills
│   └── .system/             # tool-managed (do not govern)
├── prompts/                 # custom prompts
├── plugins/                 # installed plugins
│   └── <plugin-name>/.codex-plugin/plugin.json
└── (state DB at $CODEX_SQLITE_HOME)
```

**Bundle registry**: Codex's plugin manager state (likely a manifest at `~/.codex/plugins/` or in config.toml). Plugin manifests `.codex-plugin/plugin.json` declare contributed artifacts.

---

## OpenCode

**Identity**
- Binary: `opencode`
- npm: `opencode-ai`
- brew: `opencode`
- Default config dir: `~/.config/opencode` (global) + `.opencode/` (project)
- Multi-instance: not currently surfaced

**Common spine support**
- `skills/` — agentskills.io compatible. **Searches multiple paths**: `.opencode/skills`, `.claude/skills`, `.agents/skills` (project + globals). Significant: skills written to `~/.agents/skills/` work in OpenCode + Claude + Codex.
- `commands/` — markdown files in `commands/` dir, OR `command` key in config (`opencode.json`). Frontmatter: `description`, `agent`, `model`. Body is template.
- `agents/` — primary + subagents. Tab-cycle between primary; `@mention` for subagents. Defined in `agents/` dir or config.
- `AGENTS.md` — yes (project + global locations)
- `MCP` — native via `mcp` key in `opencode.json` (JSON). Types: `local`, `remote`. Supports remote org defaults via `.well-known/opencode` endpoints.
- `hooks/` — via plugin runtime hooks (not file-based)

**Tool-specific**
- **Plugins** (code package paradigm)
  - JS/TS modules exporting plugin functions returning hooks objects
  - Loaded from `.opencode/plugins/` (project) or `~/.config/opencode/plugins/` (global), OR npm-installed via `plugin: [...]` array in config
  - npm plugins auto-installed via Bun, cached in `~/.cache/opencode/node_modules/`
  - Versioned via npm semver; load order: global config → project config → global dir → project dir
- **Modes**, **themes**, **formatters**, **tools (custom)** — additional extension points
- **Remote organizational defaults** via `.well-known/opencode` — out of playbook scope (org-level)

**Disk layout (user-scope)**
```
~/.config/opencode/
├── opencode.json            # main config; mcp.*, plugin[]
├── AGENTS.md
├── skills/<name>/SKILL.md
├── commands/<name>.md
├── agents/<name>.md
├── plugins/<file>.{js,ts}   # local plugins
├── modes/, themes/, tools/  # additional concepts
└── package.json             # for npm-installed plugins (project-scoped via `.opencode/`)
```

**Bundle registry**: `plugin: [...]` array in `opencode.json` declares npm-installed plugins. Local plugins in `plugins/` dir are detected by file presence. No central installed-plugins manifest.

---

## Amp Code

**Identity**
- Binary: `amp`
- npm: `@sourcegraph/amp`
- Default config dir: `~/.config/amp`
- Multi-instance: not currently surfaced
- Notable: pioneered handoff-based context management (no compaction)

**Common spine support** (per existing blackbook playbook YAML; verify against current Amp docs)
- `skills/` — yes
- `commands/` — yes
- `agents/` — yes
- `AGENTS.md` — yes (referenced in handoff/thread docs)
- `MCP` — likely yes (verify externally; trend across all major tools)
- `hooks/` — verify

**Tool-specific**
- Threading / handoffs — runtime feature, not playbook artifact (verify)
- Plugin/bundle concept — verify; Amp may have an extension model worth investigating

**Disk layout**
```
~/.config/amp/
├── settings.json
├── AGENTS.md
├── skills/, commands/, agents/
└── (verify: mcp config location, hooks)
```

**Bundle registry**: Unknown / verify externally. If absent, all on-disk artifacts default to `standalone` provenance.

**Status**: This entry is the least-verified; need external doc/source review. Schema must not assume Amp specifics; adapter design should treat Amp as common-spine-only until verified.

---

## Pi (pi-coding-agent)

**Identity**
- Binary: `pi`
- npm: `@mariozechner/pi-coding-agent`
- Default config dir: `~/.pi/agent`
- Multi-instance: not currently surfaced

**Common spine support**
- `skills/` — agentskills.io compatible. Searched in: `~/.pi/agent/skills/`, `~/.agents/skills/`, `.pi/skills/`, `.agents/skills/` (project walk-up).
- `commands/` — Pi calls these **prompt templates**, in `prompts/` directory
- `agents/` — verify (not explicit in README customization section; may be via extensions or pi-packages)
- `AGENTS.md` — yes; loaded from `~/.pi/agent/AGENTS.md` (global) + project walk-up. Concatenates all matching files. Also accepts `CLAUDE.md` filename.
- `MCP` — **Pi core rejects MCP by design**, but [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter) is a pi-package that bridges MCP servers as Pi extensions. It uses the **standard MCP config location** (`.mcp.json`), so a single MCP config file in the playbook can serve Claude + Pi (via adapter) without duplication. Pi MCP is therefore **opt-in via pi-package**, not core.
- `hooks/` — verify (may be available via extensions)

**Tool-specific**
- **Pi Packages** (code package paradigm)
  - npm- or git-distributed
  - Manifest: `package.json` with `pi` key declaring contributions: `extensions`, `skills`, `prompts`, `themes`
  - npm `keywords: ["pi-package"]` for discoverability
  - Distribution: `pi install npm:<pkg>`, `pi install git:<url>`, with version pinning (`@1.2.3`, `@v1`, `@<sha>`)
  - Install paths:
    - Git: `~/.pi/agent/git/` (global) or `.pi/git/` (project, with `-l`)
    - npm: global node_modules
  - Lifecycle: `pi install`, `pi update`, `pi remove`/`uninstall`, `pi list`, `pi config`
  - Per-package version pinning supported (`@1.2.3` pinned; `pi update` skips pinned)
- **Extensions**, **prompt templates**, **themes** — first-class concepts. Extensions are TS modules with custom tools/commands/keybindings/event-handlers/UI-components.
- **System prompt customization**: `.pi/SYSTEM.md` (replace) or `APPEND_SYSTEM.md` (append), global at `~/.pi/agent/SYSTEM.md`

**Disk layout (user-scope)**
```
~/.pi/agent/
├── settings.json            # includes packages, npmCommand, etc.
├── AGENTS.md
├── SYSTEM.md / APPEND_SYSTEM.md
├── models.json              # custom providers
├── skills/<name>/SKILL.md
├── prompts/<name>.md        # commands equivalent
├── extensions/<name>/       # TS modules
├── themes/<name>/
└── git/<repo>/              # git-installed pi-packages
```

Plus globally-installed pi-packages under the package manager's global node_modules.

**Bundle registry**: `~/.pi/agent/settings.json` (`packages` field) + globally-installed npm packages with `pi-package` keyword. Each pi-package's `package.json` `pi` key declares its contributions.

---

## Common Spine Summary (Verified)

| Artifact | Claude | Codex | OpenCode | Amp | Pi |
|---|---|---|---|---|---|
| `skills/` | ✓ | ✓ (+ system skills tool-managed) | ✓ (multi-path search) | ✓ (verify) | ✓ |
| `commands/` | ✓ (`commands/`) | ✓ (verify dir name) | ✓ (`commands/` or config) | ✓ (verify) | ✓ (as `prompts/`) |
| `agents/` | ✓ | ✓ | ✓ (primary + subagents) | ✓ (verify) | verify |
| `AGENTS.md` | ✓ (+ `CLAUDE.md` legacy) | ✓ (hierarchical) | ✓ | ✓ (verify) | ✓ (+ `CLAUDE.md` alias, concatenated walk-up) |
| `MCP` | ✓ JSON (`.mcp.json` + plugins) | ✓ TOML (`config.toml [mcp_servers.*]`) | ✓ JSON (`opencode.json` `mcp` key) | likely (verify) | ✓ via [`pi-mcp-adapter`](https://www.npmjs.com/package/pi-mcp-adapter) (opt-in, std MCP location) |
| `hooks/` | ✓ JSON files | ✓ (in plugins) | ✓ (runtime via plugins) | verify | verify |

Skill content is broadly portable: agentskills.io standard is shared by Pi, OpenCode, and Codex (and Claude's skill format is compatible).

## Bundle Paradigms (Verified)

| Tool | Paradigm | Manifest | Distribution | Marketplace | Versioning |
|---|---|---|---|---|---|
| Claude | Artifact bundle | plugin folder + `installed_plugins.json` | git/local | `.claude-plugin/marketplace.json` | per-plugin |
| Codex | Artifact bundle | `.codex-plugin/plugin.json` | git/local | `.agents/plugins/marketplace.json` | per-plugin (semver) |
| Pi | Code package | `package.json` `pi` key | npm or git | npm registry (filtered by `pi-package` keyword) | per-package (npm semver, git tag/sha) |
| OpenCode | Code package | n/a (config-listed) | npm or local files | n/a | per-package (npm semver) |
| Amp | verify | verify | verify | verify | verify |

Two paradigms, both legitimate. Schema treats them as distinct tool-specific concepts (locked in Phase 1) but adapter design can share patterns within each paradigm.

## Tool-Specific Concepts (Verified)

| Concept | Tool(s) | v1 scope |
|---|---|---|
| Plugins (artifact bundle) | Claude, Codex | in |
| Pi packages (code package) | Pi | in |
| OpenCode plugins (code package) | OpenCode | in |
| Apps (connectors) | Codex | **out — defer to v2** |
| Output styles, statuslines, projects | Claude | **out — defer to v2** |
| Modes, themes, formatters, custom tools | OpenCode | **out — defer to v2** (themes possibly later) |
| Extensions | Pi (TS modules with hooks) | bundled inside pi-packages — in |
| Remote `.well-known/opencode` defaults | OpenCode | **out — org-level, not user-level** |
| Threading/handoffs | Amp (runtime) | n/a — not a playbook artifact |
| System prompt overrides (`SYSTEM.md`) | Pi | **defer — verify need** |

## Cross-cutting Decisions (Locked)

1. **AGENTS.md** — single file in playbook with per-tool target-path overrides (e.g. `claude-code:default → CLAUDE.md`). No content composition.
2. **Sharing semantics** — opt-in per tool. Each tool's `tool.yaml` lists which `shared/` items to include.
3. **Bundle modeling** — distinct tool-specific concepts. Two paradigms exist (artifact bundles, code packages) — adapters can share patterns within each paradigm.
4. **Versioning** — floating (latest from upstream). No per-resource pinning. Git sha of playbook is the only lock. (Note: Pi packages support pinning natively; pinning will be a per-tool adapter feature, not a playbook-wide feature.)
5. **MCP servers** — common spine for Claude, Codex, OpenCode, (likely Amp), and Pi (opt-in via `pi-mcp-adapter`). Central representation in playbook, per-tool adapter emits the right format. Pi MCP is opt-in via package, not core; adapter checks for `pi-mcp-adapter` presence and skips with a no-op if absent.
6. **Standalone vs bundled provenance** — every artifact has explicit provenance metadata: `standalone`, `bundle:<name>`, or `unknown`. Standalone lives in artifact-type dirs; bundles are opaque containers; unknown requires user classification.
7. **Marketplace landing** — `tools/<tool>/` (since bundles are tool-specific).
8. **Hooks** — tool-specific (Claude has files, Codex inside plugins, OpenCode runtime; Amp/Pi verify).
9. **Project scope** — out of v1 (playbook is user-scope).
10. **Machine overrides** — reserved in schema, deferred to v2.
11. **Override semantics** — replace, not merge.

## Provenance Detection (per tool)

| Tool | Bundle registry | Detection mechanism |
|---|---|---|
| Claude | `~/.claude/plugins/installed_plugins.json` | Read manifest; symlink resolution as secondary; per-plugin folder for source-of-truth |
| Codex | Codex plugin manager state + per-plugin `.codex-plugin/plugin.json` | Read manifests; system-skills marker (`.codex-system-skills.marker`) identifies tool-managed |
| OpenCode | `plugin: [...]` in `opencode.json` + files in `plugins/` dir | Config-list match; file-presence detection; npm-cache resolution |
| Pi | `~/.pi/agent/settings.json` `packages` + `~/.pi/agent/git/` + global npm with `pi-package` keyword | Read manifest; check git/ dir; query global npm. `pi-mcp-adapter` presence enables MCP sync. |
| Amp | TBD | If absent, default all artifacts to `standalone` |

When bundle registry is absent (tool has no concept), all on-disk artifacts default to `standalone` provenance.

When registry exists but an artifact's provenance still can't be determined, it stays `unknown` and the user classifies before sync.

## Secrets Handling for MCP (Locked)

MCP configs frequently carry credentials (GitHub PATs, Linear API keys, Bearer tokens, etc.). **Secrets must never live in the playbook git repo.** Every MCP config format already supports indirection — we use it.

### Per-tool env-var indirection support

| Tool | Mechanism | Format |
|---|---|---|
| OpenCode | `environment: { VAR: "value" }` for local; `headers` for remote | JSON — values can reference env via standard shell expansion at launch |
| Codex | `[mcp_servers.<name>.env]` table; `bearerTokenEnv` for remote | TOML — env table for local, env-var-name for bearer |
| Claude | `env: { VAR: "value" }` in `.mcp.json` and plugin manifests | JSON — values may use `${VAR}` interpolation |
| Pi (via `pi-mcp-adapter`) | Standard MCP config; adapter resolves at runtime | Reads from process env |
| Amp | verify | verify |

### Playbook strategy

1. **Playbook stores env-var *names*, never values.**
   - Bearer tokens: `bearerTokenEnv: GITHUB_TOKEN` (preferred where supported)
   - Local server env: `env: { GITHUB_TOKEN: "$GITHUB_TOKEN" }` (placeholder; resolved by tool runtime or adapter)
2. **Playbook documents required env vars** in `playbook.yaml`:
   ```yaml
   required_env:
     - name: GITHUB_TOKEN
       used_by: [github-mcp]
       docs: https://github.com/settings/tokens
     - name: LINEAR_API_KEY
       used_by: [linear-mcp]
   ```
   On `apply`, the engine checks all `required_env` are set and warns/blocks otherwise.
3. **Per-tool adapter handles emission**:
   - If the tool natively supports env-var-name fields (`bearerTokenEnv`, `[env]` tables), emit those directly — no substitution.
   - If the tool only supports literal values, the adapter performs `${VAR}` substitution at apply time from the current process env. This means the rendered config on disk does contain the secret — but `~/.<tool>/` is gitignored from the playbook (it's the tool's working dir, not the playbook).
4. **Optional secret-manager integration** (deferred to v2): support `op://...` (1Password CLI), `keychain://...` (macOS Keychain) refs that resolve via shell-out at apply time.

### What never goes in the playbook git repo

- API keys, tokens, passwords (always)
- Local-only paths that vary by machine (use machine overrides in v2)
- `.env` files (use `.gitignore`)

### What does go in the playbook

- The MCP server *definition* (command, URL, args)
- The *names* of env vars the server needs
- Documentation of where to obtain each secret

## Key Findings From Research

1. **Codex has plugins** that mirror Claude's almost exactly. Initial assumption that "plugins are Claude-only" was wrong. Schema must support both.
2. **Two bundle paradigms** exist:
   - Artifact bundles (Claude, Codex): manifest + bundled artifacts, marketplace-distributed
   - Code packages (Pi, OpenCode): npm/git modules + bundled artifacts, npm-distributed
   These behave differently in install/update/uninstall but feel similar from a playbook-governance perspective.
3. **MCP is genuinely cross-tool** for 4 of 5 tools, but emission formats differ (JSON vs TOML vs config-key). Adapter pattern is mandatory.
4. **Pi MCP is opt-in via `pi-mcp-adapter` package** — Pi core rejects MCP, but the community pi-package bridges MCP servers using the standard MCP config location. This means one shared MCP config can serve Claude + Pi (via adapter) without duplication.
5. **MCP secrets handled via env-var indirection** — every tool's MCP config format supports referencing env-var names instead of literal values (`bearerTokenEnv`, `env` tables). Playbook stores names, never values; tool runtime or adapter resolves at apply time. No secret manager integration in v1; deferred to v2.
5. **Skill content is portable** — agentskills.io standard is widely adopted; same skill folder works in Pi, OpenCode, Codex, Claude.
6. **Multi-path skill discovery** in OpenCode (`.claude/skills`, `.agents/skills`) means skills written to `.agents/skills/` work everywhere — interesting opportunity for sync optimization but doesn't change schema design.
7. **Codex has a unique `apps` concept** (cloud connectors) — out of v1 scope.
8. **Codex installs system skills** at `skills/.system/` with a marker file — tool-managed, must be excluded from playbook governance.
9. **AGENTS.md hierarchical concatenation** is consistent across Pi, Codex, OpenCode — global + project walk-up. Single playbook AGENTS.md → emitted at each tool's expected location continues to work.

## Remaining Open Questions

1. **Amp specifics** — every Amp row above marked `verify` needs external doc/source review. v1 may proceed with conservative common-spine-only Amp adapter until verified.
2. **Tool version drift** — adapter conformance test suite in Phase 4 will catch most cases; per-tool version detection via `<tool> --version` already exists in blackbook.
3. **Unknown provenance UX** — proposed: hold in scan results until user classifies. Confirmed approach in Phase 5 UI design.
4. **Codex `apps` (connectors)** — confirmed out of v1 scope.

## Status

- ✅ Skeleton complete with current-codebase-derived facts
- ✅ Cross-cutting decisions locked (11 of 11 substrate questions resolved)
- ✅ MCP support researched (4 of 5 tools native; Pi excludes by design)
- ✅ Bundle paradigm distinction discovered and documented (artifact bundle vs code package)
- ✅ Codex plugin system researched (significant correction to original "plugins = Claude only" assumption)
- ✅ Provenance detection mechanism specified per tool (Amp pending)
- ✅ Tool-specific out-of-v1-scope concepts identified
- 🟡 Amp specifics need external doc/source review (acceptable for Phase 2 to start)
- ➡️ **Ready to start Phase 2: Playbook Schema Design**
