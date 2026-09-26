import { existsSync, lstatSync, mkdirSync, rmSync } from "fs";
import { join, dirname, resolve } from "path";
import { directorySyncModule } from "./modules/directory-sync.js";
import { createBackup, pruneBackups } from "./modules/backup.js";
import { renameOrCopy } from "./fs-utils.js";
import { PROJECT_SKILLS_SUBDIR, PROJECT_SKILLS_DISABLED_SUBDIR } from "./projects.js";
import { enabledSkillAgents, runSkillsCli, summarizeCliFailure } from "./skills-cli.js";
import { execFileSync } from "child_process";
import { homedir } from "os";

/** The Projects tab's Global workspace is `$HOME`; the skills CLI calls that scope `-g`. */
function isGlobalWorkspace(projectPath: string): boolean {
  return resolve(projectPath) === resolve(homedir());
}

export interface ProjectActionResult {
  ok: boolean;
  error?: string;
  /** Non-fatal notes (e.g. the source can't be restored by teammates). */
  warnings?: string[];
}

export interface PushSkillOptions {
  /**
   * "link" (default in config): install through the vendored skills CLI, which
   * records the skill in `skills-lock.json` and symlinks it from the central
   * store; "copy": legacy vendored copy. Defaults to "copy" when omitted so
   * existing direct callers keep their behavior.
   */
  mode?: "copy" | "link";
  /** Source repo root; required for "link" (it is the CLI's install source). */
  sourceRepo?: string | null;
}

/** `<project>/.agents/skills/<name>` (or the `-disabled` sibling). */
export function projectSkillDir(projectPath: string, name: string, enabled = true): string {
  const sub = enabled ? PROJECT_SKILLS_SUBDIR : PROJECT_SKILLS_DISABLED_SUBDIR;
  return join(projectPath, sub, name);
}

/**
 * Push a source-repo skill into a project's `.agents/skills` (add or reset).
 * Reuses the crash-safe, backup-taking directory-sync engine.
 */
export async function pushSkillToProject(
  projectPath: string,
  sourceSkillDir: string,
  name: string,
  backupRetention?: number,
  options: PushSkillOptions = {},
): Promise<ProjectActionResult> {
  if (!existsSync(sourceSkillDir)) return { ok: false, error: `Source skill not found: ${name}` };

  if (options.mode === "link") {
    if (!options.sourceRepo) return { ok: false, error: "No source repo configured — nothing to install from" };
    return addSourceSkillsToProject(projectPath, options.sourceRepo, [name]);
  }

  const result = await directorySyncModule.apply({
    sourcePath: sourceSkillDir,
    targetPath: projectSkillDir(projectPath, name),
    owner: `project-skill:${name}`,
    backupRetention,
  });
  return result.error ? { ok: false, error: result.error } : { ok: true };
}

/**
 * The source argument `skills add` should get for the configured source repo:
 * its GitHub `owner/repo` (or other `origin` URL) so the lockfile entry is
 * restorable by teammates, else the local path (works, but only here).
 */
export function skillsSourceForRepo(sourceRepo: string): { source: string; warning?: string } {
  let origin = "";
  try {
    origin = execFileSync("git", ["-C", sourceRepo, "remote", "get-url", "origin"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    }).trim();
  } catch {
    origin = "";
  }
  if (!origin) {
    return {
      source: sourceRepo,
      warning: `${sourceRepo} has no git remote; skills-lock.json records a local path teammates can't restore`,
    };
  }
  const gh = origin.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  return { source: gh ? `${gh[1]}/${gh[2]}` : origin };
}

/**
 * Install source-repo skills into a project with the vendored skills CLI
 * (`skills add <source> --skill … -a … -y`, run in the project). The CLI
 * writes `skills-lock.json`, the store copy, and the agent symlinks.
 */
export async function addSourceSkillsToProject(
  projectPath: string,
  sourceRepo: string,
  names: string[],
): Promise<ProjectActionResult> {
  if (names.length === 0) return { ok: true };
  const { source, warning } = skillsSourceForRepo(sourceRepo);
  const args = ["add", source, "-y", ...names.flatMap((n) => ["--skill", n])];
  if (isGlobalWorkspace(projectPath)) args.push("-g");
  for (const agent of enabledSkillAgents()) args.push("-a", agent);
  const result = await runSkillsCli(args, { cwd: projectPath });
  if (result.code !== 0) return { ok: false, error: summarizeCliFailure(result), warnings: warning ? [warning] : undefined };
  return { ok: true, warnings: warning ? [warning] : undefined };
}

/**
 * Pull a project skill back into the source repo (capture project edits). When
 * the skill has no source counterpart yet it is created under `skills/<name>`.
 * Committing is left to the existing source-repo git controls.
 */
export async function pullSkillToSource(
  sourceRepo: string,
  projectSkillDir: string,
  name: string,
  existingSourceDir?: string,
  backupRetention?: number,
): Promise<ProjectActionResult> {
  if (!existsSync(projectSkillDir)) return { ok: false, error: `Project skill not found: ${name}` };
  const target = existingSourceDir ?? join(sourceRepo, "skills", name);
  const result = await directorySyncModule.apply({
    sourcePath: projectSkillDir,
    targetPath: target,
    owner: `source-skill:${name}`,
    backupRetention,
  });
  return result.error ? { ok: false, error: result.error } : { ok: true };
}

/** Enable/disable a project skill by moving it between the two sibling roots. */
export function toggleProjectSkill(
  projectPath: string,
  name: string,
  currentlyEnabled: boolean,
): ProjectActionResult {
  // Global skills belong to the skills CLI; parking one in a Blackbook-only
  // sibling dir would fight `skills update -g`. Use `blackbook skills remove -g`.
  if (isGlobalWorkspace(projectPath) && isSymlink(projectSkillDir(projectPath, name, currentlyEnabled))) {
    return { ok: false, error: "Global skills are managed by the skills CLI — use `blackbook skills remove -g`" };
  }
  const from = projectSkillDir(projectPath, name, currentlyEnabled);
  const to = projectSkillDir(projectPath, name, !currentlyEnabled);
  if (!existsSync(from)) return { ok: false, error: `Skill not found: ${name}` };
  if (existsSync(to)) return { ok: false, error: `Target already exists: ${name}` };
  mkdirSync(dirname(to), { recursive: true });
  renameOrCopy(from, to);
  return { ok: true };
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Remove a project skill; never touches the source repo. A symlinked skill
 * (installed through the skills CLI) is removed with `skills remove`, which
 * drops the lockfile entry and its links and leaves the shared store copy for
 * other projects; a vendored copy is backed up and deleted.
 */
export async function deleteProjectSkill(
  skillDir: string,
  name: string,
  backupRetention?: number,
): Promise<ProjectActionResult> {
  if (!existsSync(skillDir) && !isSymlink(skillDir)) return { ok: false, error: `Skill not found: ${name}` };

  if (isSymlink(skillDir)) {
    // `<project>/.agents/skills[-disabled]/<name>` → `<project>`
    const projectPath = resolve(skillDir, "..", "..", "..");
    const args = ["remove", name, "-y"];
    if (isGlobalWorkspace(projectPath)) args.push("-g");
    const result = await runSkillsCli(args, { cwd: projectPath });
    if (result.code !== 0) return { ok: false, error: summarizeCliFailure(result) };
    // A parked skill lives in `.agents/skills-disabled`, which the CLI doesn't scan.
    if (isSymlink(skillDir)) rmSync(skillDir, { force: true });
    return { ok: true };
  }

  createBackup(skillDir, `project-skill-del:${name}`);
  pruneBackups(`project-skill-del:${name}`, backupRetention);
  rmSync(skillDir, { recursive: true, force: true });
  return { ok: true };
}
