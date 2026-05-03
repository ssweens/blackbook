---
date: 2026-05-02
status: active
supersedes: docs/plans/2026-05-02-002-local-skill-lifecycle-implementation-plan.md
origin: docs/brainstorms/2026-05-02-local-skill-lifecycle-utility-requirements.md
---

# Playbook-Centric Rearchitecture — Master Plan

## Problem Frame

The current app is organized by concept (Marketplaces, Tools, Discover, Installed, Sync, Settings) and treats tools as interchangeable resource buckets. Reality is the opposite: **the playbook is the center**, and **each tool is a first-class adapter** with its own native concepts (Claude plugins/MCP, Pi packages, etc.) plus a shared common spine (skills, commands, agents, AGENTS.md). Until the substrate matches that reality, no UI rebuild fixes the disorganization.

This plan rebuilds the substrate first, then the UI.

## Mental Model (locked)

```
       [ Marketplaces ]                ← upstream subscriptions
              │
              ▼
       ┌──────────────┐
       │   PLAYBOOK   │  ← single source of truth (git repo)
       └──────────────┘
        ▲           │
        │           ▼
   [Other machines] [Local tool instances]
   (via git push/pull) (via tool-native adapters)
```

- Playbook = the user's canonical config, organized by tool affinity (`shared/` + `tools/<tool>/`).
- Each tool adapter knows its native concepts and maps the common spine.
- Cross-machine consistency comes from git on the playbook, not from machine-to-machine talk.
- Operations are explicit, confirmation-gated, and never silent.

## Phases (Sequenced)

### Phase 1 — Tool Artifact Inventory

**Goal:** Document every artifact each supported tool exposes, their semantics, disk layout, and version-sensitive details. Output is the reference doc that all later design depends on.

**Tools in scope:** Claude Code, OpenCode, Codex, Amp Code, Pi.

**Per-tool deliverables:**
- Identity (binary, package, version detection)
- Config dir(s) (default, per-instance variation)
- Common spine support (skills, commands, agents, AGENTS.md, MCP)
- Tool-specific concepts (e.g., Claude plugins, Pi packages)
- Disk layout (with concrete examples)
- Tool-managed vs user-managed files
- Versioning quirks and known gotchas
- Open questions / research needs

**Output:** `docs/architecture/tool-inventory.md`

**Exit criteria:**
- Every supported tool has a complete inventory entry
- Common spine vs tool-specific is explicit
- Each open question is named (no hand-waving)

---

### Phase 2 — Playbook Schema Design

**Goal:** Define the playbook structure that hosts all artifacts from the inventory.

**Deliverables:**
- Directory layout (`playbook/`, `shared/`, `tools/<tool>/`, `machines/`)
- Manifest format (`playbook.yaml`, per-tool `tool.yaml`)
- Composition rules (sharing semantics, override semantics, opt-in vs default)
- Marketplace integration (where pulled content lands, how it's tracked)
- Versioning model (git sha vs per-resource pinning vs hybrid)
- Conflict / drift state semantics across the model

**Substrate questions to resolve here:**
1. Composition: copy-on-sync vs compose-at-sync (esp. AGENTS.md fragments)
2. Sharing: `shared/` goes everywhere automatically vs per-tool opt-in
3. Override: tool-specific replaces or extends shared content
4. Machine overrides: v1 or v2
5. Marketplace landing: `shared/` vs `tools/<tool>/`
6. Versioning: git sha vs per-resource pin

**Output:** `docs/architecture/playbook-schema.md` + JSON/YAML schema files in repo

**Exit criteria:**
- Schema validates against representative example playbooks
- All six substrate questions resolved with rationale
- Any deferred decisions explicitly listed with v2 markers

---

### Phase 3 — Migration Design

**Goal:** Existing setups keep working. New setups can scaffold cleanly.

**Deliverables:**
- Old → new playbook structure migration (deterministic, reversible)
- Backward compat with `.claude-plugin/marketplace.json`
- Reverse scaffolding: build a playbook from a working machine's current tool state
- User-facing migration UX (one command, with diff preview before any disk change)

**Output:** `docs/architecture/migration-plan.md`

**Exit criteria:**
- Migration produces no data loss
- Reverse scaffolding produces a valid playbook from a populated machine
- Compatibility matrix documented (which old structures are auto-migrated, which require manual steps)

---

### Phase 4 — Engine Rebuild

**Goal:** Implement the substrate. New core operates on the playbook model; per-tool adapters conform to it.

**Deliverables:**
- Playbook model loader/writer
- Per-tool adapters (Claude, OpenCode, Codex, Amp, Pi) implementing a uniform contract for: read-state, plan-changes, apply-changes, pullback
- Bidirectional sync engine with explicit plan generation
- Confirmation-gated mutation paths (no silent deletion anywhere)
- Removal planner with explicit target-list enumeration
- State ledger for reliable drift detection

**Primary code areas:**
- `tui/src/lib/playbook/` (new — model, loader, validation)
- `tui/src/lib/adapters/<tool>/` (refactored from current `tool-*.ts`, `plugin-*.ts`, `modules/`)
- `tui/src/lib/sync/` (new — plan + apply engine)
- `tui/src/lib/migration/` (new)

**Tests:**
- Adapter conformance tests per tool
- End-to-end sync round-trip tests
- Migration tests with fixtures
- Confirmation-gate enforcement tests

**Exit criteria:**
- Every adapter passes the same conformance suite
- No mutation path can run without an explicit confirmation token
- All current tests pass; new tests cover the substrate

---

### Phase 5 — UI Rebuild

**Goal:** Thin TUI layer over the playbook model. 4 tabs total.

**Tabs:**
- **Dashboard** — cross-tool drift overview, primary daily-driver
- **Playbook** — composition view + git status
- **Sources** — marketplaces and central repo connections
- **Settings** — adapter setup, package manager, defaults

**Per-tool drill-in views:** tool-native — Claude shows plugins/MCP, Pi shows pi-packages, etc. Common spine (skills/commands/agents/AGENTS.md) shares UI but is rendered per-tool.

**Removed:** Discover/Installed split, separate Sync tab, separate Tools tab. All flows merge into Dashboard + drill-ins.

**Exit criteria:**
- All real-world workflows from the brainstorm complete in 4 tabs
- No tab cross-talk required for any single user task
- Removal flows always confirmation-gated
- Performance budget honored (no startup auto-loads, manual refresh)

---

## Sequencing Rationale

- Phase 1 unblocks Phase 2 (you can't design a schema without knowing the artifacts).
- Phase 2 unblocks Phase 3 (migration needs a target schema).
- Phases 1-3 are document-only. No code changes. Cheap to revise.
- Phase 4 starts when 1-3 are stable. Engine first, UI second prevents UI churn from substrate changes.
- Phase 5 ships the experience.

## Quality Gates (per phase)

- Phase 1-3: doc review + open question audit
- Phase 4: typecheck, full test suite, adapter conformance suite
- Phase 5: typecheck, full test suite, e2e tests, manual TUI walkthrough on real config

## Risks & Mitigations

- **Risk:** Inventory misses a tool-specific concept that breaks Phase 2.
  - **Mitigation:** Phase 1 explicitly enumerates open questions; Phase 2 can revisit Phase 1 if gaps surface.
- **Risk:** Schema design picks wrong composition model.
  - **Mitigation:** Phase 2 validates schema against representative example playbooks before locking.
- **Risk:** Migration silently corrupts existing setups.
  - **Mitigation:** Migration is dry-run by default with explicit diff preview; reverse-scaffolding always available as escape hatch.
- **Risk:** Engine refactor regresses current behavior before UI catches up.
  - **Mitigation:** Adapter conformance suite enforces parity; old code paths kept until new paths are validated.

## Out of Scope (v1)

- Remote machine direct communication (cross-machine stays git-mediated)
- Plugin authoring/publishing tools
- New tool adapters beyond the five currently supported
- Any feature not directly serving the playbook↔tool sync core loop

## Status

- Phase 1: in progress (inventory started — `docs/architecture/tool-inventory.md`)
- Phase 2-5: pending Phase 1 completion

## Next Step

Complete Phase 1 inventory, then schedule Phase 2 schema design review.
