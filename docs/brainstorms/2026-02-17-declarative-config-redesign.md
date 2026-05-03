---
date: 2026-02-17
topic: declarative-config-redesign
---

# Declarative Config Redesign

## What We're Building

Transform Blackbook's config from "what to manage" into "what should exist" — a declarative, idempotent specification of desired system state. A user drops in a config file, opens Blackbook, and immediately sees what's missing, drifted, or in sync. The Sync tab becomes a reconciliation dashboard with the existing "Sync All" action converging the system to declared state.

Additionally, replace the monolithic `install.ts` (2,443 lines) with an Ansible-inspired module architecture — small, composable, testable TypeScript modules each implementing a `check`/`apply` interface.

## Why This Approach

### Approaches Considered

1. **Unified files model (YAML)** — Merge assets/configs into one `files` list, switch from TOML to YAML. *Chosen.*
2. **Minimal TOML cleanup** — Keep assets/configs split, normalize field names. *Rejected: doesn't solve the "two concepts" problem.*
3. **Package-oriented** — Group files into named bundles. *Rejected: duplication across packages, extra nesting for simple cases.*
4. **Ansible as execution engine** — Use actual Ansible playbooks for sync operations. *Rejected: Python 3.11+ dependency doesn't exist on stock macOS, 1-3s startup latency, 40-80MB install for local-only file ops.*
5. **Comtrya (Rust)** — Single binary, local provisioning. *Rejected: pre-1.0, small community.*
6. **Ansible-inspired Node-native modules** — Steal the architecture (check/apply, idempotent modules), implement in TypeScript. *Chosen.*

### Patterns Borrowed From

| Tool | Pattern Borrowed |
|------|-----------------|
| Brewfile | `check` / `install` / `cleanup` lifecycle |
| chezmoi | Three-way state: desired vs last-applied vs actual |
| mise | `.local.yaml` for machine-specific overrides |
| Dotbot | YAML manifest mapping source → target |
| Terraform/Ansible | `check`/`apply` (plan/apply) split with dry-run preview |
| Ansible | Idempotent module interface with `changed`/`ok`/`failed` status |

## Key Decisions

### 1. YAML replaces TOML

**Rationale:** Our config is fundamentally "a list of things with properties." TOML's `[[array.of.tables]]` syntax is awkward for this; YAML handles lists and nesting naturally. Most developers already know YAML from Docker Compose, GitHub Actions, K8s, etc.

### 2. Unified `files` list replaces assets + configs

**Rationale:** The assets/configs distinction (all tools vs one tool) is just a targeting question. A single `files` list with an optional `tools` key is simpler:
- Omit `tools` → syncs to all enabled instances
- Specify `tools: [claude-code]` → syncs to that tool only
- Specify `tools: [claude-code, pi]` → syncs to a subset

Eliminates: legacy/modern format duality, two different override mechanisms, cognitive overhead of choosing the right section.

### 3. Machine-specific overrides in a separate `.local.yaml` file

**Rationale:** Borrowed from mise/Docker Compose. The main `config.yaml` stays clean and shareable (commit to dotfiles repo). Machine-specific paths, instance overrides, and local-only tools go in `config.local.yaml` (gitignored). Deep merge at load time.

### 4. Clean break from old format

**Rationale:** User base is small enough. No backward compatibility layer — manually convert `config.toml` to `config.yaml`. Leave old TOML file in place (Blackbook ignores it once YAML exists). No migration command needed.

### 5. Ansible-inspired module architecture replaces monolithic install.ts

**Rationale:** The current install.ts is 2,443 lines handling file copy, symlinks, drift detection, backup, glob expansion, directory hashing, atomic writes, and reverse sync — all interleaved. Breaking this into modules with a standard `check`/`apply` interface gives us:
- Each module is ~30-50 lines, independently testable
- The Sync tab calls `check()` on everything to build status
- "Sync All" calls `apply()` on everything not `ok`
- `changed`/`ok`/`missing`/`drifted` status maps directly to UI indicators

## New Config Schema

### Main config: `~/.config/blackbook/config.yaml`

```yaml
settings:
  source_repo: ~/src/playbook/config
  package_manager: pnpm

marketplaces:
  playbook: https://raw.githubusercontent.com/ssweens/playbook/main/.claude-plugin/marketplace.json

tools:
  claude-code:
    - id: default
      name: Claude
      config_dir: ~/.claude
    - id: learning
      name: Claude Learning
      config_dir: ~/.claude-learning
  pi:
    - id: default
      name: Pi
      config_dir: ~/.config/pi

files:
  # Shared across all tools (no 'tools' key)
  - name: AGENTS.md
    source: AGENTS.md
    target: AGENTS.md

  - name: Prompt Library
    source: prompts/
    target: prompts/

  # Tool-specific (add 'tools' key)
  - name: Claude Settings
    source: claude-code/settings.json
    target: settings.json
    tools: [claude-code]

  - name: Claude Commands
    source: claude-code/commands/
    target: commands/
    tools: [claude-code]

  - name: Pi Config
    source: pi/config.toml
    target: config.toml
    tools: [pi]

plugins:
  playbook:
    compound-engineering:
      disabled_skills: [skill-a, skill-b]
      disabled_commands: [cmd-x]
      disabled_agents: [agent-y]
```

### Machine-specific: `~/.config/blackbook/config.local.yaml`

```yaml
# Gitignored — machine-specific overrides
# Deep-merged with config.yaml at load time

tools:
  claude-code:
    - id: default
      config_dir: ~/custom/claude-path  # Override path on this machine

files:
  - name: AGENTS.md
    overrides:
      claude-code:default: CLAUDE.md  # This instance gets a different target filename
```

## Module Architecture

### Core Interface

```typescript
interface CheckResult {
  status: 'ok' | 'missing' | 'drifted';
  diff?: string;       // Unified diff for drifted items
  details?: string;    // Human-readable description
}

interface ApplyResult {
  changed: boolean;
  backup?: string;     // Path to backup if one was created
  error?: string;
}

interface Module<P> {
  check(params: P): Promise<CheckResult>;
  apply(params: P): Promise<ApplyResult>;
}
```

### Planned Modules

| Module | Replaces | Purpose |
|--------|----------|---------|
| `FileCopy` | Asset/config single-file sync | Copy file with checksum comparison |
| `DirectorySync` | Asset/config directory sync | Recursive directory sync with hash tree |
| `SymlinkCreate` | Plugin skill/command linking | Create/verify symlinks |
| `PluginInstall` | Plugin install flow | Clone repo, link components |
| `PluginRemove` | Plugin uninstall flow | Remove symlinks, clean cache |
| `TemplateRender` | (new capability) | Render templates with variables |
| `BackupManager` | Backup logic in install.ts | Backup before overwrite, cleanup old backups |

### Orchestrator

```typescript
// The orchestrator replaces the monolithic sync logic
async function reconcile(config: Config): Promise<ReconcileResult> {
  const results: CheckResult[] = [];

  // Check all declared files against all target instances
  for (const file of config.files) {
    const instances = resolveTargetInstances(file, config.tools);
    for (const instance of instances) {
      const module = file.source.endsWith('/') ? directorySync : fileCopy;
      results.push(await module.check({ ...file, instance }));
    }
  }

  // Check all declared plugins
  for (const [marketplace, plugins] of Object.entries(config.plugins)) {
    for (const [plugin, settings] of Object.entries(plugins)) {
      results.push(await pluginInstall.check({ marketplace, plugin, settings }));
    }
  }

  return { results };
}
```

### 6. Three-way state for pullback-enabled files

**Rationale:** Blackbook already has pullback (reverse sync) functionality. Three-way state tracking makes pullback *deterministic* instead of heuristic:
- **Source changed, target unchanged** → forward sync (auto-safe)
- **Target changed, source unchanged** → pullback candidate (user edited it)
- **Both changed** → conflict, needs manual resolution

Replaces the current timestamp-based sync direction heuristic. Only enabled for files marked `pullback: true` in tool playbooks — not all files need this overhead.

**Implementation:** A state file at `~/.cache/blackbook/state.yaml` records the SHA256 hash of each file at last-apply time. The `check()` module compares three hashes: source, last-applied, and actual target.

### 7. Tool playbooks replace hardcoded tool definitions

**Rationale:** Instead of hardcoding tool knowledge in TypeScript (`DEFAULT_TOOLS` in config.ts), each tool gets a YAML playbook describing its setup: default instances, directory structure, component install strategies, and config files. Adding a new tool = adding a YAML file, not writing code.

Playbooks also serve as the source of truth for which files support pullback (three-way state) and how components (skills, commands, agents) are installed.

Users can override default playbooks by placing custom versions in their `source_repo/playbooks/` directory.

### 8. Cleanup operation for undeclared files

**Rationale:** Borrowed from Brewfile's `cleanup` pattern. Blackbook can detect files in tool instances that are NOT declared in the config and offer to remove them. This completes the desired-state lifecycle: check (what's missing/drifted), sync (converge), cleanup (remove extras).

### 9. Schema validation with zod

**Rationale:** Validate the YAML config at load time using zod. Provides clear error messages for malformed configs and serves as living documentation of the schema. Eliminates the scattered validation logic currently distributed across multiple files.

## Tool Playbook Schema

Each supported tool has an internal playbook YAML defining its setup recipe. Playbooks are bundled with Blackbook and are NOT user-facing. Users configure tools via `config.yaml` — the `tools:` section overrides playbook defaults for instances, and playbook metadata (like `pullback: true`) is automatically inherited by matching `files:` entries.

### Example: `playbooks/claude-code.yaml`

```yaml
id: claude-code
name: Claude Code

default_instances:
  - id: default
    name: Claude
    config_dir: ~/.claude

structure:
  - skills/
  - commands/
  - agents/

components:
  skills:
    install_dir: skills/
    strategy: symlink
  commands:
    install_dir: commands/
    strategy: symlink
  agents:
    install_dir: agents/
    strategy: symlink

config_files:
  - name: Settings
    path: settings.json
    format: json
    pullback: true

  - name: CLAUDE.md
    path: CLAUDE.md
    format: markdown
    pullback: true
```

### Example: `playbooks/pi.yaml`

```yaml
id: pi
name: Pi

default_instances:
  - id: default
    name: Pi
    config_dir: ~/.config/pi

structure:
  - packages/
  - themes/

components:
  packages:
    install_dir: packages/
    strategy: symlink

config_files:
  - name: Pi Config
    path: config.toml
    format: toml
    pullback: true
```

### Playbook Design Principles

- **Internal, not user-facing** — playbooks are Blackbook's built-in tool knowledge, not user config
- **Declarative, not procedural** — playbooks describe desired state, modules execute it
- **Convention over configuration** — sensible defaults, config.yaml overrides only when needed
- **New tool = new YAML** — no TypeScript changes required for tool support
- **Pullback is opt-in** — only files marked `pullback: true` get three-way state tracking
- **Syncable flag** — playbooks declare whether a tool is a valid file sync target (excludes config-only tools like blackbook)

## Resolved Questions

| # | Question | Decision |
|---|----------|----------|
| 1 | Migration UX | No migration command. Manually convert config.toml → config.yaml. Leave old TOML in place. |
| 2 | Two-way vs three-way state | Three-way for pullback-enabled files (state file tracks last-applied hash). Two-way for everything else. |
| 3 | Template support | Deferred (YAGNI). Playbooks provide tool metadata (not templates). |
| 4 | Cleanup operation | Yes — adopt existing files on first run, then detect and offer to remove orphaned state-tracked files. |
| 5 | Schema validation | Yes — use zod for YAML config validation at load time. |

## Next Steps

-> `/workflows:plan` for implementation details — phased migration strategy, module implementation order, test plan
