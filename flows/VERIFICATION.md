# Verification
## Active delta — Configurable advisory runtime and model (2026-08-11)
Mode: EXTEND | Tier: flow | Flagship: yes
Flow: "Configure the advisory runtime once, then receive bounded recommendations from Projects, Profiles, and installed plugin detail" (consultation budget remains: 1 shortcut + 1 question / 0 automatic mutations; Settings budget: 2 explicit field changes).
N+1 rung: 2 (existing Settings rows and consultation overlay) | Delta: replace the fixed Pi runtime with a persisted consultation-runtime selector and optional model field, keeping every consultation label provider-neutral.
Acceptance bar: settings persist; the next consultation invokes exactly the selected enabled/detected CLI with the optional model; the scenario walk passes within the stated budgets and no recommendation bypasses canonical actions.
## Prior verification — Plugin detail action lifecycle (2026-08-10)

## Scenario walk
- The rendered Ink flow selected `Remove from all tools (keeps source repo)`.
- The TUI displayed `Uninstalling test-plugin...` before the deferred uninstall function started.
- The detail stayed available while the uninstall ran.
- After completion, the detail used the current marketplace record.
- The `Install` action replaced `Remove from all tools`.
- The success message stayed visible.

## Console and network
- The flow did not make a network request.
- The full test run had no unhandled promise rejections.
- The existing React `act(...)` warnings remain in the Ink test harness.

## Sweep
- Install, update, uninstall, per-tool, pullback, source-repo, and delete actions use the same busy-state contract.
- A detail-level lock rejects a second mutating action.
- The plugin store also rejects a second action for the same plugin.
- Thrown mutations still reconcile durable state, replace progress with an error, and release both locks.
- Pi package install, update, and uninstall failures also reconcile package and detail state.

## Inventory
- The action list resets to its safe first row before a mutation starts.
- The spinner stays visible through reload and detail reconciliation.
- A successful uninstall keeps the detail open only when a current marketplace record exists.
- A removed plugin does not remain installed because of a stale Claude download cache.

## Regression
- `pnpm exec vitest run src/app.e2e.test.tsx -t "shows uninstall progress immediately"` passed.
- The focused lifecycle regressions passed.
- The full suite passed 850 tests and skipped 10 tests.
- `pnpm typecheck` passed.
- `pnpm build` passed.
