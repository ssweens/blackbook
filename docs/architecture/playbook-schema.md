---
date: 2026-05-02
status: draft
phase: 2
plan: docs/plans/2026-05-02-003-playbook-rearchitecture-plan.md
depends_on: docs/architecture/tool-inventory.md
---

# Playbook Schema Design

The playbook is a single git-versioned directory that captures everything Blackbook governs across all tools on a machine. This document defines its structure, file formats, and the adapter contract that lets each tool sync against it.

All decisions here flow from the inventory and the eleven locked substrate decisions in `tool-inventory.md`. If something here contradicts the inventory, the inventory wins — file an issue.

## Schema version

```
playbook_schema_version: 1
```

This number lives at the top of `playbook.yaml`. Engine refuses to operate on a higher version than it knows. Migrations between versions are explicit and tracked in Phase 3.

---

## Top-level layout

```
playbook/
├── playbook.yaml            # top-level config + manifest of what's enabled
├── shared/                  # cross-tool common spine
│   ├── AGENTS.md            # one file; per-tool target override applies at sync
│   ├── skills/<name>/SKILL.md
│   ├── commands/<name>.md
│   ├── agents/<name>.md
│   └── mcp/<server>.yaml    # tool-neutral MCP server definitions
├── tools/
│   ├── claude/
│   ├── codex/
│   ├── opencode/
│   ├── amp/
│   └── pi/
├── machines/                # reserved for v2 (machine-local overrides)
└── .gitignore               # default-ships with secrets-safety patterns
```

Every directory under `shared/` and `tools/<tool>/` is optional — the engine treats missing dirs as empty.

---

## `playbook.yaml`

The top-level manifest. Single file. Required.

```yaml
playbook_schema_version: 1

# Identity
name: "personal-coding-playbook"
description: "Cross-tool config for my dev machines"

# Which tool adapters are enabled on this playbook.
# A tool listed here must have a corresponding `tools/<tool>/tool.yaml`.
tools_enabled:
  - claude
  - codex
  - opencode
  - pi
  # amp omitted = adapter inactive for this playbook

# Marketplaces / upstream sources for bundles.
# Floating versions: no version field. Pin via per-tool plugins.yaml if needed.
marketplaces:
  claude:
    - name: "playbook-claude"
      url: "https://raw.githubusercontent.com/me/playbook-claude-marketplace/main/.claude-plugin/marketplace.json"
  codex:
    - name: "openai-curated"
      url: "https://raw.githubusercontent.com/openai/codex-marketplace/main/.agents/plugins/marketplace.json"
  pi:
    # Pi has no native marketplace concept; npm registry filtered by `pi-package` keyword acts as one.
    # Optional: pin known publishers here for discovery hints.
    publishers:
      - "@mariozechner"
      - "@my-org"
  opencode:
    # OpenCode plugins are npm-distributed; same model as Pi.
    publishers: []

# Required env vars across all enabled tools.
# Engine checks these are set before `apply`. Used to declare MCP secrets etc.
required_env:
  - name: GITHUB_TOKEN
    used_by: [github-mcp]
    docs: "https://github.com/settings/tokens"
    optional: false
  - name: LINEAR_API_KEY
    used_by: [linear-mcp]
    docs: "https://linear.app/settings/api"
    optional: true   # only checked if linear-mcp is included by some tool

# Default sync behaviors. Override per-tool in tool.yaml.
defaults:
  confirm_removals: true       # always; cannot be turned off (safety lock)
  default_strategy: copy        # copy | symlink (per-tool may override)
  drift_action: warn            # warn | fail | auto-resolve

# Settings carried over from current blackbook config.yaml that aren't tool-scoped.
settings:
  package_manager: pnpm         # for npm-distributed bundles (Pi, OpenCode)
  backup_retention: 3           # how many .bak files to keep on apply
```

### Field reference

| Field | Type | Required | Notes |
|---|---|---|---|
| `playbook_schema_version` | int | yes | Currently 1 |
| `name` | string | yes | Human-readable identifier |
| `description` | string | no | |
| `tools_enabled` | list[string] | yes | Must match dir names under `tools/` |
| `marketplaces.<tool>` | list of marketplace refs | no | Per-tool format; only relevant if that tool has a marketplace concept |
| `required_env` | list[envspec] | no | Engine validates before apply |
| `defaults` | object | no | Inherited by all tools unless overridden |
| `settings` | object | no | Free-form key/value for cross-tool settings |

---

## `tools/<tool>/tool.yaml`

Per-tool config. Required when the tool is in `tools_enabled`.

```yaml
# tools/claude/tool.yaml
tool: claude
config_dir: "~/.claude"        # override default if needed

# Multi-instance support (Claude is the main case today).
# Each instance is a separate config_dir the tool can be run with.
instances:
  - id: default
    name: "Claude (personal)"
    config_dir: "~/.claude"
    enabled: true
  # - id: work
  #   name: "Claude (work account)"
  #   config_dir: "~/.claude-work"
  #   enabled: true

# Opt-in lists of shared/ items that flow to this tool.
# (Decision locked: opt-in per tool. Adding to shared/ does NOT auto-flow.)
include_shared:
  agents_md: true               # special: AGENTS.md is one file, boolean opt-in
  skills:
    - incident-triage
    - deploy-checklist
  commands:
    - restart
    - status
  agents:
    - reviewer
  mcp:
    - github-mcp
    - linear-mcp

# Per-instance target-path overrides (replaces same name in shared).
# Currently only meaningful for AGENTS.md → CLAUDE.md rename.
overrides:
  agents_md:
    default: "CLAUDE.md"        # write shared/AGENTS.md to ~/.claude/CLAUDE.md instead

# Tool-specific config files this playbook governs.
# These live at tools/claude/<file> in the playbook and sync to config_dir/<target>.
config_files:
  - source: "settings.json"
    target: "settings.json"
    strategy: copy
    syncable: true              # false = read-only reference, never written

# Tool-specific bundles (artifact-bundle paradigm).
# Defined in plugins.yaml (see below). plugins.yaml is the source of truth;
# this section is just the file pointer.
plugins_manifest: "plugins.yaml"

# Tool-specific lifecycle overrides
lifecycle:
  install_strategy: native       # native (use tool's own install) | manual
  uninstall_strategy: native
  drift_action: warn
```

### Per-tool tool.yaml differences

The schema is shared; the meaningful fields differ:

| Tool | `instances` | `include_shared.mcp` | `plugins_manifest` | `packages_manifest` | Notes |
|---|---|---|---|---|---|
| claude | yes (multi) | yes | `plugins.yaml` | n/a | Native marketplace |
| codex | typically single | yes | `plugins.yaml` | n/a | Native marketplace |
| opencode | single | yes | n/a | `plugins.yaml` (npm packages) | Code-package paradigm |
| pi | single | yes (via `pi-mcp-adapter`) | n/a | `packages.yaml` | Code-package paradigm |
| amp | single | likely | TBD | TBD | Adapter conservative (common-spine only) until verified |

For the code-package paradigm, the file is `packages.yaml` (Pi) or `plugins.yaml` (OpenCode). Same shape; different field name reflects native terminology.

---

## Common spine artifacts

### `shared/AGENTS.md`

A single markdown file. Every tool that opts in via `include_shared.agents_md: true` receives this file at the tool's expected location. Per-tool rename via `overrides.agents_md`.

No composition. If a tool needs different content, place a full file at `tools/<tool>/AGENTS.md` and set `include_shared.agents_md: false` for that tool. Replace, not merge (locked).

### `shared/skills/<name>/`

Standard agentskills.io skill folder:

```
shared/skills/incident-triage/
├── SKILL.md           # required, with name + description frontmatter
├── scripts/           # optional
├── references/        # optional
└── assets/            # optional
```

Skill `name` in frontmatter must match folder name. Same constraint applies in tool-scoped skill folders.

### `shared/commands/<name>.md`

Markdown file with optional frontmatter. Format mirrors what each tool expects (this is the agent-skills-adjacent standard most tools converge on). For tools that use a different name (Pi calls these `prompts/`), the adapter writes to the right disk location.

```markdown
---
description: "Run the full test suite"
agent: build       # tool-specific frontmatter is ignored by tools that don't use it
---

Run all tests with coverage; report failures grouped by file.
```

### `shared/agents/<name>.md`

Same shape as commands; tool-specific frontmatter ignored where not relevant.

### `shared/mcp/<server>.yaml`

Tool-neutral MCP server definition. Adapter translates per tool.

```yaml
# shared/mcp/github-mcp.yaml
name: github-mcp
type: local                   # local | remote
description: "GitHub MCP server"

# For type=local
command:
  - npx
  - "-y"
  - "@modelcontextprotocol/server-github"
env:
  GITHUB_TOKEN: $env:GITHUB_TOKEN    # env-var ref; never literal value

# For type=remote (mutually exclusive with command/env)
# url: https://example.com/mcp
# bearerTokenEnv: GITHUB_TOKEN       # name of env var; tool resolves at runtime
# headers:
#   X-Custom: literal-value-ok-if-not-secret

enabled: true
timeout_ms: 5000              # optional; tool-default if omitted

# Compatibility hints. Adapter uses these to decide format-specific emission.
compat:
  bearer_token_env_supported: true   # informs Codex emission
```

#### Secrets pattern (locked)

Three valid forms, all referencing env var **names**:

```yaml
# Form 1: shell-style placeholder (preferred for env passthrough)
env:
  GITHUB_TOKEN: $env:GITHUB_TOKEN

# Form 2: bearer-token-env (preferred for remote bearer auth)
bearerTokenEnv: GITHUB_TOKEN

# Form 3: explicit env var ref object (when adapters need richer metadata)
env:
  GITHUB_TOKEN:
    from_env: GITHUB_TOKEN
    required: true
```

Adapter emission:
- Tool natively supports env-var-name fields (Codex `bearerTokenEnv`, OpenCode `environment` map): emit directly, no substitution
- Tool supports literal values only: substitute from `process.env` at apply time. Engine refuses to apply if `required_env` declares the var and it's unset

The playbook git repo never sees a literal secret. Tool config under `~/.<tool>/` may, but that's the tool's working directory — not the playbook.

---

## Tool-specific artifacts

### Standalone artifacts (tools/<tool>/skills/, etc.)

Identical schema to `shared/<type>/`. A tool-scoped artifact with the same name as a shared one **replaces** it (locked: replace, not merge).

```
tools/claude/
├── skills/
│   └── claude-output-formatter/   # claude-only skill
└── commands/
    └── /init.md                    # claude-only command
```

These are first-class standalone artifacts; lifecycle is file-level (sync, edit, remove).

### Bundle artifacts

Two paradigms, distinct files:

#### Artifact bundles (Claude, Codex) → `tools/<tool>/plugins.yaml`

```yaml
# tools/claude/plugins.yaml
schema: 1

plugins:
  - name: ce-compound
    source:
      marketplace: playbook-claude   # ref to playbook.yaml marketplaces
      plugin: ce-compound
    enabled: true
    # No version field = floating (latest from marketplace)
    # version: "0.3.0"               # optional pin
    disabled_components:             # optional; selectively disable contributed components
      skills: []                     # e.g., ["legacy-skill"]
      commands: []
      agents: []

  - name: my-internal-plugin
    source:
      type: git
      url: https://github.com/me/internal-plugin
      ref: main                      # branch/tag/sha
    enabled: true

  - name: experimental-thing
    source:
      type: local
      path: "../experimental-plugin" # relative to playbook root
    enabled: false                   # disabled but tracked
```

Bundles are **opaque containers**. The playbook does not vendor their contents. At apply time, the adapter installs the plugin via the tool's native mechanism (Claude plugin install, Codex plugin install). At scan time, the bundle's contributed artifacts are detected via the bundle registry (`installed_plugins.json`, `.codex-plugin/plugin.json`) and tagged with provenance `bundle:<name>`.

#### Code packages (Pi, OpenCode) → `tools/<tool>/packages.yaml`

```yaml
# tools/pi/packages.yaml
schema: 1

packages:
  - name: pi-mcp-adapter
    source:
      type: npm
      package: pi-mcp-adapter
    enabled: true
    # No version = floating

  - name: ce-compound
    source:
      type: npm
      package: "@my-org/ce-compound"
    enabled: true

  - name: my-fork
    source:
      type: git
      url: github.com/me/pi-tools
      ref: v0.5.0                  # tag = pinned for git
    enabled: true
```

```yaml
# tools/opencode/plugins.yaml
schema: 1

plugins:
  - name: opencode-helicone-session
    source:
      type: npm
      package: opencode-helicone-session
    enabled: true

  - name: local-experimental
    source:
      type: local
      path: ".opencode/plugins/experimental.ts"
    enabled: true
```

### Tool-specific config files

Each tool has a primary config file (`settings.json`, `config.toml`, `opencode.json`). These live in the playbook at `tools/<tool>/<filename>` and are listed in `tool.yaml` under `config_files`.

These files are **sensitive** — they may contain user-tweaked settings the user does not want overwritten. v1 default: `syncable: false` for primary config files (read-only reference). User opts in to `syncable: true` per file.

### Hooks (Claude only verified in v1)

```
tools/claude/hooks/
└── pre-tool-call.json
```

Tool-specific. Not part of common spine in v1. If other tools add hooks, add to inventory and consider promotion.

---

## Provenance routing

The file-system layout encodes provenance directly:

| Location | Provenance |
|---|---|
| `shared/<type>/<name>` | `standalone`, shared across opted-in tools |
| `tools/<tool>/<type>/<name>` | `standalone`, tool-specific |
| `tools/<tool>/plugins.yaml` entry | `bundle:<plugin-name>`, contents not vendored |
| `tools/<tool>/packages.yaml` entry | `bundle:<package-name>`, contents not vendored |
| Discovered on tool's disk but not in playbook | `unknown` until classified |

When pulling state from a tool back into the playbook (reverse-scaffolding):

1. Read tool's bundle registry (`installed_plugins.json`, settings.json packages, etc.)
2. Each on-disk artifact tagged with provenance based on registry
3. Bundle-owned → write `bundle: <name>` reference in the appropriate manifest, do not vendor files
4. Standalone → copy file to `shared/<type>/` (if user opts to share) or `tools/<tool>/<type>/`
5. Unknown → held in scan results; user resolves via classification UI before commit

---

## Adapter contract

Every per-tool adapter implements the same interface. The engine treats adapters as opaque; only the contract matters.

```ts
// tui/src/lib/adapters/<tool>/index.ts
export interface ToolAdapter {
  // Identity
  readonly toolId: ToolId;            // 'claude' | 'codex' | ...
  readonly displayName: string;
  readonly bundleParadigm: 'artifact' | 'code-package' | null;

  // Detection
  detect(): Promise<DetectionResult>;
  // → { installed: boolean, version?: string, configDir?: string }

  // Inventory (machine → playbook view)
  scan(instance: ToolInstance): Promise<Inventory>;
  // → all on-disk artifacts with provenance tagged

  // Sync (playbook → machine)
  preview(playbook: Playbook, instance: ToolInstance): Promise<Diff>;
  // → operations to perform, never executes
  apply(diff: Diff, instance: ToolInstance, opts: ApplyOpts): Promise<ApplyResult>;
  // → executes confirmed operations only

  // Reverse scaffolding (machine → playbook fragment)
  pull(instance: ToolInstance, opts: PullOpts): Promise<PlaybookFragment>;

  // Validation
  validate(playbook: Playbook): ValidationReport;
  // → tool-specific schema and consistency checks

  // MCP emission (tools that support MCP)
  emitMcp?(servers: McpServer[], instance: ToolInstance): Promise<EmitResult>;

  // Bundle operations (tools that have bundles)
  installBundle?(ref: BundleRef, instance: ToolInstance): Promise<void>;
  updateBundle?(name: string, instance: ToolInstance): Promise<void>;
  uninstallBundle?(name: string, instance: ToolInstance): Promise<void>;
}
```

### Conformance test suite (Phase 4)

Every adapter passes the same suite:

- detect on a fresh tmp HOME → returns sensible result (probably `installed: false`)
- scan empty config dir → empty inventory, no errors
- apply minimal playbook → exact expected files written, content matches, modes/perms preserved
- apply same playbook twice → second is no-op
- apply playbook missing required_env → refuses with clear error
- pull from a hand-built config dir → produces playbook fragment that round-trips
- bundle install/update/uninstall (where supported) → idempotent
- removal always requires confirmation flag → no silent deletes

---

## Confirmation rules (locked)

The user explicitly required: **explicit removal confirmation always; no silent deletes.** The schema enforces this:

- `defaults.confirm_removals: true` is hard-locked. The engine does not honor `false` even if a user sets it.
- `apply` produces a `Diff` with separate `add`, `update`, `remove` lists.
- Removals never proceed without an explicit `--confirm-removals` flag (or interactive UI confirmation).
- Bundle uninstalls are removals (they delete files transitively).

---

## Worked example

```
my-playbook/
├── playbook.yaml
├── shared/
│   ├── AGENTS.md
│   ├── skills/
│   │   ├── incident-triage/
│   │   │   └── SKILL.md
│   │   └── deploy-checklist/
│   │       └── SKILL.md
│   ├── commands/
│   │   └── status.md
│   ├── agents/
│   │   └── reviewer.md
│   └── mcp/
│       ├── github-mcp.yaml
│       └── linear-mcp.yaml
├── tools/
│   ├── claude/
│   │   ├── tool.yaml
│   │   ├── plugins.yaml
│   │   ├── skills/
│   │   │   └── claude-output-formatter/SKILL.md
│   │   └── hooks/
│   │       └── pre-tool-call.json
│   ├── codex/
│   │   ├── tool.yaml
│   │   └── plugins.yaml
│   ├── opencode/
│   │   ├── tool.yaml
│   │   └── plugins.yaml
│   └── pi/
│       ├── tool.yaml
│       └── packages.yaml
└── .gitignore
```

`apply` to Claude, given the example tool.yaml above, produces these disk operations:

```
~/.claude/CLAUDE.md                        ← shared/AGENTS.md (target override)
~/.claude/skills/incident-triage/          ← shared/skills/incident-triage
~/.claude/skills/deploy-checklist/         ← shared/skills/deploy-checklist
~/.claude/skills/claude-output-formatter/  ← tools/claude/skills/claude-output-formatter
~/.claude/commands/status.md               ← shared/commands/status.md
~/.claude/commands/restart.md              ← shared/commands/restart.md
~/.claude/agents/reviewer.md               ← shared/agents/reviewer.md
~/.claude/.mcp.json                        ← emitted from shared/mcp/{github,linear}-mcp.yaml
~/.claude/hooks/pre-tool-call.json         ← tools/claude/hooks/pre-tool-call.json
~/.claude/plugins/ce-compound/             ← installed via Claude plugin mechanism
```

`apply` to Pi, with `pi-mcp-adapter` in packages.yaml:

```
~/.pi/agent/AGENTS.md                      ← shared/AGENTS.md (no rename)
~/.pi/agent/skills/incident-triage/        ← shared/skills/incident-triage
~/.pi/agent/skills/deploy-checklist/       ← shared/skills/deploy-checklist
~/.pi/agent/prompts/status.md              ← shared/commands/status.md (commands → prompts)
~/.pi/agent/.mcp.json                      ← emitted via pi-mcp-adapter conventions
(pi-mcp-adapter installed via npm; ce-compound npm-installed)
```

---

## Migration notes (Phase 3 preview)

Existing blackbook config in `~/.config/blackbook/config.yaml` has a different shape (per-resource arrays, no `shared/` vs `tools/<tool>/` split). Phase 3 will:

1. Translate existing `files`, `configs`, `plugins`, `tools` sections into the new layout
2. Preserve existing override semantics (the `claude-code:default → CLAUDE.md` pattern carries over directly into `tool.yaml.overrides.agents_md`)
3. Detect existing `.claude-plugin/marketplace.json` repos and map into the new `marketplaces` block
4. Move existing playbook YAMLs in `tui/src/lib/playbooks/` from runtime defaults to **adapter defaults** — they describe what each tool's config dir looks like, which is adapter knowledge, not playbook knowledge

---

## What's NOT in v1

Explicitly out of scope, deferred to v2 or later:

- Machine-local overrides (`machines/<hostname>.yaml`) — directory reserved, no behavior
- Codex `apps` (cloud connectors)
- Claude output styles, statuslines, projects
- OpenCode modes, themes, formatters, custom tools
- Project-scope artifacts (`.claude/`, `.opencode/`, `.pi/` in user repos)
- Secret manager integration (1Password, macOS Keychain)
- Per-resource version pinning as a first-class feature (manual via `version:` field works but UI doesn't surface it)
- Plugin/package authoring workflows (we govern, we don't author bundles)
- Sync conflict resolution beyond "always prompt"

---

## Open questions deferred to Phase 4

1. **Adapter version drift** — when a tool releases a new version that adds an artifact type, how does the playbook accommodate without breaking? Probably: adapter version detection + capability flags + graceful skip on unsupported.
2. **Apply atomicity** — if apply fails halfway, do we roll back? Probably: write to staging dir, atomic rename per file. Detail in Phase 4.
3. **Drift auto-resolution** — `defaults.drift_action: auto-resolve` mentioned but unspecified. Detail in Phase 4 if user wants this; default is `warn`.
4. **Pull granularity** — `pull` returns a fragment; how does the engine merge into existing playbook? UI design in Phase 5; engine support in Phase 4.
5. **Better Pi MCP extension** — current plan is `pi-mcp-adapter`. If a better Pi MCP path emerges, swap is contained to the Pi adapter; schema does not change.

---

## Status

- Schema v1 drafted
- Top-level layout, all artifact types, both bundle paradigms covered
- Adapter contract sketched (full impl in Phase 4)
- Secrets handling locked
- Confirmation rules locked
- Worked example walks through Claude + Pi
- Ready for review; on approval → Phase 3 (migration design)
