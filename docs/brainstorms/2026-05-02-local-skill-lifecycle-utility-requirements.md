---
date: 2026-05-02
topic: local-skill-lifecycle-utility
---

# Local Skill Lifecycle Utility (TUI-First) Requirements

## Problem Frame

Blackbook currently feels heavy for daily operations and does not provide a reliable, simple lifecycle for locally created skills that must stay in sync between a playbook repo and multiple tool instances. Users need a utility-like experience that makes create/update/sync/remove predictable without constant maintenance overhead.

---

## Actors

- A1. Operator: Maintains local skills and config artifacts across playbook and tool instances.
- A2. Tool Instance: Destination/source environment for synced skills and related files.

---

## Key Flows

- F1. Local skill update and distribute
  - **Trigger:** Operator updates a local skill and wants to propagate it.
  - **Actors:** A1, A2
  - **Steps:** Operator opens app, reviews detected changes, selects targets, confirms apply, verifies synced state.
  - **Outcome:** Skill is in-sync across selected instances and playbook source.
  - **Covered by:** R1, R2, R4, R6

- F2. Pull back tool-side edits to source
  - **Trigger:** Operator made edits in a tool instance and wants source updated.
  - **Actors:** A1, A2
  - **Steps:** Operator reviews drift, selects pullback action, confirms, and re-checks status.
  - **Outcome:** Source reflects accepted tool-side changes with clear auditability.
  - **Covered by:** R3, R5, R6

- F3. Remove obsolete skill/file safely
  - **Trigger:** Operator no longer wants a skill/file managed.
  - **Actors:** A1, A2
  - **Steps:** Operator marks removal, reviews explicit removal plan, confirms, and applies.
  - **Outcome:** Item is removed only from approved targets; no silent deletes.
  - **Covered by:** R7, R8, R9

---

## Requirements

**Core lifecycle behavior**
- R1. The product must treat local-skill lifecycle management as a first-class workflow (create/update/sync/remove), not a secondary or hidden flow.
- R2. The product must support bidirectional sync as a primary mode (playbook to tools and tools to playbook).
- R3. Pullback from tool instances to source must be available from the same lifecycle workflow context.

**UX simplicity and navigation**
- R4. The primary user experience must remain TUI-first and utility-oriented, with low-friction daily operation.
- R5. The tabbed home navigation model must remain available as the main navigation structure.
- R6. Operators must be able to review pending changes before applying them.

**Safe removals and change control**
- R7. Any removal action (skills/files no longer wanted) must require explicit user confirmation before apply.
- R8. Removal confirmation must clearly show what will be removed and from which targets.
- R9. No automatic silent deletion is allowed during normal sync operations.

**Scope retention**
- R10. Existing major feature surfaces remain in product scope (not removed for v1), while lifecycle workflows are prioritized for redesign first.
- R11. Lifecycle workflows must support all currently supported adapters in scope.

---

## Acceptance Examples

- AE1. **Covers R2, R6.** Given a skill changed in source, when the operator runs sync review, the app shows affected instances and only applies after explicit confirmation.
- AE2. **Covers R3, R5.** Given drift from tool-side edits, when the operator uses pullback from the tabbed workflow, source updates only after confirmation.
- AE3. **Covers R7, R8, R9.** Given an obsolete skill/file, when removal is requested, the app shows an explicit removal plan and does not delete anything unless confirmed.

---

## Success Criteria

- Operators can reliably run local-skill lifecycle tasks (sync, pullback, remove) without workaround steps or hidden behavior.
- Downstream planning can proceed without inventing product behavior for lifecycle, confirmation semantics, or scope boundaries.

---

## Scope Boundaries

- Lifecycle redesign is prioritized before broad expansion of new feature areas.
- Existing major feature areas are retained but are not the first redesign target.
- This effort does not require changing the primary tabbed-home interaction model.

---

## Key Decisions

- Keep tabbed home as primary navigation: preserves familiar entry points while redesign focuses on workflow quality.
- Keep current features in scope: simplification is behavioral/flow-oriented, not feature deletion.
- Prioritize local-skill lifecycle first: highest user pain and highest leverage.
- Require explicit removal confirmation: safety and predictability over automation.
- Bidirectional sync is first-class: avoids one-way-only limitations.

---

## Dependencies / Assumptions

- Assumes all currently supported adapters remain available for lifecycle operations.
- Assumes users operate with a playbook repo as a durable source context.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R6, R8][Technical] What is the minimal review/confirmation interaction that remains fast while still explicit?
- [Affects R11][Needs research] Where adapter behaviors diverge today, what normalization is required to keep lifecycle UX consistent?

---

## Next Steps

-> /ce-plan for structured implementation planning
