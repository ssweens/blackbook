import { existsSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { directorySyncModule } from "./modules/directory-sync.js";
import { createBackup, pruneBackups } from "./modules/backup.js";
import { renameOrCopy } from "./fs-utils.js";
import { PROJECT_SKILLS_SUBDIR, PROJECT_SKILLS_DISABLED_SUBDIR } from "./projects.js";

export interface ProjectActionResult {
  ok: boolean;
  error?: string;
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
): Promise<ProjectActionResult> {
  if (!existsSync(sourceSkillDir)) return { ok: false, error: `Source skill not found: ${name}` };
  const result = await directorySyncModule.apply({
    sourcePath: sourceSkillDir,
    targetPath: projectSkillDir(projectPath, name),
    owner: `project-skill:${name}`,
    backupRetention,
  });
  return result.error ? { ok: false, error: result.error } : { ok: true };
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
  const from = projectSkillDir(projectPath, name, currentlyEnabled);
  const to = projectSkillDir(projectPath, name, !currentlyEnabled);
  if (!existsSync(from)) return { ok: false, error: `Skill not found: ${name}` };
  if (existsSync(to)) return { ok: false, error: `Target already exists: ${name}` };
  mkdirSync(dirname(to), { recursive: true });
  renameOrCopy(from, to);
  return { ok: true };
}

/** Remove a project skill (backed up first); never touches the source repo. */
export function deleteProjectSkill(
  skillDir: string,
  name: string,
  backupRetention?: number,
): ProjectActionResult {
  if (!existsSync(skillDir)) return { ok: false, error: `Skill not found: ${name}` };
  createBackup(skillDir, `project-skill-del:${name}`);
  pruneBackups(`project-skill-del:${name}`, backupRetention);
  rmSync(skillDir, { recursive: true, force: true });
  return { ok: true };
}
