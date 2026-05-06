# chezmoi spike — findings

Spike location: `/tmp/chezmoi-spike/` (sandboxed, no real home touched).

## What I built in 30 minutes

A complete chezmoi source repo modeling our actual playbook needs:
- 4 tools (claude, codex, opencode, pi) each with `AGENTS.md` (or
  `CLAUDE.md` for claude) generated from one shared template body
- Per-tool branches in the body via `{{ if eq .tool "claude" }}` etc
- 2 shared skills fanned out to opted-in tools via a `run_onchange_`
  rsync script driven by per-tool data
- Plugin reconciliation via a second `run_onchange_` script reading
  a desired-set yaml
- A pre-existing "extra" skill on disk to test untracked detection

Source layout (~10 files total):
```
.chezmoiignore                          # ignore shared/
.chezmoidata/tools.yaml                 # per-tool config + plugin list
.chezmoiscripts/run_onchange_install-shared-skills.sh.tmpl
.chezmoiscripts/run_onchange_install-claude-plugins.sh.tmpl
.chezmoitemplates/agents-md-body        # the one source of truth
dot_claude/CLAUDE.md.tmpl               # 3 lines, includes the body
dot_codex/AGENTS.md.tmpl                # 3 lines, includes the body
dot_config/opencode/AGENTS.md.tmpl      # 3 lines, includes the body
dot_pi/agent/AGENTS.md.tmpl             # 3 lines, includes the body
shared/skills/agentic-app-creator/SKILL.md
shared/skills/eval-model/SKILL.md
```

## What worked, with command output

### 1. Apply (initial)
```
→ claude plugins reconciled: ce-compound@playbook
→ claude:   syncing 2 shared skill(s) to .claude/skills
→ opencode: syncing 1 shared skill(s) to .config/opencode/skills
→ pi:       syncing 2 shared skill(s) to .pi/agent/skills
```
Codex correctly got nothing (empty `shared_skills`), proving the
per-tool opt-in still works.

### 2. Idempotency
Second `chezmoi apply` → silent no-op. Scripts didn't re-run because
their hash-trigger comments are unchanged.

### 3. Drift detection
After editing `~/.claude/CLAUDE.md` on disk:
```
$ chezmoi status
MM .claude/CLAUDE.md         # M source, M target
```
`chezmoi diff` shows the unified diff. Just like our DriftDiffView
content, but in standard diff format.

### 4. Pullback for direct files
```
$ chezmoi re-add .claude/settings.json
$ chezmoi status                       # clean — no further drift
```
Source updated, target matches, status clean. **One command. Zero
custom code.**

### 5. "Extra on disk" detection
```
$ chezmoi unmanaged
.claude/plugins
.claude/skills            # has the pre-existing "already-here" skill
.config/opencode/skills
.pi/agent/skills
```
Same coverage as our `untrackedBundles` + "extra on disk" combined.

### 6. Plugin reconciliation
Add `ce-plan` to `.chezmoidata/tools.yaml`:
```
$ chezmoi apply
→ claude plugins reconciled:
    ce-compound@playbook
    ce-plan@playbook
```
Hash on script changed → script re-ran → `installed_plugins.json`
updated. Same pattern would shell out to `claude plugin install` in
real usage.

### 7. Safety on unexpected disk changes
After editing a target by hand, `chezmoi apply` (without `--force`)
**refused** to silently overwrite:
```
.claude/CLAUDE.md has changed since chezmoi last wrote it?
```
This is exactly the safety we'd want and don't currently have.

## What needs custom work

### Pullback to fanned-out source (~20 LOC helper)
`chezmoi re-add` is 1:1. For our shared-body case, edits could be
intended for either:
- the shared body (propagate to all tools), or
- the tool-specific override section (just one tool)

This is a **UX design** question — exactly the kind the TUI's per-item
action menu is good at. Implementation is a 20-line shell helper plus
two action-menu options ("pull to shared body" / "pull to this tool
only"). Not a chezmoi limitation.

### Tool-aware grouping in the dashboard
`chezmoi status` is a flat list. Our TUI groups by tool/instance/kind.
Wrap `chezmoi status --format=json` and group client-side. ~50 LOC.

### Side-by-side diff view
`chezmoi diff` is unified diff. We have a side-by-side renderer.
Pipe `chezmoi diff <path>` through our existing diff layout. Reuse
`DriftDiffView.tsx` mostly as-is.

### Per-machine setup
chezmoi has this natively (`.chezmoi.toml.tmpl` with prompts on first
init), but it's CLI-driven. The TUI could surface it as a wizard.
Optional polish.

## What we lose vs current code

Honestly, almost nothing material:

- Custom adapter abstraction → replaced by data-driven scripts
- Schema validation → chezmoi has its own (looser, but the data file
  is human-edited so YAML schema isn't really worth it)
- Bundle state computation → `chezmoi status` + `chezmoi unmanaged`
  give the same picture

The current code's main "value over chezmoi" was tool-aware concepts
(Claude plugins, Pi packages, Amp tools as first-class). chezmoi makes
these data + scripts instead of TypeScript adapters. **For 5 tools
this is a clear win.** The adapter pattern would only pay off if we
were building this for hundreds of tools with rich shared behaviors,
which we're not.

## What we gain

- **~3000 LOC deletable** from `tui/src/lib/` (sync engine, applier,
  bundle-ops, playbook loader/schema/validator/writer, migration)
- **Encrypted secrets at rest** (age, 1Password, vault) — strictly
  better than env-var indirection
- **Per-machine config** as a built-in primitive
- **Standard tooling everyone knows** — new contributors can read
  chezmoi docs instead of our adapter contract
- **Single static binary** — install with brew, no node runtime needed
  on target machines (TUI still needs node, but `chezmoi apply` can
  run in CI / on a server where no node is installed)
- **Safety against silent overwrites** — chezmoi prompts before
  clobbering disk edits
- **Mature ecosystem** — `chezmoi.io` cookbook covers every scenario;
  decade-old project; tens of thousands of users

## Honest gotchas

1. **`.tmpl` files run with `sh`, not bash** — `declare -A` doesn't
   work. Either configure `[interpreters.sh] command = "bash"` in
   chezmoi config, or write POSIX. Easy to hit, easy to fix.

2. **macOS bash is 3.2** — no associative arrays even with `bash`
   shebang unless you've installed bash 4+. Just write POSIX.

3. **`shared/` directory** must be in `.chezmoiignore` to prevent
   chezmoi from trying to apply it as a literal target. One line.

4. **Hash triggers for directory contents** require `output "sh" "-c"
   ...find...sha256sum...` because Go template `glob` returns a list
   and `sha256sum` needs a string. Slightly clunky but works.

5. **Re-add for templated files** doesn't reverse-engineer changes back
   through the template chain. For 1:1 mapped templates (our settings.json
   case) it works. For multi-source templates (shared body) you need a
   helper. Not a bug, a design tradeoff.

6. **Source path resolution for include scripts** — `.chezmoi.sourceDir`
   for the source repo, `.chezmoi.destDir` for the target. Don't use
   `.chezmoi.homeDir` in scripts if you want `--destination` overrides
   to work (and they need to for safe testing).

## Final verdict

**Adopt chezmoi.** The spike took 30 minutes including hitting and
solving every gotcha listed above. The result handles every workflow
the current 10K-line system handles, with about 100 lines of YAML +
shell.

The TUI becomes a thin **inspection and curation layer** over chezmoi:
- Run `chezmoi status` periodically, render grouped by tool/instance
- Side-by-side diff view rendering `chezmoi diff <path>` output
- Action menu invokes `chezmoi apply <path>`, `chezmoi re-add <path>`,
  or our pullback helper for fanned-out content
- Per-tool lifecycle (install/uninstall) stays in the TUI for tools
  that need it, but is just shelling out

**Estimated path:**
1. **1 day:** convert current playbook v2 repo → chezmoi source layout
   (script-assisted; mostly mechanical)
2. **2 days:** TUI shrinks to status dashboard + diff view + action
   menu wrapping chezmoi commands
3. **1 day:** secrets, per-machine config, README rewrite

**Total: 4 working days vs continuing to fight the current architecture
indefinitely.**

## Recommendation

Stop work on the current sync engine. Convert to chezmoi. Keep the TUI
as the inspection layer. Delete ~3000 lines and gain encrypted secrets,
per-machine prompts, safety against silent overwrites, and standard
tooling.

The current branch (`feat/playbook-rearchitecture`) has the right ideas
about UX (per-item action menu, side-by-side diff, plain-English labels)
but the wrong substrate. Keep the UX, replace the substrate.
