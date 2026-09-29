import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { computeWindow, windowLabel } from "../lib/list-window.js";

interface SkillProfilesModalProps {
  skillName: string;
  profiles: Record<string, string[]>;
  onSave: (members: string[]) => void;
  onCancel: () => void;
  maxRows?: number;
}

/** Check the profiles a skill belongs to; Enter adds it to or removes it from each changed profile. */
export function SkillProfilesModal({ skillName, profiles, onSave, onCancel, maxRows = 12 }: SkillProfilesModalProps) {
  const names = useMemo(
    () => Object.keys(profiles).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [profiles],
  );
  const initial = useMemo(() => new Set(names.filter((n) => profiles[n].includes(skillName))), [names, profiles, skillName]);
  const [checked, setChecked] = useState<Set<string>>(initial);
  const [index, setIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (names.length === 0) return;
    if (key.upArrow) setIndex((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIndex((i) => Math.min(names.length - 1, i + 1));
    else if (input === " ") {
      const name = names[index];
      setChecked((current) => {
        const next = new Set(current);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
    } else if (key.return) onSave([...checked]);
  });

  const { visible, startIndex } = computeWindow(names, index, maxRows);
  const position = windowLabel(startIndex, visible.length, names.length);
  const changes = names.filter((n) => checked.has(n) !== initial.has(n)).length;
  const nameWidth = Math.max(0, ...names.map((n) => n.length));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold wrap="truncate-end">Profiles for {skillName}</Text>
      {names.length === 0 ? (
        <>
          <Text color="gray">No profiles yet. Create one in the Profiles tab (n).</Text>
          <Text color="gray">Esc to close</Text>
        </>
      ) : (
        <>
          {visible.map((n, i) => {
            const isSel = startIndex + i === index;
            const on = checked.has(n);
            const count = profiles[n].length + (on && !initial.has(n) ? 1 : 0) - (!on && initial.has(n) ? 1 : 0);
            return (
              <Text key={n} wrap="truncate-end">
                <Text color={isSel ? "cyan" : "gray"}>{isSel ? "❯ " : "  "}</Text>
                <Text color={on ? "green" : "gray"}>{on ? "◉ " : "○ "}</Text>
                <Text color={isSel ? "white" : on ? "white" : "gray"}>{n.padEnd(nameWidth)}</Text>
                <Text color="gray">{"  "}{count} skill{count === 1 ? "" : "s"}{on !== initial.has(n) ? (on ? " · will add" : " · will remove") : ""}</Text>
              </Text>
            );
          })}
          <Text color="gray" wrap="truncate-end">
            {position ? `${position} · ` : ""}Space toggle · Enter save{changes ? ` (${changes} change${changes === 1 ? "" : "s"})` : ""} · Esc cancel
          </Text>
        </>
      )}
    </Box>
  );
}
