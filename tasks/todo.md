## Shared `.agents/skills` redirect + `.agents` pseudo-tool (v0.26.0) ✅ DONE

### Problem
- Blackbook installed skills into each tool's own proprietary directory (`~/.codex/skills`, `~/.config/opencode/skills`, `~/.config/amp/skills`, `~/.pi/agent/skills`) even though Codex, OpenCode, Amp, and Pi all natively read the emerging `.agents/skills` convention (Codex has no `.codex/skills` at all) — real, unnecessary duplication.

### Fix
- New `resolveInstanceSubdirPath` (`path-utils.ts`): a component's `install_dir` can be an absolute/`~`-prefixed override, resolved directly instead of joined onto the tool's own `config_dir`. Swapped every `join(configDir, subdir, ...)` call site in `install.ts`, `adapters/managed.ts`, `plugin-status.ts`, and `pi-bridge.ts`'s `resolveInstalledPluginComponentPath` to use it.
- Codex/OpenCode/Amp/Pi's `skills` component `install_dir` changed from `skills/` to `~/.agents/skills` in their playbooks. Claude Code untouched (no `.agents/skills` support).
- New `agents.yaml` pseudo-tool playbook (`kind: tool`, `config_dir: ~/.agents`, `skills` component only, no lifecycle/binary) registered in `BUILTIN_TOOL_IDS` — shows up as a normal Tools-tab row, not added to `tool-registry.ts` (no binary to manage).
- Managed adapter (`adapters/managed.ts`) install path: detects when a physical `dest` is already tracked by another instance's manifest entry for the same plugin+item (`findSiblingInstall`) and skips re-backing-up/re-copying it, marking the entry `sharedInstall: true`. Uninstall skips filesystem operations entirely for `sharedInstall: true` entries — only the instance that owns the real backup/absence touches the file. Without this, two instances sharing a physical file would each back up the other's just-installed content, and a sibling's uninstall could resurrect content a prior instance's uninstall had already correctly restored/deleted.
- Per-instance "Uninstall from `<tool>`" UI copy (`item-actions.ts`) notes when the target is the shared location.

### Validation
- Full test suite green (780 tests, 769 passing, 10 skipped, 1 pre-existing unrelated failure) — see `docs/TEST_COVERAGE.md`.
- Live-verified in tmux with a sandboxed HOME/XDG fixture (bare `bun src/cli.tsx`): standalone skill + plugin skill component both land in shared `~/.agents/skills` once; OpenCode/Codex's own dirs stay empty; Claude Code keeps its own independent copy; sibling-uninstall vs. primary-uninstall behavior confirmed on real disk state.
- **Caught and fixed during verification:** `install.integration.test.ts` didn't sandbox `HOME`, only `XDG_CONFIG_HOME`/`XDG_CACHE_HOME` — once `skillsSubdir` became `~`-prefixed for 4 tools, the test suite's real installs briefly wrote test fixtures into the developer's actual `~/.agents/skills` (confirmed no real user content was lost — timestamps and content diffed against the real source; cleaned up with explicit user confirmation). Fixed by adding a sandboxed `HOME` to the test's `setupTestEnvironment`/`cleanupTestEnvironment`.

### Notes
- No automated migration of old per-tool skill installs — documented in README as a manual cleanup step post-upgrade.
- The existing synthetic "Global" `~/.agents/skills` Projects-tab workspace (`projects.ts`) now overlaps with the `agents` pseudo-tool tracking the same directory through the normal sync engine — left as an accepted, documented overlap rather than consolidated this pass.

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
- [x] **Crash-safe directory copies** (2026-07-15) — Agent audit: file-copy and glob-copy already write atomically (temp+fsync+rename); directory-sync was the one gap, using `cpSync` in place so a mid-copy crash left a torn directory (and a truncated in-flight file). Chose per-file atomic write mirroring glob-copy over a staging-dir swap: it fixes the torn-FILE corruption risk, preserves directory-sync's merge semantics (unmanaged target-only files survive — a whole-dir swap can't do that without a 2× clone), and aligns apply with check (both use the noise-filtered `listFilesRecursive`, so source noise is neither hashed nor propagated). Added a `pathsOverlap` guard (identical or nested source↔target) since per-file copy loses Node's cpSync self-copy protection. Tests: nested subdirs, merge-semantics preservation, noise not propagated, overlap refused (identical + nested), stranded-temp tolerated by check. Note: batch isn't transactional (some files old/new on crash, each intact) — inherent to merge semantics, same as glob-copy, and the pre-taken backup covers rollback.
- [x] **Backup timing completeness** (2026-07-15) — Agent audit confirmed file/dir/glob copy, file-level pullback, plugin install-over-existing (`copyWithBackup`), and cleanup all back up first. Found two real gaps where every OTHER overwrite engine backs up but these didn't: `installSkillToInstance` (cpSync-overwrites a drifted on-disk skill, i.e. the "overwrite disk with source" branch) and `pullbackSkillToSource` (rmSync+cpSync of the source-repo skill — git only recovers *committed* content, uncommitted edits were lost). Added `createBackup`+`pruneBackups` before both (owners `skill:<name>` / `skill-source:<name>`, matching the existing `symlink:`/`cleanup:` colon convention). Tests: drifted install backs up user edits before overwrite; pullback backs up prior source before removal. (Uninstall/delete paths intentionally not backed up — deletion is the intent and recovery is via the surviving source-repo copy / git; left as-is.)
- [x] **Partial-write leftover tolerance** (2026-07-15) — Agent audit found `atomicWriteFileSync` (`fs-utils.ts`) stranded its temp `.<ms>.<pid>.tmp` on a failed write/rename (only closed the fd, never removed the temp), and `isSyncNoise` didn't exclude that shape — so a leftover in a synced dir read as phantom "Target file missing"/hash-mismatch drift across all three walkers, and `directory-sync.apply` could even propagate it. Fixed both: wrapped the write+rename in a try/catch that best-effort-removes the temp before rethrowing, and taught `isSyncNoise` to match `/^\.\d+\.\d+\.tmp$/` (anchored so a real `draft.tmp` is untouched). Tests: cleanup-on-rename-failure leaves no orphan; temp-pattern noise match vs real `.tmp` content.
- [x] **Both-changed isolation regression test** (2026-07-15) — Agent audit confirmed the file/module path is ALREADY isolated: `orchestrator.safeApply`/`safeCheck` catch per-step (a thrown `apply()` becomes a non-changed result, never rethrown), and the `syncTools` loop collects errors + continues. Pinned it with two tests: a file with a both-changed instance skips it but still syncs the safe instance; one file item reporting an error doesn't abort the next item in the batch (both `runApply` calls fire, error surfaced).
- [x] **Sync planning purity** (2026-07-15 — verified, no change) — Agent audit: the drift DECISION (`state.ts` lines 117-127) is already a pure, total 5-way table; `detectDrift` wraps it with a `loadState()` read but every branch is covered twice (`state.test.ts` detectDrift + `file-copy.test.ts` end-to-end). Extracting a pure `decide()` buys marginal test-speed with no coverage/correctness gain → left as-is. Revisit only if the table grows or the per-check `loadState()` re-parse shows up in profiling.
- [x] **Adversarial test checklist** (2026-07-15) — added across this pass: overlapping/nested dir paths (directory-sync overlap test), stranded atomic-temp tolerated by scanner (directory-sync + fs-utils), untracked-target gate (store + file-copy), both-changed batch isolation + one-error-doesn't-abort (store), thrown-apply continues (pre-existing `orchestrator.test.ts`), corrupt state.json (pre-existing `state.test.ts`). Still MISSING → case-only collision (folded into the deferred case-folding item below).

### Deferred (need a UI/product decision or are lower-value)
- [ ] **Case-folded path collision detection** (deferred — LOW likelihood, MODERATE impact per audit) — on a case-insensitive FS two managed items whose names differ only by case (files `Settings.json`/`settings.json`, skills `DB`/`db`) can silently clobber and then flip-flop drift forever, because `buildStateKey`/target-path computation are case-sensitive and nothing folds. Recipe: add `foldPathKey(absPath)` in `state.ts` (lowercase on darwin/win32, strip trailing space/dot on win32) and a planning-time collision warning in the `loadFiles` loop (`files-slice.ts`); route `installSkillToInstance` target through `safePath` for parity. Needs a UI affordance for the warning → hold for product decision. Comes from a user authoring mistake or cross-source marketplace skills, not normal flow.
- [ ] **Non-file batch-isolation wrap** (deferred — optional per audit) — the file path is fully isolated, but a non-file handler (`installPiPackage`/`updateToolAction`/`installSkillToInstance`/`syncPluginInstances`) that THREW rather than returned an error would escape the un-`catch`ed `syncTools` per-item loop and abort the rest. They return errors today, so this is defensive. Clean fix needs a per-item try/catch (re-indent or extract `syncOneItem`) — hold to avoid a noisy diff / masking real throws for a theoretical gap.
- [ ] (CLI backlog) **Two-tier locking** — fail-fast for background work, bounded-wait (~20s) for foreground user actions; lock file must live outside any directory that gets renamed/recreated.

### Profiles (2026-07-16) — the reframed "presets", done for `.agents` skills
Reframe: presets were per-tool-instance skill toggles (agent-centric); after the project pivot a **profile** is a named skill bundle applied to a **workspace** (global or project) as a one-shot provision. Inverse of adopt (adopt pulls skills *in*; profiles push a curated set *out*).
- [x] **Profiles** (2026-07-16) — config `profiles: { <name>: [skill names] }` (schema+writer+merge). `P` on the Projects tab (list or drill-in) opens `ProfilePickerModal` targeting the current workspace; Enter applies → pushes each of the profile's source-repo skills into that workspace's `.agents/skills` (reuses `pushSkillToProject`; skills not in the source repo are skipped with a warning). Store: `profiles` state (loaded with projects) + `applyProfile` action. Tests: slice applyProfile (pushes present skills, skips missing; empty/unknown no-op) + config mocks. Verified in tmux: `starter=[db,web]` applied to an empty project → both pushed + in-sync, `extra` still available. Deferred: creating/editing profiles in-UI (config-defined for now, like marketplaces); active/partial state badges (one-shot apply, not a live toggle).

### Project layer (2026-07-16 — direction pivoted with user)
Decisions: additive NEW layer alongside global/agent management; a project is a plain directory (NO git linkage); scope is the shared, tool-agnostic **`.agents/skills`** dir only for now (NOT a per-tool matrix). Model copied from skills-manager (analyzed 2026-07-16): filesystem-derived association (no stored skill↔project table — scan live + drift via existing engine); `-disabled` sibling-dir enable/disable; three add modes (pick-dir / scan-root / adopt); five sync verbs keyed off drift. Presets deferred/reframed as "profiles" applied to projects.

- [x] **Foundation (data layer)** (2026-07-16) — `projects: [{path, name?}]` config schema + writer + merge (generic); `lib/projects.ts` scans `<project>/.agents/skills` (+`-disabled`) and classifies each skill in-sync/drifted/project-only vs the source-repo skill index (reuses noise-filtered `hashDirectory`); `store/projects-slice.ts` with loadProjects/addProject/removeProject (config-backed, path stored raw for `~` portability, dedupe by expanded). Tab type extended (not yet exposed). Module tests: source index (flat+namespaced), status classification, empty cases. Slice + tab UI verified in the next commit.
- [x] **Projects tab (read-only inventory)** (2026-07-16) — `tabs/ProjectsTab.tsx` (project list + selected-project detail box with per-skill status glyphs ✓/≠/•) and `components/AddProjectModal.tsx` (path input). App.tsx wiring: TABS + TabBar label (position 6, Settings→7), TabContent case, refreshTabData case, initial-hydration branch, maxIndex branch, `a` add / `d` remove keys, addProject overlay-registry entry + render case + handler. Behaves per app model (hydrate initial tab; `R` loads current). Visually verified in tmux against a temp config/fixtures: list shows `3 skills · 1 drifted`; detail shows `✓ db in sync`, `• local project-only`, `≠ web (disabled) drifted`, `0/1 available to add`; add-modal → registered + persisted to config.yaml; `d` removed proj2 from list + config. Tests: 6 slice tests (load/add/remove incl. non-dir + dup + missing) + updated e2e tab-indicator/settings assertions.
- [x] **Provisioning** (2026-07-16) — drill-in per-skill actions (user chose "drill into skill rows"). Enter opens a project's skill list (present skills + available-to-add), Esc backs out (`projectDetailPath` store state). `lib/project-actions.ts` reuses the hardened directory-sync engine: `p` push source→project (add available / reset present; guarded when a present skill has no source), `u` pull project→source (creates `skills/<name>` for project-only; commit left to source-repo controls), `e` toggle enable/disable via the `-disabled` sibling, `d` delete (backup first). Store actions push/pull/toggle/removeProjectSkill reload + notify. Tests: 7 project-actions (real-FS) + slice/store-shape updates. Visually verified all four actions + guard + drill-out in tmux: push extra→in-sync, pull local→source, toggle extra→disabled dir, delete→gone+backup(`project-skill-del:extra`)+returns-to-available.
- [x] **Global `~/.agents/skills` workspace** (2026-07-16) — the global mirror of the project layer, and the biggest `.agents`-standardization payoff (sync skills once to the shared `~/.agents/skills` instead of fanning per-tool). Modeled as a synthetic, always-present "Global" project rooted at `$HOME` (`ProjectInfo.synthetic`), so the entire scan/drift/drill-in/provisioning stack works on it unchanged. Pinned first in the tab (magenta), shown as `~/.agents/skills (global)`, not removable (`d` guarded; not in config). Provisioning notifications generalized "project" → "workspace". Tests: `projects.global.test.ts` (mocks homedir/config) asserts synthetic-first + in-sync/available classification. Verified in tmux with a temp HOME: Global row lists `~/.agents/skills`, drill-in + push into `~/.agents/skills` works.
- [~] **Width** — extend beyond skills as project-scoping needs arise. DECIDED NOT to manage project AGENTS.md / agent-instruction files (2026-07-16): unlike skills (a shared library you provision a *subset* of), instruction/agent files are project-bespoke, live in the project's own repo, and differ distinctly per project — the central-source→subset model doesn't fit them.
- Deferred: git-awareness (skills-manager doesn't do it; optional nicety), per-tool project dirs (only `.agents` for now). Naming: the tab is "Projects" but now hosts the Global workspace too — consider renaming to "Workspaces" (offered to user).

### Adoption (2026-07-16) — done for `.agents` skills
- [x] **Adopt unmanaged `.agents` skills** (2026-07-16) — cross-workspace sweep: `A` on the Projects tab opens a modal listing every skill in a workspace's `.agents/skills` (global + all projects) that isn't in the source repo (`project-only`), deduped by name (first workspace wins). Confirm → bulk pull each into `source_repo/skills/<name>` (reuses `pullSkillToSource`), then one `commitAndPushSourceRepo` (best-effort; degrades cleanly with no git identity / no remote). `collectUnmanagedSkills` + `adoptUnmanagedSkills` slice action + `AdoptModal`. Tests: collectUnmanagedSkills (dedup/empty), slice adopt (pull-per-skill + single commit + no-op-when-empty). Verified in tmux: discovered gonly(Global)+ponly(proj), adopted both into source, and (with a git identity) auto-committed `chore: adopt N skill(s)`. Note: per-skill adoption also already exists via drill-in `u` (pull on a project-only skill); this is the discovery+bulk+commit layer.
- Deferred: adopting non-skill component types (commands/agents) — instruction/agent files decided out (see Width); Pi `Track in source repo` remains its own marketplace-registering flow.

### Symlink as opt-in sync strategy (2026-07-16) — done for skill/plugin-component installs
- [x] **`settings.skill_sync_mode: "copy" | "symlink"` (default `"copy"`)** (2026-07-16) — global opt-in, added to `config/schema.ts` + `config.ts` (writer/serialize/`getSkillSyncMode()`) + `SettingsPanel.tsx` enum entry. Deliberately a new, explicitly-opt-in setting rather than wiring up the dormant `strategy: symlink` default already sitting unused in every bundled playbook's component schema — flipping that dormant field would have silently changed every user's default with no warning.
- [x] **Standalone skill installs** (2026-07-16) — `installSkillToInstance` (`install.ts`) branches to `applySymlinkSync` (new sync core extracted from `modules/symlink-create.ts`: `checkSymlinkSync`/`applySymlinkSync`, with the module's `async check`/`apply` now thin wrappers) when `skill_sync_mode === "symlink"`, skipping the copy+backup path entirely. Verified live in tmux: synced a standalone skill, confirmed a real `lrwxr-xr-x` symlink on disk to the source-repo skill dir, then edited the source file directly and saw the edit reflected instantly through the target with zero resync.
- [x] **Plugin-component installs** (2026-07-16) — `copyWithBackup` (`adapters/managed.ts`) takes the same symlink branch (after backing up any pre-existing target) before its copy/`cpSync` fallback, so Codex-style file-copy tool adapters (`installPluginItemsToInstance` → `copyWithBackup`, used by `managedAdapter`/`codexAdapter`/Claude's `installComponents` component surface) symlink plugin skill/command/agent components too. Verified live via the real Discover-tab install flow against a Codex instance (Claude's own plugin `install()` goes through the native `claude` CLI and never reaches this code path): installed a plugin from a local `file://` marketplace, confirmed the resulting `~/.codex/skills/<plugin>/<skill>` path is a real symlink into blackbook's plugin cache, then edited the cache copy directly and saw the change reflected instantly through the target.
- [x] **Found + fixed while verifying**: local `file://` marketplace URLs were entirely broken for plugin installs — `downloadPlugin`'s `isLocalMarketplace` check (`install.ts`) only recognized `/`, `./`, `../`, `~` prefixes, so a `file://` marketplace URL fell through to the GitHub-clone branch and failed with "Cannot determine repo URL". Fixed by routing through the existing (previously unused/untested) `resolveLocalPath` in `path-utils.ts`, which also had its own latent bug fixed in the same pass: its `file://` branch returned `fileURLToPath()` raw without the "if it's a file, use its directory" normalization the bare-path branch applied — so a `file://` URL pointing at `marketplace.json` itself (the common case) resolved to the file, not its containing repo dir. Both fixes covered by new tests (`install.integration.test.ts`, `path-utils.test.ts`).
- Explicitly deferred (perf-only or separate-decision, not started): drift-check short-circuiting for symlinked installs (three call sites identified — `install.ts` standalone-skill SKILL.md compare, `plugin-drift.ts`'s `hasDiff()` git subprocess, `projects.ts`'s `classifyStatus` hashDirectory compare — symlinked targets can't drift by construction, so these checks are wasted work, not incorrect); project-workspace (`.agents/skills`) symlink support (blocked on a real semantic tradeoff — a whole-dir symlink would break the "preserve unmanaged extra files in target" merge contract `directorySyncModule` currently honors, needs its own decision); config files (never symlinked — tools rewrite those in place, unaffected by this setting).

### Headless CLI mode (2026-07-16) — done
- [x] **Non-TUI entrypoint** — `src/cli.tsx` argv-sniffs: a recognized subcommand (`status`/`list`/`sync`/`install`/`uninstall`, or `--help`/`--version`) skips Ink/React entirely and runs `runCli()`; bare `blackbook` is unchanged. New `tui/src/lib/cli/` module (`program.ts` commander wiring, `commands.ts` handlers, `tool-filter.ts`, `format.ts`) is a thin adapter over the existing `useStore` Zustand store — `initializeStore()` + a narrowed bootstrap (`loadMarketplaces`/`loadInstalledPlugins`/`loadPiPackages`/`loadFiles`, deliberately skipping `refreshToolDetection`/`refreshManagedTools`/`refreshDetail` — see note below), then `getSyncPreview()`/`syncTools()`/`installPlugin()`/`uninstallPlugin()` exactly as the TUI does. Zero duplicated business logic. New dependency: `commander` (bun-installed, matching `tui/`'s actual package manager — the `packageManager: pnpm` field is on the *root* package.json, a different/unrelated package; `tui/` moved to bun in `b13dedd`, May 2026).
- [x] **`--json` machine-readable output** — every subcommand accepts `--json`; diagnostic/progress output goes to stderr, keeping stdout pure JSON.
- [x] **Non-interactive confirmations** — `sync` only auto-resolves the same "safe" subset the TUI's default bulk sync does; `--yes` force-overwrites conflicts/untracked targets (mirrors `forceOverwrite`); `--dry-run` prints the resolved item list without calling `syncTools`.
- [x] **Real `--tool` scoping** — added an optional `toolFilter?: (toolId, instanceId?) => boolean` param to `syncTools` (`store/files-slice.ts`) — additive, `undefined` behaves identically to before (regression-tested). Needed because the `plugin`/`skill` branches recompute their own instance targeting internally and ignore the preview item's own instance list; pre-filtering the item array alone would not have scoped them correctly. `status`/`list`'s `--tool` is a simpler report-only filter over already-loaded state.
- [x] Command surface matches the backlog exactly: `status|list|sync|install|uninstall`, no `update` command (not in the original ask — noted as a fast-follow, not started).
- [x] **Found + fixed while verifying** (2026-07-16): local `file://` marketplace URLs were entirely broken for plugin installs (`downloadPlugin`'s local-marketplace detection didn't recognize `file://`; the `resolveLocalPath` helper it now routes through had its own separate, previously-untested bug). Landed as part of the earlier symlink-sync commit, not this one — see that section above.
- [x] Tests: `tool-filter.test.ts`/`format.test.ts` (21 unit tests, pure logic, no subprocess) + `files-slice.test.ts`-style additions to `store.test.ts` for the `toolFilter` param. Live-verified all 5 subcommands (+`--json`/`--tool`/`--yes`/`--dry-run`/error cases/exit codes) against a real scratch fixture via the built `dist/cli.js`, and confirmed bare `blackbook` still launches the TUI unchanged.
- [~] **`cli.integration.test.ts` (spawns the real CLI, asserts on real disk state) is written but `describe.skip`ped** — not a code defect: fixture data written *from within the running vitest process* (any mechanism — `fs.*`, `execFileSync("sh", ...)`, with/without `mkdtempSync`, `beforeEach`/`beforeAll`, forks/threads pool — all tried, all identical) is invisible to a `spawnSync`'d child in this environment, while a fixture that already existed before vitest started works instantly. ~15 isolated single-assertion probes exhaustively ruled out every fixture-construction variable; none reproduced outside vitest (plain `node` scripts with the identical `spawnSync` call always worked). The CLI's actual behavior is proven correct by the live tmux/dist verification above and the pure-logic unit tests — this skip is scoped to the test-plumbing mechanism only. Worth a fresh look in a different environment/CI runner rather than more local debugging.
- Deferred, not started: drift-check short-circuiting was already deferred under the symlink-sync section; `update` subcommand; the `.test-tmp` project-relative fixture experiment (unused, cleaned up).

### Plugin drift restoration (2026-07-16) — done, corrected mis-diagnosis
- [x] **Corrected an earlier mis-diagnosis from the same day**: this backlog item originally claimed detail-view on-demand drift computation had been removed by a revert (based on `grep`ing for `computePluginDrift` in `App.tsx` and finding zero hits). That grep missed the actual call site — `App.tsx`'s real `openPluginDetail()` and `refreshDetailPlugin()` call `computeItemDrift()` (the wrapper, not `computePluginDrift` directly), deferred 300ms with proper stale-navigation guards, writing to `detail.drift`. **This was never broken.** The real, narrower gap: `App.tsx`'s `managedPlugins` memo (list-view "changed" badges on Installed/Discover) reads `pluginDriftMap[p.name]` for every installed plugin, but nothing ever populated `pluginDriftMap` with real data — `setDetailPluginDrift()` only ever writes `detail.drift` (the one open detail), not the map. `pluginDriftMap` was permanently `{}` outside of tests that inject it directly.
- [x] **Root cause**: a pre-hard-disable batch `useEffect` (`git show 0a8b2a9`) used to populate `pluginDriftMap` for every installed plugin via bare `Promise.all(plugins.map(...))` — no cross-plugin throttling. `computePluginDrift()` already bounds concurrency *within* one plugin (4 components × 2 tool-instances ≤ 8 concurrent git subprocesses), but N plugins running that fully concurrently means up to `8×N` concurrent git subprocesses — for 10 installed plugins, 80 concurrent spawns, which is what actually starved libuv and made the TUI feel unresponsive. The later "hard-disable background loading" commit (`b386ac4`) deleted the whole effect for exactly that reason, replacing it with `setPluginDriftMap({})`.
- [x] **Fix**: `computeAllPluginsDrift(plugins, concurrency=2)` (`lib/plugin-drift.ts`) reuses the module's existing (now-exported) `mapLimit` worker-pool helper to bound cross-plugin concurrency, capping the worst case at `concurrency × 8 = 16` concurrent git subprocesses regardless of installed-plugin count. `App.tsx`'s mount-only reset effect (from the immediate fix below) was replaced with the restored batch effect, keyed on `effectiveInstalledPlugins` (a stable `useMemo`, so it only re-fires when the installed list actually changes, not on unrelated re-renders). No changes needed to the already-correct detail-view mechanism. New `plugin-drift.test.ts` (module had zero test coverage before this) covers `mapLimit`'s concurrency bound directly (order-preservation, exact concurrency ceiling, empty input, limit > item count) and `computeAllPluginsDrift`'s key-mapping correctness. Live-verified in tmux: installed a drifted plugin via a local marketplace, confirmed the Installed-tab list badge shows `✔ installed · drifted` without ever opening the plugin's detail; confirmed rapid tab-switching stayed responsive.
- [x] **Immediate fix, not the full restoration** (2026-07-16, superseded by the above): the `useEffect` that unconditionally reset `pluginDriftMap` to `{}` on every mount now skips the reset if the map was already populated when it runs — stops it from clobbering drift data that IS present (tests that seed it directly, or a future on-demand computation), without adding a new computation path itself. Found because it was making 3 e2e tests deterministically fail (`app.e2e.test.tsx`: "plugin with drift shows changed badge in list", "drifted plugin detail shows Changed instance with +/- counts", "keeps plugin drift as a per-tool row instead of a status-line badge") — confirmed pre-existing (reproduces on a clean install of unmodified HEAD), not caused by any work earlier in this session.
- [x] **Fixed (2026-07-17)** — separate, real bug found while building this plan's verification fixture, same class as the `file://` marketplace-detection gap fixed in 0.25.0's `downloadPlugin`, but a different function: `plugin-drift.ts`'s private `resolvePluginSource()` only recognized local marketplace URLs starting with `/`, `~`, `./`, `../` — a `file://` URL (a legitimate, real format; `marketplace.ts`/`path-utils.ts` both handle it explicitly elsewhere) fell through unrecognized, so drift was silently never detected for plugins from a `file://`-registered marketplace. Fixed by extracting `resolveLocalPathRaw` (the `file://`/`~`/relative-path normalization step, without `resolveLocalPath`'s "collapse a file target to its directory" step, which `resolvePluginSource` can't use since it needs to know the raw target *is* a file to decide whether to try alternate filenames) into `path-utils.ts`, shared by both. New tests in `plugin-drift.test.ts` (`resolvePluginSourcePaths` — bare path, `file://` URL to a directory, `file://` URL directly at `marketplace.json`, unknown plugin, remote URL) and `path-utils.test.ts` (`resolveLocalPathRaw`).

### Fixed: CI/release workflows still referenced pnpm (2026-07-17)
- [x] `.github/workflows/ci.yml` and `release.yml` still used `pnpm/action-setup` + `cache-dependency-path: tui/pnpm-lock.yaml` from before `tui/` moved to bun in May 2026 (`b13dedd`) — that lockfile doesn't exist anymore, so CI was resolving dependencies through a stale/incorrect toolchain reference rather than the one actually used and tested locally. Both now use `oven-sh/setup-bun` + `bun install`/`bun run <script>`. `release.yml` keeps `actions/setup-node` alongside bun: `npm publish --provenance` specifically needs npm's own `registry-url`/OIDC setup for provenance, which bun's publish flow doesn't provide — install/build still go through bun, only the final `npm publish` step needs node/npm. Verified locally that `bun run typecheck`/`bun run test`/`bun run build` (the exact commands the workflow now runs) all work correctly — `bun run test` correctly delegates to the `vitest run` script (not bun's own test runner).

### Fixed: obsolete Ink patch removed (2026-07-16)
- [x] `tui/scripts/patch-ink.mjs` (and its `postinstall`/`predev`/`prebuild`/`prestart` hooks) removed — its target string no longer matches Ink 7.0.4's rewritten `log-update.js`, so it was silently no-op-ing (`[patch-ink] ... target not found, skipping`) on every fresh install. Live-verified in tmux (small 80×20 pane, tall detail view, Esc) that current Ink already fixes the original bug natively via `this.log.sync(outputToRender)` in `renderInteractiveFrame` — functionally the same fix the local patch used to bolt on by hand. See CHANGELOG.

## E2E driven-UX audit (2026-07-16)

Full end-to-end pass driving the real built binary via tmux against a mocked sandbox (temp HOME, git source repo, config, tool dirs, `.agents` workspaces, projects, profiles) — every interaction navigated by hand through the actual UX, no unit tests. First pass covered the core drift state machine + `.agents` layer and found real bugs; fixed all of them below. A second, wider parallel-agent matrix scrub follows to push into the hundreds-of-combinations territory (unhappy paths, modal edge cases, cross-tab round-trips).

### Bugs found and fixed
- [x] **Esc double-closes a diff/missing-summary AND its underlying detail** (real bug) — opening a diff from within a file/plugin/skill detail, then pressing Esc once, closed BOTH the diff and the detail underneath, dumping the user on the tab list instead of back on the detail. Root cause: `diff`/`missingSummary` overlay-registry entries (`App.tsx`) had no `escClose`, so `handleEscape`'s `.find(e => e.active && e.escClose)` walked past them to the next entry that had one — `itemDetail` — closing it too, in the same keypress as the diff's own internal self-close (`DiffView`/`MissingSummaryView` already correctly self-handle Esc via their own `useInput`). Fix: no-op `escClose` on both entries so the walk stops there, deferring 100% to the component. Verified live for both `diff` and `missingSummary` paths (one Esc → back to detail; second Esc → back to list).
- [x] **Default tab regressed from Sync to Installed** (real regression) — git-archaeology: `cd8d0bc` ("v0.12.0 — sync-first tab order") deliberately made Sync the default and updated the README; a much later, unrelated commit (`6351926`, "settings scaffolding...") silently flipped it to `"installed"` as an incidental line with no mention in the commit message and no README update. Restored `tab: "sync"` in `ui-slice.ts`, matching the still-current README claim.
- [x] **Settings tab's own `R` (repo-status force-refresh) was dead code** — the global App-level `R` handler (`git pull` + `refreshAll()`) intercepted `R` on every tab, including Settings, before `SettingsPanel`'s own more-specific handler (`refreshRepoStatus({force:true, fetchRemote:true})`, with "Refreshing.../✔ Refreshed" messages) could ever run. Since the Settings repo-status widget (ahead/behind, changed files) is local component state only refreshed on mount, this left it stale after the global pull. Fixed by exempting the Settings tab from the global `R` interception; Settings already has an explicit, confirm-gated pull/reset menu action for actually mutating the repo, so this isn't a capability loss. Verified: "✔ Refreshed" now appears; global `R` confirmed unaffected on other tabs.
- [x] Stale hint text: item-detail hint said "ctrl+p to navigate" when nav is ↑/↓ (`HintBar.tsx`). Fixed.
- [x] Stale comment: "Number keys 1-6" when there are 7 tabs (`App.tsx`). Fixed.
- [~] **Investigated, NOT a bug**: a gated both-changed file appeared to vanish from the Sync list immediately after syncing its other instances, only reappearing after manual `R`. Re-driven with a minimal isolated fixture and per-second captures with no manual refresh — the conflicted item was correctly visible in the Sync list at every single step; the original "disappearance" was a false positive from my own tmux capture window being too short (cut off above the row once a `Tool binary updates` section pushed content down). No code change; confirmed via git history archaeology + clean re-repro, not just assumption.

### Matrix scrub (in progress)
Dispatching parallel agents, each with an independent sandbox + tmux session, to drive a full slice of the interaction surface (per the exhaustive checklist produced during this audit): Sync drift matrix × selection combos, Tools + all modals, Discover + Installed (including the flagged index-math fragility), Marketplaces + Projects (full skill-status × action matrix, adopt, profiles), Settings + global-key cross-cutting (overlay suppression, sticky-notification key-eating, arm/disarm timing). Findings to be triaged and fixed, then re-verified.

## Matrix scrub — 5 parallel agents, ~885 tool-calls, 12 bugs found + fixed (2026-07-16)

Dispatched 5 read-only driven-UX agents in parallel, each in its own isolated sandbox + tmux session (built and drove the real binary — no unit tests), covering: Sync tab drift matrix, Tools tab + all modals, Discover + Installed tabs, Marketplaces + Projects (the biggest slice), Settings + cross-cutting global keys. Every finding below was independently re-verified live (not just typechecked) against a fresh fixture before being marked fixed.

### Bugs found and fixed
- [x] **Silent escalation to unconfirmed "Delete everywhere"** (most severe) — `actionIndex` (App.tsx) was never reclamped after a mutating detail action rebuilt the action list with a different shape/order. Repro: skill installed on 2 tools → detail → navigate to "Uninstall from all tools" (index 6 of 10) → Enter → list rebuilds to 7 rows where index 6 is now "🗑 Delete everywhere" → cursor silently sits there with zero further keypresses, one reflexive Enter away from wiping the source-repo copy too, with no confirm gate. Fix: `handleEntityAction` resets `actionIndex` to 0 before dispatching any action — every action-list builder places bulk/destructive actions after per-instance status rows, so index 0 is always safe. Verified live: cursor lands on "Sync to all N missing tools" after the same repro, not Delete-everywhere.
- [x] **`q` quits the entire app while a detail overlay (item/diff/tool detail) is open** — digit-switch and `/`-focus were already gated on `!isOverlayOpen`; `q` wasn't. Gated it too (kept `R` un-gated — that's pre-existing, documented intentional behavior). Verified: `q` inert with a detail open, still quits normally otherwise.
- [x] **Skills had NO conflict protection on sync** (real data-safety gap, same class as the untracked-target work earlier this session, but for skills) — `syncTools`'s skill branch force-overwrote ANY drifted installation, files already exclude target/both-changed instances but skills never got equivalent treatment (skills only have a binary source!=disk comparison, no three-way state, so "which side changed" can't be known). Fixed by only auto-syncing MISSING skill instances in the bulk path; a drifted instance stays visible in the Sync list but requires the skill's own detail action ("Re-sync... (overwrites disk)") to resolve deliberately. Verified live: a local edit on a drifted skill survived a `y`,`y` bulk sync untouched.
- [x] **Skill drift direction label ("source"/"disk") was frequently wrong** — computed once from the WHOLE source directory's git status, not per-instance; a stale uncommitted diff from an earlier edit kept claiming "(source)" after a brand-new disk-only edit. Since skills have no baseline to compute this accurately, removed the misleading claim entirely rather than guess — "Drifted on X" with no parenthetical.
- [x] **Skill whose source directory was deleted entirely vanished from the Sync tab** (files correctly surface the equivalent case as "Target drifted"; skills used a `continue` that skipped any skill with no source match). Fixed `buildSkillSyncPreview` to surface it as drift instead of silently dropping it — the one tab whose whole purpose is "everything needing attention" no longer has this blind spot. Verified live.
- [x] **Diff view falsely said "No differences found - files are in sync"** when the source had been deleted (target still exists with real content) — `buildFileDiffTarget`'s non-glob early-return gave up with `files: []` before ever checking the target. Fixed to report it as an "extra" (target-only) file via the same `buildFileSummary` path already used elsewhere, rendering a real diff (whole content as additions) instead of a false "in sync". Verified live.
- [x] **Skill diff title duplicated the instance name** ("skill-gamma · OpenCode · OpenCode") — `buildSkillDiffTarget` baked the instance name into its title while `DiffDetail` unconditionally appends it too (files/plugins don't hit this since their titles are bare names). Fixed to match the established pattern.
- [x] **Trailing-slash path created a duplicate registered project** — `addProject`'s dedupe compares `expandPath(p.path)`, and `expandPath` didn't normalize trailing separators, so `/proj` and `/proj/` compared unequal. Fixed in `expandPath` itself (benefits every consumer: source_repo, tool config_dir, project paths). Verified live: re-registering with a trailing slash now correctly rejects as "already registered".
- [x] **Esc from a drilled-into project always reset the list to index 0 (Global)** instead of the project just backed out of — a hardcoded `setSelectedIndex(0)`. Fixed to look up the drilled-from project's index and land there. Verified live across projA/projB/projC.
- [x] **Tool Detail's hint bar showed the generic itemDetail hint, never the dedicated tools-specific one** — `toolsHint` (which already has its own correct `detailTool` branch, including a migrate-checkbox variant) was checked AFTER the generic `hasDetail` hint in `HintBar`, so it could never win while any detail overlay (including Tool Detail itself) was open. Reordered the check. Verified live: Tool Detail now shows `i Install · u Update · d Uninstall · e Edit · Space Toggle · R Refresh · Esc Back`.
- [x] **Config-only tools (e.g. "Blackbook" itself) incorrectly offered "i Install"**, opening a modal that always failed with "Unknown tool". `handleToolShortcut`'s `i` gate treated "no detection entry" the same as "not installed"; `ToolsList`/`ToolDetail` already correctly special-case config-only tools via `!(toolId in TOOL_REGISTRY)` but the shortcut layer and hint text didn't. Fixed both. Verified live: hint no longer mentions Install, `i` is a true no-op.
- [x] **Natively-installed tools (e.g. Claude via the curl script) could never be uninstalled, with no advance warning** — the uninstall command always resolves to a generic package-manager command when no native uninstall/brew-formula match exists, guaranteed to fail for a tool that was never installed that way, and — unlike install/update — the mismatch-detection effect explicitly skipped the uninstall action. Added `detectUninstallMismatch` (distinct from the install/update mismatch check — no "migrate" concept applies) and wired it in; `ToolActionModal` now suppresses the irrelevant migrate-checkbox line for uninstall warnings. Verified live on the real machine's actual Claude install: modal now shows "Claude does not appear to be installed via a package manager blackbook can uninstall (install method: native installer). This will likely fail — you may need to remove it manually." — cancelled without confirming (real system binary).
- [x] **Settings' `backup_retention` field silently no-op'd on invalid input** (empty/0/500) — Enter appeared to do nothing, no message, field stayed in edit mode with the invalid text. Reused the panel's existing `actionMessage` mechanism (same one used for every other outcome in this file) to show `⚠ Must be a number between 1 and 100`, staying in edit mode so the user can correct it. Verified live: message shows, Esc-cancel correctly reverts to the prior value, invalid value never persisted.

### Investigated, decided NOT a bug
- `R` refreshing tab data while a detail overlay is open — this is pre-existing, explicitly documented intentional behavior (unlike `q`, which is destructive/irreversible in a way a background refresh is not).

Full suite green throughout: 696 pass excluding `marketplace.test.ts` (same lone pre-existing unrelated `updatePlugin` failure) + `path.test.ts` regression coverage for the trailing-slash fix. `marketplace.test.ts` intermittently fails in this environment due to real network calls to GitHub (confirmed via direct `curl` — no connectivity at all at the time); reproduces identically with all these changes stashed, so it's pre-existing and unrelated. Every fix above was verified against the running app in tmux, not just typechecked, including two live-uninstall-mismatch checks against real installed tools on this machine (cancelled before confirming, to avoid any real mutation).

### Follow-up: cross-checked the consolidated fix list against all 5 raw agent reports
Found two Discover/Installed findings that weren't in the fix pass above:
- [x] **Discover sub-view range label hardcoded `maxHeight=12`**, diverging from the actual rendered `ItemList` height (`Math.max(4, contentHeight - 9)`), so the "(showing X-Y of N)" label was wrong on any terminal taller than ~21 rows — actively misleading about scroll position. Fixed by factoring both into one `listMaxHeight` local. Verified live at 2500 real Pi packages: "showing 9-41" exactly matched the 33 rendered rows.
- Re-examined the "Escape-then-Enter opens a different item than highlighted" observation and concluded it is **not a bug**: `setSearch` already resets `selectedIndex` to 0 on every search change (including a clear), consistently and deterministically — unlike the actionIndex bug (an unbounded stale numeric position landing on an arbitrary, possibly-destructive row), this always lands on a safe, visible index 0. It's a UX expectation mismatch (clearing a search doesn't keep your place), not a defect. The agent itself labeled it an observation, not a bug; left as-is rather than force a behavior change for something that isn't broken.
