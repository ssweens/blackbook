---
date: 2026-05-02
status: draft
phase: 3
plan: docs/plans/2026-05-02-003-playbook-rearchitecture-plan.md
depends_on:
  - docs/architecture/tool-inventory.md
  - docs/architecture/playbook-schema.md
---

# Migration Plan

How users and the codebase get from the current resource-centric blackbook to the playbook-centric architecture. **No automated migration tool**; the user is fine doing a one-time manual move of their assets.

Three migration concerns:

1. **User's existing assets and config** — manual, with a documented checklist
2. **Cold start (`blackbook init`)** — automated, reverse-scaffolding from machine state (used for new machines, including the user's other machines, and any future fresh users)
3. **Adapter defaults migration** — internal code-level refactor of `tui/src/lib/playbooks/*.yaml` → adapter source

Everything is reversible, validated, and idempotent where applicable.

---

## Concern 1: User's existing assets and config (manual)

The user has explicitly opted out of automated migration. The job here is to make the manual move clean, fast, and well-documented.

### What the user does

```
1. Run `blackbook init --target ~/playbook` on their primary machine.
   This produces a fresh playbook from current machine state via reverse-scaffolding (Concern 2).

2. Manually move authored assets from old source_repo into the playbook:
   - AGENTS.md, CLAUDE.md, etc.        → playbook/shared/AGENTS.md
   - User-authored skills              → playbook/shared/skills/<name>/ or tools/<tool>/skills/<name>/
   - User-authored commands            → playbook/shared/commands/<name>.md
   - User-authored agents              → playbook/shared/agents/<name>.md
   - Tool-specific config files (settings.json, etc.) → tools/<tool>/<file>

3. Edit playbook.yaml + tool.yaml to opt-in shared items per tool (include_shared lists).

4. Edit shared/mcp/*.yaml to add MCP server definitions, using env-var refs for secrets.

5. Set required env vars in shell profile (per playbook.yaml `required_env` section).

6. Run `blackbook apply --dry-run` to preview disk operations, then `blackbook apply`.

7. Init a git repo in playbook/, commit, push to chosen remote.
```

### Documentation deliverable

A short manual-migration guide in the repo: `docs/migration-from-legacy.md`. Covers the steps above with concrete examples. Targets one published version of blackbook (current); future versions assume new playbook is canonical.

### What blackbook does on first run with new playbook

After the user has done their manual move and run `blackbook init`:

```
on startup:
  if playbook is configured (via ~/.config/blackbook/config.yaml `playbook_path` key):
    load playbook from <path>
    operate in new mode
  else:
    first-run flow:
      prompt: "Run `blackbook init` to create a playbook, or point at an existing one"
      exit until configured
```

Note: the legacy config schema is **gone**. There is no coexistence period. The new `config.yaml` shrinks to a near-empty file:

```yaml
# ~/.config/blackbook/config.yaml (new, minimal)
playbook_path: "~/playbook"
```

The user's existing `~/.config/blackbook/config.yaml` becomes obsolete. The blackbook upgrade replaces it with the minimal version pointing at their new playbook. The old file is preserved as `config.yaml.legacy.bak` for reference only.

### Implication: hard cut

Without an automated migration, blackbook cannot meaningfully run with both schemas. The release that introduces the playbook-centric architecture is a major version bump (`v2.0.0`). Users on `v1.x` continue working unchanged; users who upgrade to `v2.x` follow the manual migration once.

---

## Concern 2: Cold start (`blackbook init`)

Still automated. This is the primary onboarding path for new users **and** the user's own secondary machines once their playbook lives in git.

Two sub-cases:

### 2a. Fresh machine with playbook in git

```
$ git clone <repo> ~/playbook
$ blackbook init --from ~/playbook
```

Steps:
1. Reads playbook from path
2. Validates schema
3. Detects which `tools_enabled` are actually installed locally
4. Reports missing tools (warning, not error — apply will skip)
5. Validates `required_env` — warns on unset vars
6. Writes minimal `~/.config/blackbook/config.yaml` with `playbook_path`
7. Recommends `blackbook apply --dry-run` next

This is the **same-machine-as-the-source-of-truth** path. Reproducible setup across machines.

### 2b. Fresh machine, no playbook yet (reverse-scaffolding)

For new users or one-off scaffolding from an existing tool config dir.

```
$ blackbook init --target ~/playbook
```

Steps:

1. Detects all installed tools (existing detection logic)
2. For each detected tool:
   a. Reads its config dir (e.g., ~/.claude, ~/.codex, ...)
   b. Reads bundle registry (installed_plugins.json, settings.json packages, etc.)
   c. Tags every artifact on disk with provenance:
      - `bundle:<name>` — owned by a registered bundle
      - `standalone` — user-authored or directly added (not in any bundle)
      - `unknown` — can't determine
3. Cross-tool deduplication pass:
   - Groups same-named standalone artifacts across tools (e.g., `incident-triage` in both Claude AND OpenCode)
   - User reviews each candidate; opts in to share or keeps tool-specific
4. Generates playbook layout:
   - `shared/` from approved cross-tool candidates
   - `tools/<tool>/<type>/` for tool-specific standalone
   - `tools/<tool>/plugins.yaml` or `packages.yaml` from bundle registry
5. Generates `playbook.yaml` with `tools_enabled` = detected tools
6. Generates per-tool `tool.yaml` with `include_shared` = approved candidates
7. Resolves unknown-provenance items via prompts (see below)
8. Validates resulting playbook against schema
9. Shows preview of what was created
10. On confirmation: writes the playbook
11. Writes minimal `~/.config/blackbook/config.yaml` with `playbook_path`

### Cross-tool deduplication UX

A standalone artifact found with the same name in multiple tools is a candidate for sharing.

```
Found `incident-triage` skill in both claude and opencode (identical content).
  [s] Share — move to shared/skills/, opt-in from both tools
  [t] Tool-specific — keep two copies under tools/<tool>/skills/
  [m] Manual — show diff and let user decide per-tool
```

Defaults:
- Byte-identical → suggest **share**
- Differs → suggest **tool-specific**
- `--auto-share` flag accepts shared whenever content is byte-identical
- `--no-prompt` falls back to tool-specific for everything (user reorganizes later)

### Unknown-provenance UX

When a tool's bundle registry doesn't claim an on-disk artifact and we can't infer otherwise:

```
Skill `experimental-thing` exists in ~/.claude/skills/ but is not registered
in installed_plugins.json. Classify:
  [1] standalone (user-authored)
  [2] from bundle (specify name)
  [3] skip (don't include in playbook)
```

`skip` leaves the artifact on disk untouched but absent from the playbook. Future `apply` won't touch it. User's choice.

### Validation gates (cold start)

Before any write:
1. Target dir is empty or absent
2. All detected tools have registered adapters
3. No path collisions in proposed playbook
4. No unresolved `unknown` provenance items (user must classify or skip first)

Failure aborts before writing.

---

## Concern 3: Adapter defaults migration (internal, code-level)

The existing `tui/src/lib/playbooks/*.yaml` files describe each tool's config dir layout, install strategies, and component definitions. In the new architecture they describe **adapter knowledge** — properties of the adapter, not the playbook.

### Migration

Done during Phase 4 implementation, one-time code change:

For each existing playbook YAML in `tui/src/lib/playbooks/`:

1. Read the YAML (`amp-code.yaml`, `blackbook.yaml`, `claude-code.yaml`, `openai-codex.yaml`, `opencode.yaml`, `pi.yaml`)
2. Extract: `id`, `name`, `default_instances`, `structure`, `components`, `config_files`, `lifecycle`
3. Hand-port into the corresponding adapter source file `tui/src/lib/adapters/<tool>/defaults.ts` as exported constants
4. Adapter source becomes the source of truth for tool layout
5. Old YAML file deleted from `tui/src/lib/playbooks/`

Tool name mapping during this refactor:

| Old YAML file | New adapter dir |
|---|---|
| `claude-code.yaml` | `adapters/claude/` |
| `openai-codex.yaml` | `adapters/codex/` |
| `opencode.yaml` | `adapters/opencode/` |
| `amp-code.yaml` | `adapters/amp/` |
| `pi.yaml` | `adapters/pi/` |
| `blackbook.yaml` | TBD — evaluate during Phase 4; may be deleted entirely |

No user impact. Pure refactor. Tests must continue to pass at every step.

---

## What's deliberately not done

These were considered and rejected for v2.0:

- **Automated forward-migration tool** — user opted out; manual move is fine for the small current user base
- **Coexistence/deprecation period** — without auto-migration, no value in supporting both schemas at runtime
- **Field-mapping translator** — no longer needed; user copies files manually
- **Asset auto-resolution from `source_repo`** — manual move means user knows where their files are
- **Marketplace expansion logic during migration** — `blackbook init` reads marketplaces fresh on cold start; no need to expand at migration time
- **Backup/rollback for forward migration** — no forward migration to roll back

---

## What never moves into the playbook

These do not carry over from old setups; user must reconfigure or accept loss:

- **API keys, tokens, secrets** — playbook never stores them. User sets env vars per `required_env` in `playbook.yaml`.
- **Cache contents** — tool-managed, regenerated.
- **Tool runtime state** — sessions, history, etc.
- **Project-scope tool configs** (`.claude/`, `.opencode/` in user repos) — out of v1 scope.

---

## Test coverage for `blackbook init`

Cold start is the only programmatic migration path; it gets the test investment.

Fixture-based suite. Each fixture is `(input: pretend tool config dirs, expected: playbook tree)`. Test runs `init` against a tmp HOME and compares output to expected.

Coverage targets:

- Single tool, no bundles → standalone-only playbook
- Multiple tools, overlapping skills → dedup prompt fires; `--auto-share` works
- Bundle with contributed artifacts → bundle reference in plugins.yaml, not vendored files
- Unknown-provenance artifacts → classification prompt fires; `skip` works
- Multi-instance Claude → instances correctly captured in tool.yaml
- Network failure during marketplace expansion → graceful degradation, retryable
- Re-run after partial init → idempotent, picks up where left off OR refuses cleanly
- `--from <path>` mode (existing playbook in git) → validates and writes config only, doesn't scaffold
- Tool detected but no adapter registered → warning, tool entry omitted
- Empty machine state (no tools installed) → produces empty-but-valid playbook skeleton

---

## Documentation deliverables

For Phase 4/5 release:

- `docs/migration-from-legacy.md` — step-by-step manual migration for current users (one-time, supports the v1 → v2 jump)
- `docs/getting-started.md` — fresh-user `blackbook init` walkthrough
- `docs/playbook-from-git.md` — clone-on-new-machine workflow

---

## Status

- Concern 1 (user's manual migration) — documented checklist; no tooling needed
- Concern 2 (cold start) — automated, designed in detail
- Concern 3 (adapter defaults refactor) — one-time, done during Phase 4
- Test coverage scoped to cold start only
- v2.0 is a hard-cut release — no deprecation period
- Ready for review; on approval → Phase 4 (engine rebuild) starts
