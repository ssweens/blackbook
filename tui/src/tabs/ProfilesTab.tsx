import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useStore } from "../lib/store.js";
import { getConfigRepoPath } from "../lib/config.js";
import { indexSourceSkillTree, type SourceSkillNamespace } from "../lib/projects.js";

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

type Mode =
  | { kind: "list" }
  | {
      kind: "edit";
      original: string | null;
      name: string;
      naming: boolean;
      selected: Set<string>;
      cursor: number;
      expanded: Set<string>;
    }
  | { kind: "confirmDelete"; name: string };

/** A flattened, navigable row in the builder tree. */
type TreeRow =
  | { kind: "namespace"; name: string; skills: string[]; expanded: boolean }
  | { kind: "skill"; name: string; depth: 0 | 1 };

export interface ProfilesTabProps {
  contentHeight: number;
}

function buildRows(
  namespaces: SourceSkillNamespace[],
  topLevel: string[],
  expanded: Set<string>,
): TreeRow[] {
  const rows: TreeRow[] = [];
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

export function ProfilesTab({ contentHeight }: ProfilesTabProps) {
  const profiles = useStore((s) => s.profiles);
  const saveProfile = useStore((s) => s.saveProfile);
  const deleteProfile = useStore((s) => s.deleteProfile);

  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [listIndex, setListIndex] = useState(0);

  // Tell App's global input handler to stand down while the builder or the
  // delete confirm owns the keyboard (digits/q/etc. must not fire).
  const setProfilesEditing = useStore((s) => s.setProfilesEditing);
  useEffect(() => {
    setProfilesEditing(mode.kind !== "list");
    return () => setProfilesEditing(false);
  }, [mode.kind, setProfilesEditing]);

  const names = useMemo(() => Object.keys(profiles).sort(), [profiles]);

  // Source repo skills grouped into namespaces + top-level. Recomputed when
  // entering the builder (cheap directory scan; the tab re-renders on mode
  // change).
  const tree = useMemo(() => {
    const repo = getConfigRepoPath();
    if (!repo) return { namespaces: [], topLevel: [] };
    return indexSourceSkillTree(repo);
  }, [mode.kind]);

  const totalSkills = useMemo(
    () => tree.namespaces.reduce((n, ns) => n + ns.skills.length, 0) + tree.topLevel.length,
    [tree],
  );

  const rows = useMemo(
    () => (mode.kind === "edit" ? buildRows(tree.namespaces, tree.topLevel, mode.expanded) : []),
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
    });
  };

  useInput((input, key) => {
    if (mode.kind === "list") {
      if (key.upArrow) setListIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setListIndex((i) => Math.min(Math.max(0, names.length - 1), i + 1));
      else if (input === "n") openBuilder(null);
      else if (names.length > 0 && (key.return || input === "e")) openBuilder(names[Math.min(listIndex, names.length - 1)]);
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

    if (key.escape) {
      setMode({ kind: "list" });
      return;
    }

    const row = rows[mode.cursor];

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
    } else if (key.return) {
      // Keep the source repo's skill order stable in config (sorted).
      void saveProfile(mode.name, [...mode.selected].sort()).then((ok) => {
        if (ok && mode.original && mode.original !== mode.name.trim()) {
          // Renamed: drop the old entry.
          void deleteProfile(mode.original);
        }
      });
      setMode({ kind: "list" });
    }
  });

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

    const maxRows = Math.max(1, contentHeight - 5);
    const start = Math.max(0, Math.min(mode.cursor - Math.floor(maxRows / 2), rows.length - maxRows));
    const visible = rows.slice(start, start + maxRows);
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold color="cyan">{mode.name}</Text>
          <Text color="gray">{"  "}{mode.selected.size} of {totalSkills} skills selected</Text>
        </Box>
        {rows.length === 0 ? (
          <Text color="gray">No skills found in the source repo.</Text>
        ) : (
          visible.map((row, i) => {
            const idx = start + i;
            const isSel = idx === mode.cursor;
            const marker = isSel ? "❯ " : "  ";
            if (row.kind === "namespace") {
              const selCount = row.skills.filter((s) => mode.selected.has(s)).length;
              const glyph = selCount === 0 ? "○" : selCount === row.skills.length ? "◉" : "◐";
              const glyphColor = selCount === 0 ? "gray" : selCount === row.skills.length ? "green" : "yellow";
              return (
                <Box key={`ns:${row.name}`}>
                  <Text color={isSel ? "cyan" : "gray"}>{marker}</Text>
                  <Text color={glyphColor}>{glyph} </Text>
                  <Text color="blue">{row.expanded ? "▾ " : "▸ "}</Text>
                  <Text bold color={isSel ? "white" : "gray"}>{row.name}</Text>
                  <Text color="gray">{"  "}{selCount}/{row.skills.length} · →/← expand</Text>
                </Box>
              );
            }
            const checked = mode.selected.has(row.name);
            return (
              <Box key={`sk:${row.name}`}>
                <Text color={isSel ? "cyan" : "gray"}>{marker}</Text>
                <Text>{row.depth === 1 ? "  " : ""}</Text>
                <Text color={checked ? "green" : "gray"}>{checked ? "◉ " : "○ "}</Text>
                <Text color={isSel ? "white" : checked ? "white" : "gray"}>{row.name}</Text>
              </Box>
            );
          })
        )}
        <Text color="gray">Space toggle (namespace = all its skills) · →/← expand · Enter save · r rename · Esc cancel</Text>
      </Box>
    );
  }

  // List view
  return (
    <Box flexDirection="column">
      {names.length === 0 ? (
        <Box marginY={1}>
          <Text color="gray">No profiles yet. A profile is a named skill bundle you can apply to any workspace. Press 'n' to create one.</Text>
        </Box>
      ) : (
        names.slice(0, Math.max(1, contentHeight - 3)).map((n, i) => {
          const isSel = i === listIndex;
          const skills = profiles[n];
          return (
            <Box key={n}>
              <Text color={isSel ? "cyan" : "gray"}>{isSel ? "❯ " : "  "}</Text>
              <Text bold={isSel} color={isSel ? "white" : "gray"}>{n}</Text>
              <Text color="gray">
                {"  "}{skills.length} skill{skills.length === 1 ? "" : "s"}
                {skills.length > 0 ? ` · ${skills.slice(0, 4).join(", ")}${skills.length > 4 ? ", …" : ""}` : ""}
              </Text>
            </Box>
          );
        })
      )}
      <Box marginTop={1}>
        <Text color="gray">n new · Enter/e edit · d delete{names.length > 0 ? " · applied from a workspace with P" : ""}</Text>
      </Box>
    </Box>
  );
}
