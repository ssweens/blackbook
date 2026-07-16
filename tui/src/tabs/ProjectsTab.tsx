import React from "react";
import { Box, Text } from "ink";
import { useStore } from "../lib/store.js";
import { buildProjectSkillRows, type ProjectSkillStatus } from "../lib/projects.js";

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
  const projectDetailPath = useStore((s) => s.projectDetailPath);

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

  // Drill-in: per-skill list for one project.
  if (projectDetailPath) {
    const project = projects.find((p) => p.path === projectDetailPath);
    if (!project) {
      return (
        <Box marginY={1}>
          <Text color="gray">Project no longer available. Press Esc to go back.</Text>
        </Box>
      );
    }
    const rows = buildProjectSkillRows(project);
    const maxRows = Math.max(1, contentHeight - 4);
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="cyan" bold>
            {project.name}
          </Text>
          <Text color="gray" wrap="truncate">
            {"  "}
            {project.synthetic ? "~/.agents/skills" : `${project.path}/.agents/skills`}
          </Text>
        </Box>
        {rows.length === 0 ? (
          <Text color="gray">No skills here and none available in the source repo.</Text>
        ) : (
          rows.slice(0, maxRows).map((row, i) => {
            const isSel = i === selectedIndex;
            const marker = isSel ? "❯ " : "  ";
            if (row.kind === "available") {
              return (
                <Box key={`a:${row.available.name}`}>
                  <Text color={isSel ? "cyan" : "gray"}>{marker}</Text>
                  <Text color="blue">+ </Text>
                  <Text color={isSel ? "white" : "gray"}>{row.available.name}</Text>
                  <Text color="gray">{"  "}available — p to add</Text>
                </Box>
              );
            }
            const m = STATUS_META[row.skill.status];
            return (
              <Box key={`s:${row.skill.name}`}>
                <Text color={isSel ? "cyan" : "gray"}>{marker}</Text>
                <Text color={m.color}>{m.glyph} </Text>
                <Text color={row.skill.enabled ? "white" : "gray"}>
                  {row.skill.name}
                  {row.skill.enabled ? "" : " (disabled)"}
                </Text>
                <Text color="gray">
                  {"  "}
                  {m.label}
                </Text>
              </Box>
            );
          })
        )}
        {rows.length > maxRows && <Text color="gray">…and {rows.length - maxRows} more</Text>}
      </Box>
    );
  }

  // Project list.
  return (
    <Box flexDirection="column">
      {projects.map((p, i) => {
        const isSel = i === selectedIndex;
        const drifted = p.skills.filter((s) => s.status === "drifted").length;
        const summary = !p.exists
          ? "missing dir"
          : `${p.skills.length} skill${p.skills.length === 1 ? "" : "s"}${drifted ? ` · ${drifted} drifted` : ""} · ${p.available.length} available`;
        const location = p.synthetic ? "~/.agents/skills (global)" : p.path;
        return (
          <Box key={p.path}>
            <Text color={isSel ? "cyan" : p.synthetic ? "magenta" : "white"}>
              {isSel ? "❯ " : "  "}
              {p.name}
            </Text>
            <Text color="gray" wrap="truncate">
              {"  "}
              {location} · {summary}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color="gray">Enter to open a project · a add · d remove</Text>
      </Box>
    </Box>
  );
}
