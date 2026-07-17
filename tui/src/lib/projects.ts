import { existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { loadConfig } from "./config/loader.js";
import { expandPath } from "./config/path.js";
import { getConfigRepoPath } from "./config.js";
import { hashDirectory } from "./modules/hash.js";

// Blackbook manages a project's shared, tool-agnostic skills directory. `.agents`
// is the emerging cross-tool convention (multiple agents read `.agents/skills`),
// so a project has ONE skills location rather than a per-tool matrix.
export const PROJECT_SKILLS_SUBDIR = ".agents/skills";
// Enable/disable is modeled as a parallel sibling dir (skills-manager convention),
// so a disabled skill keeps its content but is not seen by agents.
export const PROJECT_SKILLS_DISABLED_SUBDIR = ".agents/skills-disabled";

export type ProjectSkillStatus = "in-sync" | "drifted" | "project-only";

export interface ProjectSkill {
  /** Skill directory name (also the match key against the source repo). */
  name: string;
  /** Absolute path to the skill directory inside the project. */
  diskPath: string;
  /** False when the skill lives in the `-disabled` sibling directory. */
  enabled: boolean;
  /** Drift of the project copy relative to the source-repo copy. */
  status: ProjectSkillStatus;
  /** Matching source-repo skill directory, when one exists. */
  sourcePath?: string;
}

/** A source-repo skill not yet present in a project (a candidate to add). */
export interface AvailableSkill {
  name: string;
  /** Source-repo skill directory. */
  sourcePath: string;
}

export interface ProjectInfo {
  /** Expanded absolute project directory. */
  path: string;
  /** Display name — config `name` or the directory basename. */
  name: string;
  /** The project directory exists on disk. */
  exists: boolean;
  /** `<project>/.agents/skills` exists on disk. */
  hasAgentsDir: boolean;
  /** Skills found in the project's `.agents/skills` (enabled + disabled). */
  skills: ProjectSkill[];
  /** Source-repo skills not yet present in this project (candidates to add). */
  available: AvailableSkill[];
  /**
   * The always-present global `~/.agents/skills` workspace. Not stored in
   * config, cannot be removed; the shared location every `.agents`-aware tool
   * reads, so skills sync once instead of fanning into each tool's own dir.
   */
  synthetic?: boolean;
}

/** True if `dir` is a skill directory (contains SKILL.md). */
function isSkillDir(dir: string): boolean {
  return existsSync(join(dir, "SKILL.md"));
}

/**
 * Index every skill in the source repo by name → absolute skill directory.
 * Supports the canonical flat layout (`skills/<name>/SKILL.md`) and the
 * namespaced layout (`skills/<namespace>/<name>/SKILL.md`). First match wins,
 * mirroring the source-skill index in install.ts.
 */
export function indexSourceSkills(sourceRepo: string): Map<string, string> {
  const index = new Map<string, string>();
  const skillsRoot = join(sourceRepo, "skills");
  if (!existsSync(skillsRoot)) return index;

  for (const entry of safeReaddir(skillsRoot)) {
    const dir = join(skillsRoot, entry);
    if (!isDirectory(dir)) continue;
    if (isSkillDir(dir)) {
      if (!index.has(entry)) index.set(entry, dir);
      continue;
    }
    // Namespace directory: look one level deeper.
    for (const child of safeReaddir(dir)) {
      const childDir = join(dir, child);
      if (isDirectory(childDir) && isSkillDir(childDir) && !index.has(child)) {
        index.set(child, childDir);
      }
    }
  }
  return index;
}

/** Scan one skills root (enabled or disabled) for immediate skill directories. */
function scanSkillsRoot(
  root: string,
  enabled: boolean,
  sourceIndex: Map<string, string>,
): ProjectSkill[] {
  if (!existsSync(root)) return [];
  const skills: ProjectSkill[] = [];
  for (const entry of safeReaddir(root)) {
    const dir = join(root, entry);
    if (!isDirectory(dir) || !isSkillDir(dir)) continue;
    const sourcePath = sourceIndex.get(entry);
    skills.push({
      name: entry,
      diskPath: dir,
      enabled,
      sourcePath,
      status: classifyStatus(dir, sourcePath),
    });
  }
  return skills;
}

/** Compare a project skill directory to its source-repo counterpart. */
function classifyStatus(projectDir: string, sourcePath?: string): ProjectSkillStatus {
  if (!sourcePath) return "project-only";
  try {
    return hashDirectory(projectDir) === hashDirectory(sourcePath) ? "in-sync" : "drifted";
  } catch {
    // If either side can't be hashed (races, permissions), report drift rather
    // than silently claiming in-sync.
    return "drifted";
  }
}

/** Scan a project's `.agents/skills` (and `-disabled` sibling) for skills. */
export function scanProjectSkills(
  projectPath: string,
  sourceIndex: Map<string, string>,
): ProjectSkill[] {
  const enabled = scanSkillsRoot(join(projectPath, PROJECT_SKILLS_SUBDIR), true, sourceIndex);
  const disabled = scanSkillsRoot(
    join(projectPath, PROJECT_SKILLS_DISABLED_SUBDIR),
    false,
    sourceIndex,
  );
  return [...enabled, ...disabled].sort((a, b) => a.name.localeCompare(b.name));
}

/** Scan one `.agents/skills` root (a project dir or `$HOME`) into a ProjectInfo. */
function buildProjectInfo(
  path: string,
  name: string,
  sourceIndex: Map<string, string>,
  synthetic = false,
): ProjectInfo {
  const exists = isDirectory(path);
  const skills = exists ? scanProjectSkills(path, sourceIndex) : [];
  const present = new Set(skills.map((s) => s.name));
  const available: AvailableSkill[] = [];
  for (const [skillName, sourcePath] of sourceIndex) {
    if (!present.has(skillName)) available.push({ name: skillName, sourcePath });
  }
  available.sort((a, b) => a.name.localeCompare(b.name));
  return {
    path,
    name,
    exists,
    hasAgentsDir: exists && existsSync(join(path, PROJECT_SKILLS_SUBDIR)),
    skills,
    available,
    synthetic,
  };
}

/**
 * All skill workspaces: the always-present global `~/.agents/skills` first,
 * then the registered project directories. Each is scanned against the source
 * repo for drift.
 *
 * Note: `~/.agents/skills` is now ALSO tracked as the `agents` pseudo-tool's
 * instance through the normal sync/skill engine (see
 * `playbooks/agents.yaml` and its `install_dir` redirect for Codex/OpenCode/
 * Amp/Pi's `skills` component) — the same directory shows up twice, once
 * here as the synthetic "Global" workspace and once as a regular tool
 * instance. Left as an accepted overlap for now rather than consolidated.
 */
export function getProjects(): ProjectInfo[] {
  const { config } = loadConfig();
  const sourceRepo = getConfigRepoPath();
  const sourceIndex = sourceRepo ? indexSourceSkills(sourceRepo) : new Map<string, string>();

  const global = buildProjectInfo(homedir(), "Global", sourceIndex, true);
  const registered = config.projects.map((entry) =>
    buildProjectInfo(expandPath(entry.path), entry.name ?? basename(expandPath(entry.path)), sourceIndex),
  );
  return [global, ...registered];
}

/** An unmanaged skill: present in some workspace's `.agents/skills` but not in the source repo. */
export interface UnmanagedSkill {
  name: string;
  /** The workspace skill directory to adopt from. */
  fromPath: string;
  /** Display name of the workspace it was found in. */
  workspace: string;
}

/**
 * Collect skills that live in a workspace's `.agents/skills` but aren't in the
 * source repo (status "project-only"), deduped by name (first workspace wins).
 * This is the input to the Adopt sweep.
 */
export function collectUnmanagedSkills(projects: ProjectInfo[]): UnmanagedSkill[] {
  const seen = new Set<string>();
  const out: UnmanagedSkill[] = [];
  for (const project of projects) {
    for (const skill of project.skills) {
      if (skill.status === "project-only" && !seen.has(skill.name)) {
        seen.add(skill.name);
        out.push({ name: skill.name, fromPath: skill.diskPath, workspace: project.name });
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A row in the drill-in skill list: an existing project skill or an addable one. */
export type ProjectSkillRow =
  | { kind: "present"; skill: ProjectSkill }
  | { kind: "available"; available: AvailableSkill };

/** Flatten a project's present skills followed by its available-to-add skills. */
export function buildProjectSkillRows(project: ProjectInfo): ProjectSkillRow[] {
  return [
    ...project.skills.map((skill) => ({ kind: "present" as const, skill })),
    ...project.available.map((available) => ({ kind: "available" as const, available })),
  ];
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
