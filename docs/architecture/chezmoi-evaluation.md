# chezmoi as the playbook substrate — evaluation

## TL;DR

chezmoi can replace ~85% of what blackbook does, with ~5% of the code we're
maintaining. It is missing two specific things we'd need to add as small
helpers:

1. **Fan-out of one source file to multiple destinations** (one shared
   skill → six tool config dirs). chezmoi expects a 1:1 source→target map.
2. **Multiple "homes"** — e.g. `~/.claude` and `~/.claude-learning` both
   getting the same content. chezmoi works against a single home root.

Both are solvable cleanly with **two thin chezmoi `.tmpl` techniques** —
no fork or wrapper required. See "Gaps and how we close them" below.

Everything else (drift inspection, apply, re-add/pullback, secrets,
per-machine variation, install hooks, status, dry-run) is **already there
and battle-tested**.

---

## 1. Repo layout (replaces the v2 playbook schema entirely)

```
~/.local/share/chezmoi/                     # source repo (the "playbook")
├── .chezmoi.toml.tmpl                      # per-machine config prompt
├── .chezmoiignore                          # exclude per host/OS
├── .chezmoiscripts/                        # install/lifecycle hooks
│   ├── run_onchange_install-claude-plugins.sh.tmpl
│   ├── run_onchange_install-pi-packages.sh.tmpl
│   └── run_onchange_install-opencode-plugins.sh.tmpl
├── .chezmoidata/
│   ├── shared-skills.yaml                  # list of shared skills
│   ├── claude-plugins.yaml                 # marketplace plugins
│   └── pi-packages.yaml                    # npm/git packages
├── .chezmoitemplates/                      # reusable snippets
│   └── agents-md-body
├── shared/                                 # NOT managed by chezmoi directly
│   ├── AGENTS.md                           # included via templates
│   └── skills/                             # fanned-out via templates
│       ├── agentic-app-creator/
│       └── eval-model/
├── dot_claude/                             # → ~/.claude
│   ├── CLAUDE.md.tmpl                      # imports shared/AGENTS.md
│   ├── settings.json
│   └── skills/                             # populated by run_once script
├── dot_claude-learning/                    # → ~/.claude-learning
│   └── CLAUDE.md.tmpl                      # SAME template, different home prefix
├── dot_codex/
│   └── AGENTS.md.tmpl
├── dot_config/
│   ├── opencode/
│   │   └── AGENTS.md.tmpl
│   └── amp/
│       └── AGENTS.md.tmpl
└── dot_pi/
    └── agent/
        └── AGENTS.md.tmpl
```

Naming convention: `dot_X` → `~/.X`, `private_` → 0600, `executable_` → +x,
`run_once_` / `run_onchange_` for scripts, `.tmpl` for templates.

---

## 2. How each problem maps

### 2.1 Shared content fanned out to many tools

**Problem:** One `AGENTS.md` body needs to land at:
- `~/.claude/CLAUDE.md` (renamed)
- `~/.claude-learning/CLAUDE.md`
- `~/.codex/AGENTS.md`
- `~/.config/opencode/AGENTS.md`
- `~/.config/amp/AGENTS.md`
- `~/.pi/agent/AGENTS.md`

**chezmoi solution:** Use `.chezmoitemplates/`. Body lives in one place,
each tool's destination is a tiny `.tmpl` that includes it.

```
.chezmoitemplates/agents-md-body         # the actual content
```

```
# dot_claude/CLAUDE.md.tmpl
{{ template "agents-md-body" . }}
```

```
# dot_codex/AGENTS.md.tmpl
{{ template "agents-md-body" . }}
```

Edit the body once, `chezmoi apply` writes to all six. Pullback via
`chezmoi re-add ~/.claude/CLAUDE.md` — but this is the one rough edge:
it would re-add to the leaf template. We'd need a tiny `pullback-agents-md.sh`
helper that copies disk → `.chezmoitemplates/agents-md-body` and runs
`chezmoi apply` to propagate. ~5 lines of bash.

### 2.2 Shared skills (directories) fanned out

**Problem:** `shared/skills/agentic-app-creator/` (a whole directory) needs
to land in all six tool config dirs.

**chezmoi solution:** A `run_onchange_` script with a hash trigger:

```bash
# .chezmoiscripts/run_onchange_install-shared-skills.sh.tmpl
#!/bin/bash
# {{ include ".chezmoidata/shared-skills.yaml" | sha256sum }}
# {{ list .chezmoi.sourceDir "shared/skills" | join "/" | output "find" "-type" "f" "-exec" "sha256sum" "{}" ";" }}

SRC="{{ .chezmoi.sourceDir }}/shared/skills"

# Each tool that opts into shared skills (defined in chezmoidata)
{{- range .tools }}
{{-   if .enabled }}
{{-     range .config_dirs }}
mkdir -p "{{ . }}/skills"
rsync -a --delete "$SRC/" "{{ . }}/skills/"
{{-     end }}
{{-   end }}
{{- end }}
```

`run_onchange_` re-runs only when the script's content (including the
hash comment) changes — i.e. when any shared skill's bytes change. This
is **exactly the trigger we want**.

### 2.3 Multiple instances of the same tool (Claude default + Learning)

**chezmoi solution:** They're just different home dirs. The fan-out script
above lists both `~/.claude/skills` and `~/.claude-learning/skills` as
targets. The `CLAUDE.md` files are separate `.tmpl` files at
`dot_claude/CLAUDE.md.tmpl` and `dot_claude-learning/CLAUDE.md.tmpl`,
both delegating to the same `.chezmoitemplates/agents-md-body`.

Per-instance overrides (e.g. claude-learning has different content) just
go in that instance's template:

```
# dot_claude-learning/CLAUDE.md.tmpl
{{ template "agents-md-body" . }}

## Learning-mode overrides
- Always explain reasoning at length
- Suggest alternatives before committing
```

### 2.4 Per-machine differences

**chezmoi solution:** First-class. `.chezmoi.toml.tmpl` prompts on first
init, stored per-machine.

```toml
# .chezmoi.toml.tmpl
{{- $hostname := .chezmoi.hostname -}}
[data]
    hostname = "{{ $hostname }}"
{{- if eq $hostname "work-mbp" }}
    profile = "work"
    enable_learning_instance = false
{{- else }}
    profile = "personal"
    enable_learning_instance = true
{{- end }}
```

Then in templates: `{{ if .enable_learning_instance }}...{{ end }}`. Or
gate whole files with `.chezmoiignore`:

```
{{- if eq .profile "work" }}
.claude-learning
{{- end }}
```

### 2.5 Plugin / package installs

**chezmoi solution:** `run_onchange_` scripts driven by data files.

```yaml
# .chezmoidata/claude-plugins.yaml
claude_plugins:
  - feature-dev@claude-plugins-official
  - rust-analyzer-lsp@claude-plugins-official
  - ce-compound@playbook
```

```bash
# .chezmoiscripts/run_onchange_install-claude-plugins.sh.tmpl
#!/bin/bash
# Trigger: {{ .claude_plugins | toJson | sha256sum }}
set -euo pipefail

declare -A want
{{- range .claude_plugins }}
want["{{ . }}"]=1
{{- end }}

# Read currently-installed
have=$(jq -r '.plugins | keys[]' ~/.claude/plugins/installed_plugins.json 2>/dev/null || echo "")

# Install missing
for p in "${!want[@]}"; do
  if ! echo "$have" | grep -qx "$p"; then
    claude plugin install "$p"
  fi
done

# Uninstall extra (only if confirm_removals=true)
{{- if .confirm_removals }}
for p in $have; do
  if [[ -z "${want[$p]:-}" ]]; then
    echo "Would remove: $p (run: claude plugin uninstall $p)"
  fi
done
{{- end }}
```

Same pattern for Pi packages, opencode plugins, amp tools.

### 2.6 Drift inspection

**chezmoi solution:** Built in.

```
chezmoi diff                    # full unified diff, source → target
chezmoi diff ~/.claude/skills   # just one path
chezmoi status                  # short letter codes (A added, M modified, R removed)
chezmoi verify                  # exit non-zero if any drift exists
```

`chezmoi status` output looks like `git status --short`:
```
 M ~/.claude/CLAUDE.md
 M ~/.pi/agent/AGENTS.md
 A ~/.claude/skills/new-thing/SKILL.md
```

For richer diff: `chezmoi diff | delta` (using the delta pager) or
`chezmoi diff | difft` (difftastic). Side-by-side, syntax-highlighted,
already exists.

### 2.7 Pullback (disk → source)

**chezmoi solution:** `chezmoi re-add <path>`. Reads the file from disk
and writes it back to the source repo. For templated files it's smart
enough to re-add into the unrendered template when there's no
template-specific data.

```
chezmoi re-add ~/.claude/CLAUDE.md       # disk → source
chezmoi git add . && chezmoi git commit -m "pullback CLAUDE.md"
chezmoi git push                          # source repo synced to remote
```

`chezmoi git` is a passthrough to git in the source repo — same workflow
as our pullback auto-commit, with no custom code.

The one edge case: pulling back a fanned-out file to the right source.
If `~/.claude/CLAUDE.md` differs from `~/.codex/AGENTS.md`, `re-add` only
updates the closer template. We'd add a tiny helper script for the
"update the shared body from any tool" case. ~10 lines.

### 2.8 Secrets

**chezmoi solution:** Native age/gpg support, plus integrations for
1Password, Bitwarden, Vault, Keepass, AWS Secrets Manager.

```
# settings.json.tmpl
{
  "anthropic_api_key": "{{ (onepasswordRead "op://Personal/Anthropic/credential") }}"
}
```

Encrypted-at-rest in source repo via `chezmoi add --encrypt`. Source has
`.age` files; templates reference them through the encryption layer.

Strictly better than our env-var indirection.

### 2.9 Apply / dry-run / single-item apply

```
chezmoi apply                   # apply everything
chezmoi apply --dry-run         # show what would change
chezmoi apply ~/.claude         # just one tool's tree
chezmoi apply ~/.claude/CLAUDE.md   # just one file
```

---

## 3. What we keep, what we throw away

### Throw away
- `tui/src/lib/playbook/` (loader, schema, validator, writer) — chezmoi YAML
  data files replace this
- `tui/src/lib/sync/engine.ts` — `chezmoi apply` replaces it
- `tui/src/lib/adapters/*/bundle-ops.ts` — `run_onchange_` scripts replace
  these
- `tui/src/lib/adapters/applier.ts` — chezmoi is the applier
- `tui/src/lib/migration/*` — `chezmoi init <repo>` replaces it
- `playbook.yaml`, `tools/<tool>/tool.yaml` — chezmoi config + data files
- The whole bundle-state computation — `chezmoi status` does it

That's roughly **3,000 lines deleted**.

### Keep
- The TUI itself, but as a **read-only inspector** over chezmoi:
  - "Status" tab: `chezmoi status` parsed into a list
  - "Diff" tab: `chezmoi diff <path>` rendered
  - "Apply" tab: invokes `chezmoi apply`
  - "Pullback" tab: invokes `chezmoi re-add` + `chezmoi git push`
  - Per-tool grouping: filter status by path prefix
- The visualization (side-by-side diff view, action menu) — these are
  genuinely better than chezmoi's CLI-only experience
- Tool detection / version display — useful overview

The TUI shrinks from ~10K lines to ~1K, becomes a thin status dashboard.

### What chezmoi does that the current code doesn't
- Encrypted secrets at rest
- Per-host data prompts on first init
- Templated content in any text file (not just AGENTS.md)
- Post-update scripts ordered by name
- Cross-platform (we have macOS-only assumptions)
- `chezmoi unmanaged` — list files in target dirs not in source (our
  "untracked" detection, but with proper symmetric coverage)

---

## 4. Gaps and how we close them

### Gap 1: Fan-out (one source → many targets)
Already shown above: `.chezmoitemplates/` for text + `run_onchange_`
rsync script for directories. **5–20 lines of bash per fan-out group.**

### Gap 2: Pullback to a fanned-out source
`chezmoi re-add` works for 1:1 mappings. For fanned-out shared content,
add a 10-line helper:

```bash
# scripts/pullback-shared.sh
case "$1" in
  agents-md)
    cp "$2" "$(chezmoi source-path)/.chezmoitemplates/agents-md-body"
    chezmoi apply
    chezmoi git add . && chezmoi git commit -m "pullback: $1 from $2"
    ;;
  skill)
    name=$(basename "$2")
    rsync -a --delete "$2/" "$(chezmoi source-path)/shared/skills/$name/"
    chezmoi apply
    chezmoi git add . && chezmoi git commit -m "pullback: skill $name"
    ;;
esac
```

The TUI pullback action menu invokes this script with the right args.

### Gap 3: "Untracked" detection symmetric to ours
`chezmoi unmanaged` lists all files in target dirs not in the source.
This is exactly our "extra on disk" + "untracked bundle" surfacing.

### Gap 4: Plugin install/uninstall reconciliation
The `run_onchange_` script approach above works, but doesn't give a
preview of what would install/uninstall. Add `--dry-run` mode that just
prints the diff. Same script, two modes.

---

## 5. Migration cost

To get from current playbook v2 → chezmoi setup:

1. **One-time conversion script** (~150 lines) reads `playbook.yaml` +
   `tools/*/tool.yaml` and writes:
   - `.chezmoidata/*.yaml`
   - `dot_<tool>/AGENTS.md.tmpl` files
   - `.chezmoiscripts/run_onchange_*.sh.tmpl` files
   - `.chezmoitemplates/agents-md-body`
2. Run `chezmoi init https://github.com/ssweens/playbook --apply` on
   each machine (replaces our `blackbook init`)
3. Delete `playbook.yaml` and `tools/<tool>/tool.yaml`
4. Verify drift: `chezmoi diff` should show empty on a freshly-applied
   machine
5. Rewrite TUI as thin status dashboard over chezmoi commands (~1 week)

Total: about a weekend for the conversion + a week to slim the TUI.

---

## 6. Honest pros/cons vs continuing custom

### Pros of chezmoi
- **Mature** — used by tens of thousands of people, decade-old project
- **Single static binary** — install with brew, no node runtime
- **All the hard parts done** — diff, apply, re-add, status, encrypt,
  templates, host data, ignore patterns, dry-run
- **Excellent docs** — chezmoi.io has cookbook for every scenario we hit
- **Git-native** — source repo IS a git repo, no separate sync flow
- **3,000 lines of our code deleted**
- **Future-proof** — chezmoi has more contributors than we ever will

### Cons of chezmoi
- **Less custom UX** — our TUI has tool-aware grouping, side-by-side
  inventory, per-item action menus. chezmoi is CLI-first.
- **Templates in Go syntax** — `{{ if eq .profile "work" }}` is uglier
  than YAML
- **Fan-out is implicit** (via templates+scripts) rather than declared in
  one config — slightly harder to "see what goes where"
- **No knowledge of tool concepts** — chezmoi doesn't know what a Claude
  plugin or Pi package is. We provide that via scripts. The TUI loses its
  tool-aware language unless we keep a thin wrapper.
- **Two-way sync (pullback) for fanned-out content** requires a helper
  script. Single-source files are native.
- **No native concept of "plugin/package" reconciliation** — we write that
  as install scripts, but they're imperative, not declarative

### Net assessment

For your use case (5 tools, ~10 skills, ~30 plugins/packages, 2 instances,
1 user, a handful of machines), chezmoi is a clearly better foundation.
The current code has been re-implementing chezmoi's primitives badly.

The **only** reason to keep the custom approach is if you want the TUI's
specific UX (tool-aware grouping, side-by-side inventory, action menus
per item) badly enough to justify the maintenance burden. And even then,
**the right answer is to keep that UX as a thin layer over chezmoi**, not
a parallel sync engine.

---

## 7. Recommended path

1. **Today:** keep the current branch as-is, don't merge.
2. **Spike:** spend 2 hours setting up a chezmoi repo from scratch with
   one tool (Claude) and one shared skill, see how it feels in practice.
   `chezmoi init`, `chezmoi diff`, `chezmoi apply`, `chezmoi re-add`.
3. **Decide:** if the spike feels good, commit to chezmoi and run the
   conversion. If it feels worse than expected, we know what we'd be
   giving up and can stay custom with eyes open.
4. **Either way:** stop adding to the current sync engine. The 3,000
   lines we have either get replaced by chezmoi or get replaced by a
   simpler in-house engine after we've felt the pain ceiling on the
   current design.

I'd start the spike on a branch named `spike/chezmoi-eval` with the
playbook repo (not blackbook) — the question is "does chezmoi handle our
content," not "does it integrate with our TUI." The TUI question only
matters if the answer to the first is yes.
