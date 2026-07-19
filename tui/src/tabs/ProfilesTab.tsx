import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useStore } from "../lib/store.js";
import { getConfigRepoPath } from "../lib/config.js";
import { indexSourceSkills } from "../lib/projects.js";

/**
 * Profiles tab — named skill bundles (config `profiles:`) that can be applied
 * to any workspace. List view for browsing, builder sub-view for creating and
 * editing (multi-select over the source repo's skills).
 */

type Mode =
  | { kind: "list" }
  | { kind: "edit"; original: string | null; name: string; naming: boolean; selected: Set<string>; cursor: number }
  | { kind: "confirmDelete"; name: string };

export interface ProfilesTabProps {
  contentHeight: number;
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

  // All skills available in the source repo, sorted. Recomputed when entering
  // the builder (cheap directory scan; the tab re-renders on mode change).
  const sourceSkills = useMemo(() => {
    const repo = getConfigRepoPath();
    if (!repo) return [];
    return [...indexSourceSkills(repo).keys()].sort();
  }, [mode.kind]);

  const openBuilder = (original: string | null) => {
    setMode({
      kind: "edit",
      original,
      name: original ?? "",
      // Creating: name first. Editing: straight to skill selection.
      naming: original === null,
      selected: new Set(original ? profiles[original] ?? [] : []),
      cursor: 0,
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
    if (key.upArrow) {
      setMode({ ...mode, cursor: Math.max(0, mode.cursor - 1) });
    } else if (key.downArrow) {
      setMode({ ...mode, cursor: Math.min(Math.max(0, sourceSkills.length - 1), mode.cursor + 1) });
    } else if (input === " " && sourceSkills.length > 0) {
      const skill = sourceSkills[mode.cursor];
      const selected = new Set(mode.selected);
      if (selected.has(skill)) selected.delete(skill);
      else selected.add(skill);
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
    const start = Math.max(0, Math.min(mode.cursor - Math.floor(maxRows / 2), sourceSkills.length - maxRows));
    const visible = sourceSkills.slice(start, start + maxRows);
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold color="cyan">{mode.name}</Text>
          <Text color="gray">{"  "}{mode.selected.size} of {sourceSkills.length} skills selected</Text>
        </Box>
        {sourceSkills.length === 0 ? (
          <Text color="gray">No skills found in the source repo.</Text>
        ) : (
          visible.map((skill, i) => {
            const idx = start + i;
            const isSel = idx === mode.cursor;
            const checked = mode.selected.has(skill);
            return (
              <Box key={skill}>
                <Text color={isSel ? "cyan" : "gray"}>{isSel ? "❯ " : "  "}</Text>
                <Text color={checked ? "green" : "gray"}>{checked ? "◉ " : "○ "}</Text>
                <Text color={isSel ? "white" : checked ? "white" : "gray"}>{skill}</Text>
              </Box>
            );
          })
        )}
        <Text color="gray">Space toggle · Enter save · r rename · Esc cancel</Text>
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
