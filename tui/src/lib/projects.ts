import { existsSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";
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

/** Load registered projects from config and scan each against the source repo. */
export function getProjects(): ProjectInfo[] {
  const { config } = loadConfig();
  const sourceRepo = getConfigRepoPath();
  const sourceIndex = sourceRepo ? indexSourceSkills(sourceRepo) : new Map<string, string>();

  return config.projects.map((entry) => {
    const path = expandPath(entry.path);
    const exists = isDirectory(path);
    const skills = exists ? scanProjectSkills(path, sourceIndex) : [];
    const present = new Set(skills.map((s) => s.name));
    const available: AvailableSkill[] = [];
    for (const [name, sourcePath] of sourceIndex) {
      if (!present.has(name)) available.push({ name, sourcePath });
    }
    available.sort((a, b) => a.name.localeCompare(b.name));
    return {
      path,
      name: entry.name ?? basename(path),
      exists,
      hasAgentsDir: exists && existsSync(join(path, PROJECT_SKILLS_SUBDIR)),
      skills,
      available,
    };
  });
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
