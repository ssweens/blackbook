import type { ProfileCoverage } from "../lib/skill-profiles.js";
import React from "react";
import { Box, Text } from "ink";
import { useStore } from "../lib/store.js";
import { buildProjectRows, type ProjectSkillStatus } from "../lib/projects.js";
import { computeWindow, windowLabel } from "../lib/list-window.js";
import { SearchBox } from "../components/SearchBox.js";

const STATUS_META: Record<ProjectSkillStatus, { glyph: string; color: string; label: string }> = {
  "in-sync": { glyph: "✓", color: "green", label: "in sync" },
  drifted: { glyph: "≠", color: "yellow", label: "drifted" },
  "project-only": { glyph: "•", color: "gray", label: "project-only" },
};

/**
 * One line per profile this workspace uses (or has been applied to): coverage,
 * plus what applying it again would change. Profiles it doesn't touch at all
 * are left out to keep the view short.
 */
function coverageLines(coverage: ProfileCoverage[] | undefined): Array<{ key: string; text: string; stale: boolean }> {
  return (coverage ?? [])
    .filter((c) => c.present.length > 0 || c.applied)
    .map((c) => {
      const delta = [c.missing.length ? `${c.missing.length} new` : "", c.removed.length ? `${c.removed.length} removed` : ""]
        .filter(Boolean)
        .join(", ");
      return {
        key: c.profile,
        stale: delta.length > 0,
        text: `profile ${c.profile}: ${c.present.length}/${c.total}${delta ? ` · ${delta} — P to apply` : " · up to date"}`,
      };
    });
}

export interface ProjectsTabProps {
  contentHeight: number;
  searchFocused?: boolean;
  onSearchFocus?: () => void;
  onSearchBlur?: () => void;
}

export function ProjectsTab({ contentHeight, searchFocused = false, onSearchFocus, onSearchBlur }: ProjectsTabProps) {
  const selectedIndex = useStore((s) => s.selectedIndex);
  const loading = useStore((s) => s.loading);
  const projects = useStore((s) => s.projects);
  const projectsLoaded = useStore((s) => s.projectsLoaded);
  const projectDetailPath = useStore((s) => s.projectDetailPath);
  const collapsedProjectNamespaces = useStore((s) => s.collapsedProjectNamespaces);
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);

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

  // Drill-in: per-skill list for one project, searchable and scrollable.
  if (projectDetailPath) {
    const project = projects.find((p) => p.path === projectDetailPath);
    if (!project) {
      return (
        <Box marginY={1}>
          <Text color="gray">Project no longer available. Press Esc to go back.</Text>
        </Box>
      );
    }
    const allCount = project.skills.length + project.available.length;
    const rows = buildProjectRows(project, search, collapsedProjectNamespaces, { expandAll: search.trim().length > 0 });
    const skillRowCount = rows.filter((r) => r.kind !== "namespace").length;
    const coverage = coverageLines(project.profileCoverage);
    // Header, lock line, coverage lines, search box (2), footer.
    const maxRows = Math.max(1, contentHeight - 5 - coverage.length);
    const { visible, startIndex } = computeWindow(rows, selectedIndex, maxRows);
    const position = windowLabel(startIndex, visible.length, rows.length);
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color="cyan" bold>{project.name}</Text>
          <Text color="gray">{"  "}{project.synthetic ? "~/.agents/skills" : `${project.path}/.agents/skills`}</Text>
        </Text>
        <Text color="gray" wrap="truncate-end">
          {project.synthetic ? "global lock (~/.agents/.skill-lock.json)" : "skills-lock.json"}:{" "}
          {project.lockEntries ? `${project.lockEntries} skill${project.lockEntries === 1 ? "" : "s"}` : "none yet"}
        </Text>
        {coverage.map((line) => (
          <Text key={line.key} color={line.stale ? "yellow" : "green"} wrap="truncate-end">
            {line.text}
          </Text>
        ))}
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search this project's skills..."
          focus={searchFocused}
          onFocus={onSearchFocus}
          onBlur={onSearchBlur}
        />
        {rows.length === 0 ? (
          <Text color="gray">
            {allCount === 0 ? "No skills here and none available in the source repo." : `No skills match "${search}".`}
          </Text>
        ) : (
          visible.map((row, i) => {
            const isSel = startIndex + i === selectedIndex;
            const marker = isSel ? "❯ " : "  ";
            if (row.kind === "namespace") {
              return (
                <Text key={`ns:${row.name}`} wrap="truncate-end">
                  <Text color={isSel ? "cyan" : "gray"}>{marker}</Text>
                  <Text color="blue">{row.collapsed ? "▸ " : "▾ "}</Text>
                  <Text bold color={isSel ? "white" : "gray"}>{row.name}</Text>
                  <Text color="gray">{"  "}{row.count} skill{row.count === 1 ? "" : "s"}</Text>
                </Text>
              );
            }
            const indent = row.depth === 1 ? "  " : "";
            if (row.kind === "available") {
              return (
                <Text key={`a:${row.available.name}`} wrap="truncate-end">
                  <Text color={isSel ? "cyan" : "gray"}>{marker}</Text>
                  <Text>{indent}</Text>
                  <Text color="blue">+ </Text>
                  <Text color={isSel ? "white" : "gray"}>{row.available.name}</Text>
                  <Text color="gray">{"  "}available — p to add</Text>
                </Text>
              );
            }
            const m = STATUS_META[row.skill.status];
            return (
              <Text key={`s:${row.skill.name}`} wrap="truncate-end">
                <Text color={isSel ? "cyan" : "gray"}>{marker}</Text>
                <Text>{indent}</Text>
                <Text color={m.color}>{m.glyph} </Text>
                <Text color={row.skill.enabled ? "white" : "gray"}>
                  {row.skill.name}
                  {row.skill.enabled ? "" : " (disabled)"}
                </Text>
                <Text color="gray">{"  "}{m.label}</Text>
              </Text>
            );
          })
        )}
        <Text color="gray" wrap="truncate-end">
          {position ? `${position} · ` : ""}{search && skillRowCount !== allCount ? `${skillRowCount} of ${allCount} match · ` : ""}Enter details/expand · g source repo · / search · ↑↓ scroll · Esc back
        </Text>
      </Box>
    );
  }

  // Project list, scrollable.
  const maxRows = Math.max(1, contentHeight - 2);
  const { visible, startIndex } = computeWindow(projects, selectedIndex, maxRows);
  const position = windowLabel(startIndex, visible.length, projects.length);
  return (
    <Box flexDirection="column">
      {visible.map((p, i) => {
        const isSel = startIndex + i === selectedIndex;
        const drifted = p.skills.filter((s) => s.status === "drifted").length;
        const summary = !p.exists
          ? "missing dir"
          : `${p.skills.length} skill${p.skills.length === 1 ? "" : "s"}${drifted ? ` · ${drifted} drifted` : ""} · ${p.available.length} available`;
        const location = p.synthetic ? "~/.agents/skills (global)" : p.path;
        const profileTags = (p.profileCoverage ?? [])
          .filter((c) => c.present.length > 0 || c.applied)
          .map((c) => `${c.profile} ${c.present.length}/${c.total}`)
          .join(", ");
        return (
          <Text key={p.path} wrap="truncate-end">
            <Text color={isSel ? "cyan" : p.synthetic ? "magenta" : "white"}>
              {isSel ? "❯ " : "  "}
              {p.name}
            </Text>
            <Text color="gray">
              {"  "}
              {location} · {summary}
              {profileTags ? ` · ${profileTags}` : ""}
              {p.transient ? " · recent" : ""}
            </Text>
          </Text>
        );
      })}
      <Box marginTop={1}>
        <Text color="gray" wrap="truncate-end">
          {position ? `${position} · ` : ""}Enter to open a project · a add · d remove · P apply profile · S save lock as profile · g source repo
        </Text>
      </Box>
    </Box>
  );
}
