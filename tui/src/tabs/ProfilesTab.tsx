import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { homedir } from "os";
import { join } from "path";
import { ConsultationPanel, type ConsultationPanelState } from "../components/ConsultationPanel.js";
import {
  buildConsultationPrompt,
  buildProfileConsultationSnapshot,
  profileMemberTarget,
  validateConsultationResponse,
  type ConsultationExchange,
} from "../lib/consultation-context.js";
import { runConsultation as invokeConsultation } from "../lib/consultation-runner.js";
import { useStore } from "../lib/store.js";
import { getConfigRepoPath, getConsultationSettings } from "../lib/config.js";
import { indexSourceSkillTree, type SourceSkillNamespace } from "../lib/projects.js";
import { computeWindow, matchesQuery, windowLabel } from "../lib/list-window.js";
import { globalLockEntries } from "../lib/skill-profiles.js";
/**
 * Profiles tab — named skill bundles (config `profiles:`) that can be applied
 * to any workspace. List view for browsing, builder sub-view for creating and
 * editing.
 *
 * The builder shows a namespace-aware tree: each `skills/<ns>/` group is a
 * selectable header (toggling it selects/deselects all its skills) that
 * expands to its individual skills, plus top-level skills. Profiles still
 * store a flat list of bare skill names, so a namespace selection is exactly
 * equivalent to selecting each of its children — applyProfile needs no change.
 */

// The detail overlay replaces this tab while open, unmounting it. Stash the
// in-progress edit draft at module scope so it is restored on remount instead
// of resetting to the profile list.
let stashedEditMode: EditMode | null = null;

type EditMode = {
      kind: "edit";
      original: string | null;
      name: string;
      naming: boolean;
      selected: Set<string>;
      cursor: number;
      expanded: Set<string>;
      /** Name filter; when set, rows are a flat list of matching skills. */
      query: string;
      searching: boolean;
      /** Show only the selected skills, flat. */
      selectedOnly: boolean;
    };

type Mode =
  | { kind: "list" }
  | EditMode
  | { kind: "confirmDelete"; name: string };

/** A flattened, navigable row in the builder tree. */
type TreeRow =
  | { kind: "namespace"; name: string; skills: string[]; expanded: boolean }
  | { kind: "skill"; name: string; depth: 0 | 1; namespace?: string };

interface ProfileConsultation {
  state: ConsultationPanelState;
  selectedProposalIds: string[];
  exchanges: ConsultationExchange[];
}

/** "ssweens/playbook ×47, anthropics/skills ×1" — where a profile's skills come from. */
function profileSources(lock: { skills: Record<string, { source: string }> }): string {
  const counts = new Map<string, number>();
  for (const e of Object.values(lock.skills)) counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([src, n]) => `${src} ×${n}`).join(", ");
}

export interface ProfilesTabProps {
  contentHeight: number;
  /** Open the full skill detail overlay for a skill name (App owns the overlay). */
  onOpenSkillDetail: (name: string) => void;
  /** Open the git detail (diff/pull/push) for a profile's lock file. */
  onOpenLockDetail: (name: string) => void;
}

/**
 * Builder rows. Normally a tree (namespaces expand to their skills); with a
 * query or "selected only", a flat list of matching skills labelled with
 * their namespace, so every match is visible without expanding anything.
 */
export function buildRows(
  namespaces: SourceSkillNamespace[],
  topLevel: string[],
  expanded: Set<string>,
  filter: { query?: string; selectedOnly?: boolean; selected?: ReadonlySet<string> } = {},
): TreeRow[] {
  const rows: TreeRow[] = [];
  const query = filter.query?.trim() ?? "";
  if (query || filter.selectedOnly) {
    const keep = (name: string) => matchesQuery(name, query) && (!filter.selectedOnly || !!filter.selected?.has(name));
    const flat: TreeRow[] = [
      ...namespaces.flatMap((ns) => ns.skills.filter(keep).map((name) => ({ kind: "skill" as const, name, depth: 0 as const, namespace: ns.name }))),
      ...topLevel.filter(keep).map((name) => ({ kind: "skill" as const, name, depth: 0 as const })),
    ];
    return flat.sort((a, b) => a.name.localeCompare(b.name));
  }
  for (const ns of namespaces) {
    const isExpanded = expanded.has(ns.name);
    rows.push({ kind: "namespace", name: ns.name, skills: ns.skills, expanded: isExpanded });
    if (isExpanded) {
      for (const s of ns.skills) rows.push({ kind: "skill", name: s, depth: 1 });
    }
  }
  for (const s of topLevel) rows.push({ kind: "skill", name: s, depth: 0 });
  return rows;
}

export function ProfilesTab({ contentHeight, onOpenSkillDetail, onOpenLockDetail }: ProfilesTabProps) {
  const profiles = useStore((s) => s.profiles);
  const profileLocks = useStore((s) => s.profileLocks);
  const saveProfile = useStore((s) => s.saveProfile);
  const deleteProfile = useStore((s) => s.deleteProfile);
  const tools = useStore((s) => s.tools);
  const toolDetection = useStore((s) => s.toolDetection);

  const [mode, setMode] = useState<Mode>(() => {
    if (stashedEditMode) {
      const restored = stashedEditMode;
      stashedEditMode = null;
      return restored;
    }
    return { kind: "list" };
  });
  const [listIndex, setListIndex] = useState(0);
  const [consultation, setConsultation] = useState<ProfileConsultation | null>(null);
  const consultationAbortRef = useRef<AbortController | null>(null);

  // Tell App's global input handler to stand down while the builder or the
  // delete confirm owns the keyboard (digits/q/etc. must not fire).
  const setProfilesEditing = useStore((s) => s.setProfilesEditing);
  useEffect(() => {
    setProfilesEditing(mode.kind !== "list" || consultation !== null);
    return () => setProfilesEditing(false);
  }, [consultation, mode.kind, setProfilesEditing]);

  const names = useMemo(() => Object.keys(profiles).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })), [profiles]);

  // Source repo + shared store skills grouped into namespaces + top-level.
  // Recomputed when entering the builder (cheap directory scan).
  const tree = useMemo(() => {
    const repo = getConfigRepoPath();
    const repoTree = repo ? indexSourceSkillTree(repo) : { namespaces: [], topLevel: [] };
    const agentsTree = indexSourceSkillTree(join(homedir(), ".agents"));
    // Merge: source repo wins for duplicates, agents fills in the rest.
    const seen = new Set<string>();
    const namespaces: SourceSkillNamespace[] = [];
    const topLevel: string[] = [];
    for (const ns of [...repoTree.namespaces, ...agentsTree.namespaces]) {
      const existing = namespaces.find((n) => n.name === ns.name);
      if (existing) {
        for (const s of ns.skills) { if (!seen.has(s)) { existing.skills.push(s); seen.add(s); } }
      } else {
        const skills = ns.skills.filter((s) => !seen.has(s));
        skills.forEach((s) => seen.add(s));
        if (skills.length > 0) namespaces.push({ name: ns.name, skills });
      }
    }
    for (const s of [...repoTree.topLevel, ...agentsTree.topLevel]) {
      if (!seen.has(s)) { topLevel.push(s); seen.add(s); }
    }
    // Skills known only from a lock entry (another profile, or the global
    // lock) — e.g. anthropics/skills docx — grouped under their source repo.
    const bySource = new Map<string, string[]>();
    const lockEntries = [...Object.values(profileLocks).flatMap((l) => Object.entries(l.skills)), ...Object.entries(globalLockEntries())];
    for (const [name, entry] of lockEntries) {
      if (seen.has(name)) continue;
      seen.add(name);
      bySource.set(entry.source, [...(bySource.get(entry.source) ?? []), name]);
    }
    for (const [source, skills] of bySource) namespaces.push({ name: source, skills });
    // A folder holding one skill of the same name (skills/big-brain/big-brain) is just that skill.
    for (let i = namespaces.length - 1; i >= 0; i--) {
      const ns = namespaces[i];
      if (ns.skills.length === 1 && ns.skills[0] === ns.name) {
        topLevel.push(ns.name);
        namespaces.splice(i, 1);
      }
    }
    namespaces.forEach((ns) => ns.skills.sort());
    namespaces.sort((a, b) => a.name.localeCompare(b.name));
    topLevel.sort();
    return { namespaces, topLevel };
  }, [mode.kind, profileLocks]);

  const totalSkills = useMemo(
    () => tree.namespaces.reduce((n, ns) => n + ns.skills.length, 0) + tree.topLevel.length,
    [tree],
  );

  const knownSkillNames = useMemo(
    () => [...tree.namespaces.flatMap((namespace) => namespace.skills), ...tree.topLevel],
    [tree],
  );

  const rows = useMemo(
    () => (mode.kind === "edit"
      ? buildRows(tree.namespaces, tree.topLevel, mode.expanded, { query: mode.query, selectedOnly: mode.selectedOnly, selected: mode.selected })
      : []),
    [tree, mode],
  );

  const openBuilder = (original: string | null) => {
    setMode({
      kind: "edit",
      original,
      name: original ?? "",
      // Creating: name first. Editing: straight to skill selection.
      naming: original === null,
      selected: new Set(original ? profiles[original] ?? [] : []),
      cursor: 0,
      expanded: new Set(),
      query: "",
      searching: false,
      selectedOnly: false,
    });
  };

  const buildDraftSnapshot = () => {
    if (mode.kind !== "edit") return null;
    const name = mode.name.trim();
    if (!name) return null;
    return buildProfileConsultationSnapshot(
      name,
      { ...profiles, [name]: [...mode.selected] },
      { knownSkills: knownSkillNames },
    );
  };

  const runConsultation = async (
    request: string,
    priorExchanges: readonly ConsultationExchange[],
  ) => {
    const snapshot = buildDraftSnapshot();
    if (!snapshot) return;

    const controller = new AbortController();
    consultationAbortRef.current = controller;
    setConsultation({
      state: { phase: "running", prompt: request },
      selectedProposalIds: [],
      exchanges: [...priorExchanges],
    });

    const { runtime, model } = getConsultationSettings();
    const instance = tools.find((tool) => tool.toolId === runtime && tool.enabled) ?? null;
    const binaryPath = toolDetection[runtime]?.binaryPath ?? null;
    const result = await invokeConsultation({
      runtime,
      instance,
      binaryPath,
      model,
      prompt: buildConsultationPrompt(snapshot, request, priorExchanges),
      signal: controller.signal,
    });
    if (consultationAbortRef.current !== controller) return;
    consultationAbortRef.current = null;
    if (result.ok) {
      const response = validateConsultationResponse(snapshot, result.response);
      if (response) {
        setConsultation({
          state: { phase: "result", prompt: request, response },
          selectedProposalIds: [],
          exchanges: [...priorExchanges, { request, response }],
        });
      } else {
        setConsultation({
          state: { phase: "error", prompt: request, message: "The advisor returned recommendations that no longer match this profile draft." },
          selectedProposalIds: [],
          exchanges: [...priorExchanges],
        });
      }
      return;
    }
    if (result.error.category === "cancelled") {
      setConsultation(null);
      return;
    }
    setConsultation({
      state: { phase: "error", prompt: request, message: result.error.message },
      selectedProposalIds: [],
      exchanges: [...priorExchanges],
    });
  };

  const cancelConsultation = () => {
    consultationAbortRef.current?.abort();
    consultationAbortRef.current = null;
    setConsultation(null);
  };

  const applyConsultationProposals = (proposalIds: string[]) => {
    if (!consultation || consultation.state.phase !== "result" || mode.kind !== "edit") return;
    const snapshot = buildDraftSnapshot();
    const response = snapshot && validateConsultationResponse(snapshot, consultation.state.response);
    if (!snapshot || !response) {
      setConsultation({
        state: {
          phase: "error",
          prompt: consultation.state.prompt,
          message: "The profile draft changed. Ask the advisor again before applying recommendations.",
        },
        selectedProposalIds: [],
        exchanges: consultation.exchanges,
      });
      return;
    }

    const namesByTarget = new Map(
      [...new Set([...knownSkillNames, ...Object.values(profiles).flat(), ...mode.selected])]
        .map((skillName) => [profileMemberTarget(skillName), skillName]),
    );
    const selected = new Set(mode.selected);
    for (const proposal of response.proposals) {
      if (!proposalIds.includes(proposal.id)) continue;
      const skillName = namesByTarget.get(proposal.target);
      if (!skillName) continue;
      if (proposal.operation === "install") selected.add(skillName);
      if (proposal.operation === "remove") selected.delete(skillName);
    }
    setMode({ ...mode, selected });
    setConsultation(null);
  };

  useInput((input, key) => {
    if (consultation) return;

    if (mode.kind === "list") {
      if (key.upArrow) setListIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setListIndex((i) => Math.min(Math.max(0, names.length - 1), i + 1));
      else if (input === "n") openBuilder(null);
      else if (names.length > 0 && (key.return || input === "e")) openBuilder(names[Math.min(listIndex, names.length - 1)]);
      else if (names.length > 0 && input === "g") onOpenLockDetail(names[Math.min(listIndex, names.length - 1)]);
      else if (names.length > 0 && (input === "d" || key.delete)) {
        setMode({ kind: "confirmDelete", name: names[Math.min(listIndex, names.length - 1)] });
      }
      return;
    }

    if (mode.kind === "confirmDelete") {
      if (input === "y" || key.return) {
        void deleteProfile(mode.name);
        setListIndex(0);
        setMode({ kind: "list" });
      } else if (key.escape || input === "n") {
        setMode({ kind: "list" });
      }
      return;
    }
    // Builder. While naming, TextInput owns typed characters — only handle
    // escape here (submit is TextInput's onSubmit).
    if (mode.naming) {
      if (key.escape) setMode({ kind: "list" });
      return;
    }

    // Search box owns typed characters; Enter keeps the filter, Esc clears it.
    if (mode.searching) {
      if (key.escape) setMode({ ...mode, searching: false, query: "", cursor: 0 });
      else if (key.return) setMode({ ...mode, searching: false });
      return;
    }

    if (input === "/") {
      setMode({ ...mode, searching: true, cursor: 0 });
      return;
    }

    if (input === "v") {
      setMode({ ...mode, selectedOnly: !mode.selectedOnly, cursor: 0 });
      return;
    }

    if (input === "c") {
      setConsultation({ state: { phase: "prompt" }, selectedProposalIds: [], exchanges: [] });
      return;
    }

    if (key.escape) {
      // Back out of a filter first, then out of the builder.
      if (mode.query || mode.selectedOnly) setMode({ ...mode, query: "", selectedOnly: false, cursor: 0 });
      else setMode({ kind: "list" });
      return;
    }

    const row = rows[Math.min(mode.cursor, Math.max(0, rows.length - 1))];

    if (key.upArrow) {
      setMode({ ...mode, cursor: Math.max(0, mode.cursor - 1) });
    } else if (key.downArrow) {
      setMode({ ...mode, cursor: Math.min(Math.max(0, rows.length - 1), mode.cursor + 1) });
    } else if ((key.rightArrow || key.leftArrow) && row?.kind === "namespace") {
      // Expand/collapse the namespace under the cursor.
      const expanded = new Set(mode.expanded);
      if (key.rightArrow) expanded.add(row.name);
      else expanded.delete(row.name);
      setMode({ ...mode, expanded });
    } else if (key.pageDown || key.pageUp) {
      const step = Math.max(1, contentHeight - 6);
      const next = key.pageDown ? Math.min(Math.max(0, rows.length - 1), mode.cursor + step) : Math.max(0, mode.cursor - step);
      setMode({ ...mode, cursor: next });
    } else if (input === " " && row) {
      const selected = new Set(mode.selected);
      if (row.kind === "namespace") {
        // Toggle the whole namespace: if every child is selected, clear them
        // all; otherwise select them all.
        const allSelected = row.skills.every((s) => selected.has(s));
        for (const s of row.skills) {
          if (allSelected) selected.delete(s);
          else selected.add(s);
        }
      } else {
        if (selected.has(row.name)) selected.delete(row.name);
        else selected.add(row.name);
      }
      setMode({ ...mode, selected });
    } else if (input === "r") {
      setMode({ ...mode, naming: true });
    } else if (input === "S") {
      // Save moved off Enter so Enter can open the highlighted skill's detail.
      // Keep the source repo's skill order stable in config (sorted).
      void saveProfile(mode.name, [...mode.selected].sort(), mode.original).then((ok) => {
        if (ok && mode.original && mode.original !== mode.name.trim()) {
          // Renamed: drop the old entry.
          void deleteProfile(mode.original);
        }
      });
      setMode({ kind: "list" });
    } else if (key.return) {
      if (row?.kind === "namespace") {
        // Enter on a namespace header expands/collapses it.
        const expanded = new Set(mode.expanded);
        if (expanded.has(row.name)) expanded.delete(row.name);
        else expanded.add(row.name);
        setMode({ ...mode, expanded });
      } else if (row?.kind === "skill") {
        // Enter on a skill opens its detail. Stash the draft so returning from
        // the detail overlay restores the in-progress profile.
        stashedEditMode = mode;
        onOpenSkillDetail(row.name);
      }
    }
  });

  if (consultation) {
    return (
      <ConsultationPanel
        state={consultation.state}
        selectedProposalIds={consultation.selectedProposalIds}
        turnCount={consultation.exchanges.length}
        onSubmit={(request) => { void runConsultation(request, consultation.exchanges); }}
        onContinue={(request) => { void runConsultation(request, consultation.exchanges); }}
        onCancel={cancelConsultation}
        onRetry={() => {
          if (consultation.state.phase === "error") {
            void runConsultation(consultation.state.prompt, consultation.exchanges);
          }
        }}
        onToggleProposal={(proposalId) => {
          setConsultation((current) => {
            if (!current) return current;
            const selectedProposalIds = current.selectedProposalIds.includes(proposalId)
              ? current.selectedProposalIds.filter((id) => id !== proposalId)
              : [...current.selectedProposalIds, proposalId];
            return { ...current, selectedProposalIds };
          });
        }}
        onAccept={applyConsultationProposals}
      />
    );
  }

  if (mode.kind === "confirmDelete") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text>
          Delete profile <Text bold color="red">{mode.name}</Text>? This only removes the bundle definition — no installed skills are touched.
        </Text>
        <Text color="gray">y/Enter delete · n/Esc cancel</Text>
      </Box>
    );
  }

  if (mode.kind === "edit") {
    if (mode.naming) {
      return (
        <Box flexDirection="column" marginY={1}>
          <Text bold>{mode.original ? "Rename profile" : "New profile"}</Text>
          <Box>
            <Text color="cyan">Name: </Text>
            <TextInput
              value={mode.name}
              onChange={(v) => setMode({ ...mode, name: v })}
              onSubmit={(v) => {
                if (v.trim()) setMode({ ...mode, name: v.trim(), naming: false });
              }}
            />
          </Box>
          <Text color="gray">Enter continue · Esc cancel</Text>
        </Box>
      );
    }

    // Title, search line, footer.
    const maxRows = Math.max(1, contentHeight - 4);
    const cursor = Math.min(mode.cursor, Math.max(0, rows.length - 1));
    const start = Math.max(0, Math.min(cursor - Math.floor(maxRows / 2), rows.length - maxRows));
    const visible = rows.slice(start, start + maxRows);
    const position = windowLabel(start, visible.length, rows.length);
    const filtered = !!mode.query.trim() || mode.selectedOnly;
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text bold color="cyan">{mode.name}</Text>
          <Text color="gray">{"  "}{mode.selected.size} of {totalSkills} skills selected{mode.selectedOnly ? " · showing selected only" : ""}</Text>
        </Text>
        <Box>
          <Text color={mode.searching ? "cyan" : "gray"}>{mode.searching ? "● " : "○ "}</Text>
          {mode.searching ? (
            <TextInput
              value={mode.query}
              onChange={(v) => setMode({ ...mode, query: v, cursor: 0 })}
              placeholder="Search all skills..."
            />
          ) : (
            <Text color="gray">{mode.query ? `"${mode.query}" · ${rows.length} match${rows.length === 1 ? "" : "es"}` : "press / to search"}</Text>
          )}
        </Box>
        {rows.length === 0 ? (
          <Text color="gray">{filtered ? "No skills match." : "No skills found in the source repo."}</Text>
        ) : (
          visible.map((row, i) => {
            const idx = start + i;
            const isSel = idx === cursor;
            const marker = isSel ? "❯ " : "  ";
            if (row.kind === "namespace") {
              const selCount = row.skills.filter((s) => mode.selected.has(s)).length;
              const glyph = selCount === 0 ? "○" : selCount === row.skills.length ? "◉" : "◐";
              const glyphColor = selCount === 0 ? "gray" : selCount === row.skills.length ? "green" : "yellow";
              return (
                <Text key={`ns:${row.name}`} wrap="truncate-end">
                  <Text color={isSel ? "cyan" : "gray"}>{marker}</Text>
                  <Text color={glyphColor}>{glyph} </Text>
                  <Text color="blue">{row.expanded ? "▾ " : "▸ "}</Text>
                  <Text bold color={isSel ? "white" : "gray"}>{row.name}</Text>
                  <Text color="gray">{"  "}{selCount}/{row.skills.length}</Text>
                </Text>
              );
            }
            const checked = mode.selected.has(row.name);
            return (
              <Text key={`sk:${row.name}`} wrap="truncate-end">
                <Text color={isSel ? "cyan" : "gray"}>{marker}</Text>
                <Text>{row.depth === 1 ? "  " : ""}</Text>
                <Text color={checked ? "green" : "gray"}>{checked ? "◉ " : "○ "}</Text>
                <Text color={isSel || checked ? "white" : "gray"}>{row.name}</Text>
                {row.namespace ? <Text color="gray">{"  "}{row.namespace}</Text> : null}
              </Text>
            );
          })
        )}
        <Text color="gray" wrap="truncate-end">
          {position ? `${position} · ` : ""}Space toggle · Enter details · S save · Esc {filtered ? "clear filter" : "cancel"} · / search · v {mode.selectedOnly ? "all" : "selected"} · →/← expand · r rename · c consult
        </Text>
      </Box>
    );
  }

  // List view — one line per profile, scrollable.
  const maxRows = Math.max(1, contentHeight - 2);
  const listCursor = Math.min(listIndex, Math.max(0, names.length - 1));
  const { visible: visibleNames, startIndex: listStart } = computeWindow(names, listCursor, maxRows);
  const listPosition = windowLabel(listStart, visibleNames.length, names.length);
  const nameWidth = Math.max(0, ...names.map((n) => n.length));
  const countWidth = Math.max(1, ...names.map((n) => String(profiles[n].length).length));
  return (
    <Box flexDirection="column">
      {names.length === 0 ? (
        <Box marginY={1}>
          <Text color="gray">No profiles yet. A profile is a reusable skills-lock.json fragment (saved to profiles/ in your source repo) you can apply to any project. Press 'n' to create one.</Text>
        </Box>
      ) : (
        visibleNames.map((n, i) => {
          const isSel = listStart + i === listCursor;
          const skills = profiles[n];
          const count = `${String(skills.length).padStart(countWidth)} ${skills.length === 1 ? "skill " : "skills"}`;
          const detail = n in profileLocks ? profileSources(profileLocks[n]) : "legacy (config.yaml) — save to convert";
          return (
            <Text key={n} wrap="truncate-end">
              <Text color={isSel ? "cyan" : "gray"}>{isSel ? "❯ " : "  "}</Text>
              <Text bold={isSel} color={isSel ? "white" : "gray"}>{n.padEnd(nameWidth)}</Text>
              <Text color={isSel ? "white" : "gray"}>{"  "}{count}</Text>
              <Text color="gray">{"  "}{detail}</Text>
            </Text>
          );
        })
      )}
      <Box marginTop={1}>
        <Text color="gray" wrap="truncate-end">
          {listPosition ? `${listPosition} · ` : ""}n new · Enter/e edit · g source repo · d delete{names.length > 0 ? " · apply from a workspace with P" : ""}
        </Text>
      </Box>
    </Box>
  );
}
