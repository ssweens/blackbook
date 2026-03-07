# TODO

## Current
- [x] Prevent "Pull latest" action from running when source repo has pending local changes.
- [x] Show explicit upstream state in Settings Source Repo section.
- [x] Add/update tests for upstream state and pull guard behavior.
- [x] Run quality gates (tests, typecheck, build).

## Completed
- [x] Reproduce why Installed -> "Install to Pi" reports success but does not place skill files.
- [x] Fix plugin sync path handling for standalone installed components (e.g., Claude-scanned local skills).
- [x] Fix per-tool install notifications to reflect actual sync result/errors.
- [x] Add regression test coverage for standalone-source sync behavior.
- [x] Run quality gates (tests, typecheck, build) and document results.

## Review
- Investigated code paths used by Installed tab per-tool action.
- Found two root causes:
  1. `syncPluginInstances` assumed a package-root layout (`skills/`, `commands/`, `agents/`) and could not sync standalone component sources.
  2. `App.tsx` per-tool install action always reported success and ignored sync result.
- Implemented standalone-source fallback staging in `syncPluginInstances` so Installed-tab local/standalone components can sync to Pi.
- Updated per-tool install notification logic in `App.tsx` to show success only when items were actually linked.
- Added regression test: `src/lib/install.integration.test.ts` (`syncPluginInstances` standalone source case).
- Quality gates run:
  - `cd tui && pnpm test` ✅ (321 tests)
  - `cd tui && pnpm typecheck` ✅
  - `cd tui && pnpm build` ✅
- Settings tab: Source Repo actions now always include **Pull latest** when a source repo is a git repo, even with local pending changes.
- Added tests in `src/components/SettingsPanel.test.ts` to verify Pull action visibility in both clean and dirty repo states.
- Re-ran quality gates after Settings changes:
  - `cd tui && pnpm test` ✅ (323 tests)
  - `cd tui && pnpm typecheck` ✅
  - `cd tui && pnpm build` ✅
- Updated Settings Source Repo behavior:
  - Pull action is now guarded when local changes exist (shows actionable error message).
  - Source Repo header now shows explicit upstream state: up to date / ahead / behind / diverged / no upstream.
- Added unit tests for upstream state label logic in `src/components/SettingsPanel.test.ts`.
- Re-ran quality gates after upstream-state/pull-guard update:
  - `cd tui && pnpm test` ✅ (326 tests)
  - `cd tui && pnpm typecheck` ✅
  - `cd tui && pnpm build` ✅
