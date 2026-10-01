import type { ProfileCoverage } from "../lib/skill-profiles.js";
import { workspaceLock, profileStatusSummary } from "../lib/skill-profiles.js";
import React, { useEffect, useMemo } from "react";
import { join } from "path";
import { Box, Text } from "ink";
import { useStore } from "../lib/store.js";
import { buildProjectRows, PROJECT_SKILLS_SUBDIR, type ProjectSkillStatus } from "../lib/projects.js";
import { computeWindow, windowLabel } from "../lib/list-window.js";
import { lockInstallText, type LockSyncTarget } from "../lib/lock-install-sync.js";
import { SearchBox } from "../components/SearchBox.js";

const STATUS_META: Record<ProjectSkillStatus, { glyph: string; color: string; label: string }> = {
  "in-sync": { glyph: "✓", color: "green", label: "in sync" },
  drifted: { glyph: "≠", color: "yellow", label: "drifted" },
  "project-only": { glyph: "•", color: "gray", label: "project-only" },
};

/**
 * One line per profile ASSIGNED to this workspace (named in its lock's
 * `profiles` meta): is it up to date here, and if not, what P would do.
 */
function coverageLines(coverage: ProfileCoverage[] | undefined): Array<{ key: string; text: string; stale: boolean }> {
  return (coverage ?? [])
    .filter((c) => c.assigned)
    .map((c) => ({
      key: c.profile,
      stale: !c.upToDate,
      text: `profile ${c.profile}: ${c.present.length}/${c.total} · ${profileStatusSummary(c)}${c.upToDate ? "" : " — P to apply"}`,
    }));
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
  const lockSync = useStore((s) => s.lockSync);
  const refreshLockSync = useStore((s) => s.refreshLockSync);

  // Compute each project's install-sync in the background: does what's installed
  // in the project's .agents/skills match its skills-lock.json?
  const lockTargets = useMemo<LockSyncTarget[]>(
    () => projects
      .filter((p) => !p.synthetic && p.exists)
      .map((p) => ({
        key: join(p.path, "skills-lock.json"),
        skills: workspaceLock(p.path).skills,
        installedDir: join(p.path, PROJECT_SKILLS_SUBDIR),
      })),
    [projects],
  );
  const lockTargetsKey = lockTargets.map((t) => `${t.key}:${Object.keys(t.skills).length}`).join("\n");
  useEffect(() => {
    if (lockTargets.length > 0) void refreshLockSync(lockTargets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockTargetsKey, refreshLockSync]);

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
          {(() => {
            if (project.synthetic || !project.exists) return null;
            const h = lockInstallText(lockSync[join(project.path, "skills-lock.json")]);
            return <Text> · <Text color={h.color}>{h.text}</Text> <Text color="gray">(g)</Text></Text>;
          })()}
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
          {position ? `${position} · ` : ""}{search && skillRowCount !== allCount ? `${skillRowCount} of ${allCount} match · ` : ""}Enter details/expand · P apply profile · / search · ↑↓ scroll · Esc back
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
        // Assigned profiles with their state: "Coding ✓, UI 3 to apply".
        const profileTags = (p.profileCoverage ?? [])
          .filter((c) => c.assigned)
          .map((c) => `${c.profile} ${c.upToDate ? "✓" : profileStatusSummary(c)}`)
          .join(", ");
        const lockHint = p.synthetic || !p.exists ? null : lockInstallText(lockSync[join(p.path, "skills-lock.json")]);
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
              {lockHint ? <Text> · lock <Text color={lockHint.color}>{lockHint.text}</Text></Text> : null}
            </Text>
          </Text>
        );
      })}
      <Box marginTop={1}>
        <Text color="gray" wrap="truncate-end">
          {position ? `${position} · ` : ""}Enter to open a project · P apply profile · S save lock as profile · a add · d remove
        </Text>
      </Box>
    </Box>
  );
}
