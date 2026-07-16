import React from "react";
import { Box, Text } from "ink";
import { useStore } from "../lib/store.js";
import type { ProjectSkillStatus } from "../lib/projects.js";

const STATUS_META: Record<ProjectSkillStatus, { glyph: string; color: string; label: string }> = {
  "in-sync": { glyph: "✓", color: "green", label: "in sync" },
  drifted: { glyph: "≠", color: "yellow", label: "drifted" },
  "project-only": { glyph: "•", color: "gray", label: "project-only" },
};

export interface ProjectsTabProps {
  contentHeight: number;
}

export function ProjectsTab({ contentHeight }: ProjectsTabProps) {
  const selectedIndex = useStore((s) => s.selectedIndex);
  const loading = useStore((s) => s.loading);
  const projects = useStore((s) => s.projects);
  const projectsLoaded = useStore((s) => s.projectsLoaded);

  if (projects.length === 0) {
    return (
      <Box marginY={1}>
        <Text color={loading ? "cyan" : "gray"}>
          {loading
            ? "⠋ Loading projects..."
            : projectsLoaded
              ? "No projects registered. Press 'a' to add a project directory."
              : "No project data loaded. Press R to refresh."}
        </Text>
      </Box>
    );
  }

  const selected = projects[Math.min(selectedIndex, projects.length - 1)];
  // Cap the skill list so the detail box never blows the chrome-row budget.
  const maxSkillRows = Math.max(1, contentHeight - projects.length - 6);

  return (
    <Box flexDirection="column">
      {projects.map((p, i) => {
        const isSel = i === selectedIndex;
        const drifted = p.skills.filter((s) => s.status === "drifted").length;
        const summary = !p.exists
          ? "missing dir"
          : `${p.skills.length} skill${p.skills.length === 1 ? "" : "s"}${drifted ? ` · ${drifted} drifted` : ""}`;
        return (
          <Box key={p.path}>
            <Text color={isSel ? "cyan" : "white"}>
              {isSel ? "❯ " : "  "}
              {p.name}
            </Text>
            <Text color="gray" wrap="truncate">
              {"  "}
              {p.path} · {summary}
            </Text>
          </Box>
        );
      })}

      {selected && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Box>
            <Text color="white" bold>
              {selected.name}
            </Text>
            <Text color="gray">
              {"  "}.agents/skills · {selected.availableCount} available to add
            </Text>
          </Box>
          {selected.skills.length === 0 ? (
            <Text color="gray">
              No skills in .agents/skills{selected.hasAgentsDir ? "" : " (directory not present)"}.
            </Text>
          ) : (
            selected.skills.slice(0, maxSkillRows).map((s) => {
              const m = STATUS_META[s.status];
              return (
                <Box key={s.name}>
                  <Text color={m.color}>{m.glyph} </Text>
                  <Text color={s.enabled ? "white" : "gray"}>
                    {s.name}
                    {s.enabled ? "" : " (disabled)"}
                  </Text>
                  <Text color="gray">
                    {"  "}
                    {m.label}
                  </Text>
                </Box>
              );
            })
          )}
          {selected.skills.length > maxSkillRows && (
            <Text color="gray">…and {selected.skills.length - maxSkillRows} more</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
