---
date: 2026-05-02
status: active
origin: docs/brainstorms/2026-05-02-local-skill-lifecycle-utility-requirements.md
---

# Local Skill Lifecycle Utility — Implementation Plan

## Problem Frame

Current behavior does not provide a reliable, low-friction lifecycle for locally created skills across playbook and tool instances. The implementation must prioritize a utility-like workflow that supports bidirectional sync, explicit review before apply, and confirmation-gated removals while preserving tabbed home and existing feature scope.

## Scope & Traceability

This plan implements requirements R1-R11 from `docs/brainstorms/2026-05-02-local-skill-lifecycle-utility-requirements.md`.

## Implementation Strategy

1. Introduce a dedicated **local-skill lifecycle workflow** that unifies scan/review/apply/pullback/remove flows.
2. Reuse existing sync/check/apply modules where possible; normalize behavior at orchestration and UI flow level.
3. Add explicit removal planning and confirmation gate (no silent deletion).
4. Keep existing tabs/features, but make lifecycle actions deterministic and first-class.

## Phases

### Phase 1 — Define lifecycle domain model and plan builder

**Goal:** Create one internal representation for lifecycle changes across adapters.

- Add a lifecycle change model (add/update/remove/conflict/pullback candidate).
- Build a lifecycle plan generator that computes proposed actions from both sides (playbook + tool instances).
- Normalize adapter outputs into the shared model.
- Ensure plan generation is explicit/manual (no background mutation).

**Primary files:**
- `tui/src/lib/types.ts`
- `tui/src/lib/store.ts`
- `tui/src/lib/modules/orchestrator.ts`
- `tui/src/lib/item-drift.ts`
- `tui/src/lib/plugin-drift.ts`

**Tests:**
- `tui/src/lib/item-drift.test.ts`
- `tui/src/lib/modules/plugin-install.test.ts`
- new: `tui/src/lib/lifecycle-plan.test.ts`

### Phase 2 — Local-skill lifecycle UX in existing tabbed shell

**Goal:** Expose one predictable lifecycle workflow without removing tabbed navigation.

- Add lifecycle-focused review panel/list in existing Installed/Sync workflow surface.
- Show grouped changes: add/update/remove/conflict/pullback.
- Ensure all actions run from explicit user input (no hidden auto-apply behavior).
- Keep current tabs intact; lifecycle flow becomes the primary path for skill management.

**Primary files:**
- `tui/src/App.tsx`
- `tui/src/tabs/InstalledTab.tsx`
- `tui/src/tabs/SyncTab.tsx`
- `tui/src/components/SyncList.tsx`
- `tui/src/components/SyncPreview.tsx`
- new: `tui/src/components/LifecyclePlanView.tsx`

**Tests:**
- `tui/src/app.e2e.test.tsx`
- new: `tui/src/components/LifecyclePlanView.test.tsx`

### Phase 3 — Confirmation-gated removal workflow

**Goal:** Make removal safe, explicit, and predictable.

- Add explicit “planned removals” state and confirmation modal/step.
- Require confirm before any remove/prune apply.
- Present exact target list per removal action.
- Keep deletion disabled unless confirmation is active.

**Primary files:**
- `tui/src/App.tsx`
- `tui/src/lib/action-dispatch.ts`
- `tui/src/lib/store.ts`
- `tui/src/components/ItemDetail.tsx`
- `tui/src/components/DiffView.tsx`

**Tests:**
- `tui/src/lib/action-dispatch.test.ts`
- `tui/src/app.e2e.test.tsx`
- new: `tui/src/lib/removal-confirmation.test.ts`

### Phase 4 — Bidirectional pullback hardening

**Goal:** Ensure pullback is first-class and consistent across adapters.

- Standardize pullback semantics in lifecycle plan and apply path.
- Distinguish conflict vs safe pullback candidates clearly.
- Ensure per-instance outcomes are visible and recoverable.

**Primary files:**
- `tui/src/lib/modules/file-copy.ts`
- `tui/src/lib/modules/glob-copy.ts`
- `tui/src/lib/install.ts`
- `tui/src/lib/plugin-status.ts`

**Tests:**
- `tui/src/lib/modules/file-copy.test.ts`
- `tui/src/lib/install.integration.test.ts`
- new: `tui/src/lib/pullback-lifecycle.integration.test.ts`

### Phase 5 — Adapter consistency and regression coverage

**Goal:** Keep all current adapters in scope with normalized lifecycle behavior.

- Add adapter-level conformance checks against shared lifecycle model.
- Ensure lifecycle statuses/actions are consistent across supported tools.
- Validate no regression in existing non-lifecycle feature surfaces.

**Primary files:**
- `tui/src/lib/tool-registry.ts`
- `tui/src/lib/tool-view.ts`
- `tui/src/lib/plugin-status.ts`

**Tests:**
- `tui/src/lib/tool-registry.test.ts`
- `tui/src/lib/tool-view.test.ts`
- `tui/src/app.e2e.test.tsx`

## Acceptance Mapping

- R1-R3: Phases 1, 2, 4
- R4-R6: Phases 2, 3
- R7-R9: Phase 3
- R10-R11: Phase 5

## Risks & Mitigations

- **Risk:** Behavior divergence across adapters.
  - **Mitigation:** Shared lifecycle model + adapter conformance tests.
- **Risk:** Removal safety regressions.
  - **Mitigation:** Mandatory confirmation gate + targeted E2E tests.
- **Risk:** UX complexity creeps back in.
  - **Mitigation:** Keep lifecycle flow explicit and central; avoid new background automation.

## Quality Gates

- `cd tui && pnpm typecheck`
- `cd tui && pnpm test`
- `cd tui && pnpm build`

## Execution Posture

- Implement in small vertical slices (plan compute → UI render → confirm/apply).
- Validate each phase with focused tests before moving forward.

## Next Step

Proceed with `/ce-work` against this plan, starting at Phase 1.
