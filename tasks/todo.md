## Universal Action Contract Convergence - Phase 2 (v0.23.0) ✅ DONE

### Completed
- [x] Removed remaining non-destructive detail-close behavior for skill uninstall-all in `App.tsx`
- [x] Updated `action-dispatch.ts` so skill uninstall-all now calls `refreshDetailSkill` (same contract as other non-destructive actions)
- [x] Updated `store.refreshAll()` to always invoke `refreshDetail()` after reloads
- [x] Updated `store.syncTools()` to await targeted reloads (`loadFiles`, `loadInstalledPlugins`, `loadPiPackages`) and call `refreshDetail()`
- [x] Updated `store.pullbackFileInstance()` to await `refreshAll()` (no more fire-and-forget stale detail windows)
- [x] Added dispatcher regression test for skill uninstall-all refresh contract
- [x] Added store regression test for sync-detail refresh contract
- [x] Passed quality gates: typecheck, build, and full test suite (`474/474`)
- [x] Performed tmux visual verification captures (`/tmp/bbverify-start2.txt`, `/tmp/bbverify-loaded.txt`)

### Result
All previously identified remaining contract gaps are now closed in the primary action paths. Non-destructive mutations preserve detail state and refresh from fresh store data consistently.

### Notes
- The universal contract checklist remains the source of truth for future features and regressions.
- Keep using tmux capture verification for UI-affecting changes.

## Follow-up bugfix (2026-05-18): Pi should show ssmp as installed

### Problem
- User reported Pi should show `ssmp` skillset as installed but UI did not.

### Root cause
- `getStandaloneSkills()` for non-flat tools (`pluginFlatInstall=false`) only scanned namespaced layout (`skills/<namespace>/<skill>/SKILL.md`).
- Actual Pi disk state was legacy flat layout (`skills/<skill>/SKILL.md`), so installs were missed and rendered as source-only.

### Fix
- Added compatibility scan path for non-flat tools to also detect legacy flat layout.
- Kept preferred namespaced behavior intact.
- Source-repo namespace mapping still assigns `ssmp` via `skills/ssmp/<skill>/SKILL.md`.

### Validation
- Real file state: confirmed Pi skill dirs exist on disk.
- Scanner state: `getStandaloneSkills()` now reports `ssmp` skills with Pi installations.
- App/store state: `loadInstalledPlugins()` now yields `standaloneSkills` with `namespace==='ssmp'` and Pi installs.
- Added integration tests:
  - `detects flat Pi skills on disk and maps them to ssmp namespace via source_repo`
  - `installs standalone skills to namespaced paths on non-flat tools`
  - `migrates legacy flat standalone skills to namespaced paths`
- Test suite now: `477/477` passing.
- Real migration verified on local Pi disk: legacy `~/.pi/agent/skills/<skill>` moved to `~/.pi/agent/skills/ssmp/<skill>` for 27 ssmp skills.
- **Namespace tree Enter key**: pressing Enter on a skill-header now opens the full standalone skill detail view (identical to Skills section), with all per-tool actions. Right arrow expands/collapses. Verified via tmux UI capture.

## Follow-up tests + upgrade refresh fix (2026-05-19)

### Completed
- [x] Fixed stale post-update plugin state by updating `store.refreshAll()` to reload installed plugins (`await loadInstalledPlugins({ silent })`) before tool/pi/file refreshes.
- [x] Added regression test: `refreshAll reloads installed plugins so stale state is cleared`.
- [x] Added regression test: `produces identical actions for a skill whether opened standalone or from namespace tree`.
- [x] Stabilized store test harness mocks for this path (`getStandaloneSkills`, `getManagedToolRows`) to isolate refresh behavior.
- [x] Quality gate passed: `pnpm test -- --run` (`479/479`).

### Result
- Plugin update flows now clear stale `hasUpdate`/upgrade UI state after refresh.
- Skill detail action generation is explicitly covered for both standalone and namespace entry paths.

## Follow-up bugfix (2026-05-19): newly installed Pi package not listed

### Problem
- User uninstalled one Pi package and installed a different one, but Blackbook still showed only the old package.

### Root cause
- `loadPiPackages()` only imported **installed-but-unlisted** packages from `settings.packages` when source started with `npm:`.
- Installed `git`/`local` Pi package sources were skipped entirely unless they were marketplace-listed or repo-prescribed.

### Fix
- Updated `loadPiPackages()` to include installed non-marketplace packages from **all** source types (`npm`, `git`, `local`) from `settings.packages`.
- Kept richer npm metadata behavior for `npm:` sources.
- Added regression test: `includes installed non-npm Pi packages from settings when not marketplace-listed`.

### Validation
- `pnpm test -- --run` → `480/480` passing.
- `pnpm typecheck` passed.
- `pnpm build` passed.

## Hardening pass (2026-05-19): Pi package listing gaps + shared source normalization

### Additional gaps identified
- Source matching logic was split/inconsistent:
  - store path used raw lowercase (`source.toLowerCase()`),
  - install checks used path-aware matching,
  - git source aliases (`git:github.com/...`, `https://github.com/...`, `owner/repo`) were not treated uniformly.
- Resulting risk: duplicate rows, missed rows, and stale-looking package inventory depending on source form.

### Fixes
- Added shared source-normalization utility in `marketplace.ts`:
  - `normalizePiPackageSource(source)`
  - `isPackageInstalled()` now uses it.
- Expanded `getSourceType()` to classify git shorthand forms as git (`github.com/...`, `owner/repo`).
- Refactored `store.loadPiPackages()` dedupe/matching to use shared normalization everywhere:
  - desired-spec matching
  - existing-source dedupe set
  - installed package ingestion from settings

### New regression tests
- `includes installed non-npm Pi packages from settings when not marketplace-listed`
- `does not duplicate installed git package when source uses equivalent git forms`
- `does not duplicate installed npm package when source differs only by case`
- `does not show duplicate rows when same package is installed from local source but prescribed via npm`

### Correction
- Removed name-based merge for Pi package rows. Install state is now strictly source-specific.
- Same package name from different sources (e.g. `npm:pi-web-access` vs local `../../src/pi-packages/pi-web-access`) remains as separate rows.
- This prevents a local package from incorrectly marking npm package rows as installed.

### Validation
- `pnpm test -- --run` → `483/483` passing.
- `pnpm typecheck` passed.
- `pnpm build` passed.

## Follow-up UI bugfix (2026-05-20): Installed tab missing in-git Pi package rows + non-alphabetical ordering

### Problem
- Installed tab did not reliably show prescribed (`in git`) Pi package rows when they were not installed.
- User expectation (and product requirement) is that prescribed rows remain visible in Installed tab.
- Default Installed-tab Pi package order must stay alphabetical.

### Root cause
- `App.tsx` Installed-tab Pi package selector used `effectivePiPackages.filter((p) => p.installed)`, dropping `recommended` (`in git`) rows from the view model used by navigation/rendering.
- Sorting in `App.tsx`/`InstalledTab.tsx` default path grouped by installed state rather than strict alphabetical order.

### Fix
- `tui/src/App.tsx`
  - Installed Pi package base set now includes prescribed rows: `p.installed || p.recommended`.
  - Default sort now strictly alphabetical with stable source tiebreakers:
    - `name`
    - `sourceType`
    - `source`
- `tui/src/tabs/InstalledTab.tsx`
  - Matched default sort behavior to strict alphabetical + stable source tiebreakers.
- Added E2E regression in `tui/src/app.e2e.test.tsx`:
  - `shows both installed and in-git-not-installed pi package variants in alphabetical default order`

### Verification plan
- [x] Run targeted quality gates (app.e2e, typecheck, build).
- [x] Verify in tmux Installed tab that both `pi-web-access` rows are visible:
  - local installed (`not in git`)
  - npm prescribed not-installed (`in git`)
- [x] Capture final tmux proof output (`/tmp/blackbook-installed-piweb-fixed2.txt`).

## Pi plugin bridge hard-gating (2026-05-23)
- [x] Remove Pi plugin projection fallback paths for plugin lifecycle operations.
- [x] Gate Pi plugin support on installed bridge prerequisites (now `@ssweens/pi-plugins`, `pi-subagents`, `pi-mcp-adapter`).
- [x] Route Pi plugin install/update/uninstall/sync through bridge commands (`pi -p "/claude:plugin ..."`).
- [x] Keep non-Pi plugin lifecycle behavior unchanged.
- [x] Update integration tests to cover non-Pi projection assumptions removal and keep suite green.
- [x] Run quality gates (`pnpm typecheck`, `pnpm test -- --run`, `pnpm build`) — `484/484` passing.
- [x] Visual verify in tmux plugin detail gating (`/tmp/bb-pi-bridge-gate.txt`).

## Pi plugin bridge fork + Claude-manifest compatibility (2026-05-23)
- [x] Switch Blackbook Pi plugin bridge detection from `pi-claude-marketplace` to `@ssweens/pi-plugins`, including local Pi settings package sources.
- [x] Resolve bridge orchestrators from `extensions/pi-plugins/...` for install/update/uninstall and state reads.
- [x] Stage Pi-compatible marketplace copies for local Claude marketplace checkouts before installing to Pi.
- [x] Convert Claude path-form `mcpServers: "./.mcp.json"` into Pi's required marketplace-entry MCP object and sanitize the staged `.claude-plugin/plugin.json`.
- [x] Repoint existing duplicate Pi marketplace records to Blackbook's staged compatible source so stale Claude checkout records do not keep failing installs.
- [x] Verify direct `desk` Pi install succeeds and Pi state records `desk` as installed.
- [x] Visually verify in tmux Installed tab: `desk Plugin · desk ✔ installed`.
- [x] Run quality gates: `pnpm typecheck`, `pnpm build`.

## Adoption backlog from skills-manager evaluation (2026-07-15)

Context: evaluated https://github.com/xingkongliang/skills-manager (v1.28.3, Tauri 2 + Rust, skills-only manager, 3k stars). Decision: keep blackbook as the integration point and adopt the ideas below — do NOT merge into or fork upstream (their scope is deliberately skills-only; config sync doesn't fit their symlink-first architecture). Skipped their tool adapter matrix (no interest in more tools right now). Reference clone inspected at session scratchpad; reference reads: `docs/skill-format-detection-spec.md`, `src-tauri/src/core/merge/`.

Order of work: hardening pass first (see next section), then features roughly in listed order.

### Hardening pass (pre-feature) — lessons from skills-manager's merge/backup engine

Source: deep read of their `core/merge/` + `git_backup.rs`/`auto_backup.rs`/`file_watcher.rs`/`content_hash.rs`. Scope guard: do NOT import their git ref choreography, commit-trailer state machine, or canonical-JSON convergence machinery — that complexity exists for multi-writer peer convergence over a shared remote, which blackbook's source→targets copy topology doesn't have. Port the decision-table/safety disciplines only.

Already covered in blackbook (verified, no action): atomic state writes with single-lock read-modify-write and corrupt-state preservation (`state.ts`); backups before overwrite with retention; per-instance state keys (attribution analog); skill detection already `SKILL.md`-only per their format spec.

- [x] **Content-hash scope for directory-synced units** (2026-07-15) — added one canonical `isSyncNoise(name, isDir)` predicate in `fs-utils.ts` (`.DS_Store`/`Thumbs.db`/`desktop.ini`, `*.pyc`/`*.pyo`, `.git`/`__pycache__` dirs) and routed all four directory walkers through it: the live `directory-sync.ts` check (had NO filter — the actual bug), `diff.ts` (had a partial local filter, now shared + extended), and both `hash.ts` walkers (dead today but exported/tested, fixed for future-safety). Root cause was an inconsistency: `diff.ts` filtered `.DS_Store` but `directory-sync.check` did not, so source-side noise showed as a drift row in the Sync tab whose diff (`d`) was empty. Verified on the live module: source `.DS_Store` → before `drifted: Target file missing: .DS_Store`, after `ok`. Tests: `isSyncNoise` unit tests + directory-sync + hashDirectory regressions. Sorted paths + `/` normalization already present; exec-bit folding N/A (blackbook doesn't track mode). Full suite 673 pass / 1 pre-existing unrelated failure (see note).
- [x] **Unmanaged-target overwrite guard** (2026-07-15) — VERIFIED first: all three sync modules (`file-copy`, `directory-sync`, `glob-copy`) `createBackup` unconditionally before overwrite (recoverable copies in `~/.cache/blackbook/backups/`, retention default 3); pullback backs up source — so no silent data loss ever existed. User chose to confirm-gate the remaining risk. IMPLEMENTED: an "untracked target" (`status:"drifted" && driftKind:"never-synced"` — the tool file exists but was never tracked, or state was lost) is now skipped by the default `y` sync and only runs on an explicit per-item push, exactly like a `both-changed` conflict. A never-synced target that is MISSING stays a safe auto-install. Renamed the force flag `forceBothChanged` → `forceOverwrite` (covers conflicts + untracked; no test refs). Relabeled file-copy message "Source changed" → "Untracked target (sync overwrites it)". Surfaced as a distinct "Untracked" bucket in SyncPreview/SyncList and "Untracked target" per-item label. Files: `file-copy.ts`, `files-slice.ts`, `types.ts`, `action-dispatch.ts`, `item-actions.ts`, `SyncPreview.tsx`, `SyncList.tsx`. Tests: file-copy untracked-label + missing-is-safe, store gate (skipped by default, synced under forceOverwrite). Visually verified rendered frames (SyncPreview shows `Untracked: Codex`; SyncList shows `Untracked: 1`). Scope note: directory-sync/glob-copy have no baseline state so cannot distinguish never-synced from source-changed — gate is file-copy only, which is the real "adopt a pre-existing config file" case.
- [ ] **Stage-then-rename for directory copies** — extract/copy to a staging sibling on the same volume, then one rename into place, so mid-copy failure leaves the original intact. Explicitly handle nested/overlapping source-vs-target paths (remove-first vs place-first ordering).
- [ ] **Backup timing completeness** — snapshot the pre-state before *every* destructive op, including pullback (back up the source-repo file before overwriting it) and plugin uninstall. When recovery can't distinguish user-edit from our own debris, keep both.
- [ ] **Partial-write leftover tolerance** — scans/syncs must skip-and-clean `*.tmp`-style leftovers from a crashed write rather than erroring or counting them as drift; validate the delta being applied, not the whole world (grandfather pre-existing dirt or every future sync bricks).
- [ ] **Case-folded path collision detection** — when planning installs/syncs, group by case/whitespace-folded path key with a deterministic winner, so case-insensitive filesystems (macOS/Windows) can't nondeterministically clobber.
- [ ] **Both-changed isolation regression test** — one conflicted file must never abort or block the rest of a batch sync; conflicts keep-target + flag, everything else proceeds. Verify current `syncTools()` behavior and pin with a test.
- [ ] **Keep sync planning pure** — the `(state, sourceHash, targetHash) → action` decision should stay a zero-I/O function with deterministic tie-breaks, unit-tested apart from the copy engine (mostly true today via `detectDrift`; confirm no planning logic has leaked into apply paths).
- [ ] **Adversarial test checklist from their real incidents** — add cases for: overlapping/nested paths, ignored/unknown files sitting where incoming content lands, case-folding renames, crash mid-write, external edit arriving during our own write window.
- [ ] (Deferred to CLI backlog) **Two-tier locking** — fail-fast for background work, bounded-wait (~20s) for foreground user actions; lock file must live outside any directory that gets renamed/recreated.

### Backlog: Presets
- [ ] Named groups of plugins/standalone skills; activate/deactivate per tool instance in one action
- [ ] Config representation in `config.yaml` (e.g. `presets: <name>: [plugin refs...]`), synced via source repo like everything else
- [ ] TUI: preset row/pills with active ✓ / partial (count badge) / inactive states
- [ ] Applying a preset is a one-time install/enable action, not a live sync (matches skills-manager semantics)

### Backlog: Project-local workspaces
- [ ] Manage `<project>/.claude/skills` (and per-tool equivalents) alongside global config dirs
- [ ] Compare project-local skills against source repo copies; sync in both directions (reuse three-way state keyed per project path)
- [ ] Recursive scanner must follow the skill-format detection policy: `SKILL.md` is the only skill marker; never treat `README.md`/`CLAUDE.md` as markers; support nested/namespace layouts without recursion short-circuiting (see spec read below)

### Backlog: Generalized adoption ("track in source repo" for everything)
- [ ] Extend the Pi-only `Track in source repo` flow to any unmanaged skill/command/agent found in a tool's config dir
- [ ] Installed tab: badge unmanaged items (`not in git`) uniformly across component types
- [ ] One action: copy into `<source_repo>` + register in marketplace/config as appropriate

### Backlog: Symlink as opt-in sync strategy
- [ ] Per-file/per-plugin `sync_mode: copy | symlink` (default copy)
- [ ] Symlink for skill/plugin dirs on tools that tolerate it — drift becomes impossible by construction, no state entry needed
- [ ] Keep copy + three-way state + pullback for config files (tools rewrite those in place)
- [ ] Drift/diff views must recognize symlinked targets and report "linked" instead of hashing through the link

### Backlog: Headless CLI mode
- [ ] Non-TUI entrypoint sharing `tui/src/lib/` core: `blackbook status|sync|install|uninstall|list` with `--tool`/`--json` flags
- [ ] `--json` machine-readable output so agents/scripts can drive blackbook (model: skills-manager's `skills-manager-cli` sharing the Rust core)
- [ ] Non-interactive confirmations (`--yes`, `--dry-run`)
