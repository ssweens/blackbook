import { statSync } from "fs";
import type { Store, SliceCreator } from "./types.js";
import { join } from "path";
import { getProjects, collectUnmanagedSkills, indexSourceSkills, buildWorkspaceInfo } from "../projects.js";
import {
  recordRecentWorkspace,
  removeRecentWorkspace as removeRecentWorkspaceFs,
} from "../recent-workspaces.js";
import {
  pushSkillToProject,
  pullSkillToSource,
  toggleProjectSkill as toggleProjectSkillFs,
  deleteProjectSkill as deleteProjectSkillFs,
  addSourceSkillsToProject,
} from "../project-actions.js";
import { commitAndPushSourceRepo } from "../install.js";
import { commitLockFiles } from "../lock-commit.js";
import { loadConfig as loadYamlConfig } from "../config/loader.js";
import { saveConfig as saveYamlConfig } from "../config/writer.js";
import { getConfigRepoPath, getProjectSkillMode, getToolInstances } from "../config.js";
import {
  applyProfileToWorkspace,
  buildProfileLock,
  deleteProfileLock,
  isGlobalWorkspace,
  isValidProfileName,
  listProfileLocks,
  workspaceCoverage,
  workspaceLock,
  writeProfileLock,
  lockAsProfile,
  markProfileApplied,
  profileLockPath,
  type SkillLockFile,
} from "../skill-profiles.js";
import { expandPath } from "../config/path.js";

export type ProjectsSlice = Pick<
  Store,
  // state
  | "projects"
  | "projectsLoaded"
  | "projectDetailPath"
  | "profiles"
  | "profileLocks"
  // actions
  | "loadProjects"
  | "addProject"
  | "removeProject"
  | "openWorkspace"
  | "removeRecentWorkspace"
  | "setProjectDetailPath"
  | "pushProjectSkill"
  | "pullProjectSkill"
  | "toggleProjectSkill"
  | "removeProjectSkill"
  | "adoptUnmanagedSkills"
  | "applyProfile"
  | "saveProfile"
  | "saveLockAsProfile"
  | "setSkillProfiles"
  | "deleteProfile"
  | "profilesEditing"
  | "setProfilesEditing"
>;

/**
 * Auto-commit a profile lock to the source repo and push it (profiles live in
 * a shared repo, so other machines and teammates should get them). Best-effort;
 * a push failure is surfaced via `notify` but never blocks the save.
 */
async function commitProfiles(sourceRepo: string, names: string[], verb: string, notify: Store["notify"]): Promise<void> {
  if (names.length === 0) return;
  const result = await commitLockFiles(
    names.map((n) => profileLockPath(sourceRepo, n)),
    `chore(profiles): ${verb} ${names.join(", ")}`,
    { push: true },
  );
  if (result.committed && !result.pushed && result.pushError) {
    notify(`Committed ${names.join(", ")} locally; push failed: ${result.pushError.split("\n")[0]}`, "warning");
  }
}

/** Auto-commit a workspace's skills-lock.json in its own repo (commit only, no push). */
async function commitWorkspaceLock(workspacePath: string): Promise<void> {
  await commitLockFiles([join(workspacePath, "skills-lock.json")], "chore(skills): update skills-lock.json", { push: false });
}

/** The workspace directory a project skill dir belongs to (`<ws>/.agents/skills/<name>`). */
function workspaceDirForSkill(skillDir: string): string | null {
  const i = skillDir.indexOf("/.agents/");
  return i >= 0 ? skillDir.slice(0, i) : null;
}

function backupRetention(): number | undefined {
  return loadYamlConfig().config.settings.backup_retention;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export const createProjectsSlice: SliceCreator<ProjectsSlice> = (set, get) => ({
  projects: [],
  projectsLoaded: false,
  projectDetailPath: null,
  profiles: {},
  profileLocks: {},
  profilesEditing: false,

  setProfilesEditing: (editing) => set({ profilesEditing: editing }),

  setProjectDetailPath: (path) => set({ projectDetailPath: path }),

  loadProjects: async (options) => {
    const silent = options?.silent === true;
    if (!silent && !get().projectsLoaded) set({ projectsLoaded: false });
    // Scanning is synchronous but can hit the disk for many skills; yield so the
    // UI can paint a loading state first.
    await new Promise<void>((r) => setImmediate(r));
    const { profiles, profileLocks, coverageLocks } = loadAllProfiles();
    const projects = getProjects().map((p) => ({
      ...p,
      profileCoverage: safeCoverage(p.path, coverageLocks),
      lockEntries: safeLockCount(p.path),
    }));
    set({ projects, profiles, profileLocks, projectsLoaded: true });
  },

  addProject: async (path) => {
    const { notify } = get();
    const expanded = expandPath(path);
    if (!isDirectory(expanded)) {
      notify(`Not a directory: ${path}`, "error");
      return false;
    }

    const { config, configPath } = loadYamlConfig();
    if (config.projects.some((p) => expandPath(p.path) === expanded)) {
      notify(`Project already registered: ${expanded}`, "warning");
      return false;
    }

    try {
      // Store the path as the user gave it (keeps `~` portable across machines,
      // like source_repo); dedupe compares the expanded form.
      saveYamlConfig({ ...config, projects: [...config.projects, { path }] }, configPath);
    } catch (err) {
      notify(`Failed to add project: ${err instanceof Error ? err.message : String(err)}`, "error");
      return false;
    }

    await get().loadProjects({ silent: true });
    notify(`Added project ${expanded}`, "success");
    return true;
  },

  openWorkspace: async (path) => {
    const { notify } = get();
    const expanded = expandPath(path);
    if (!isDirectory(expanded)) {
      notify(`Not a directory: ${path}`, "error");
      return false;
    }

    // Make sure the registered/synthetic set is known before deciding whether
    // this dir is already a workspace (startup calls this before any load).
    if (!get().projectsLoaded) await get().loadProjects({ silent: true });

    // Switch tabs first: setTab clears projectDetailPath, so the drill-in
    // target must be set after.
    get().setTab("projects");

    const existing = get().projects.find((p) => p.path === expanded);
    if (existing) {
      set({ projectDetailPath: expanded });
      return true;
    }

    recordRecentWorkspace(expanded);
    const info = buildWorkspaceInfo(expanded);
    set({ projects: [...get().projects, info], projectDetailPath: expanded });
    return true;
  },

  removeRecentWorkspace: async (path) => {
    const expanded = expandPath(path);
    removeRecentWorkspaceFs(expanded);
    set({
      projects: get().projects.filter((p) => !(p.transient && p.path === expanded)),
      projectDetailPath: get().projectDetailPath === expanded ? null : get().projectDetailPath,
    });
    get().notify(`Removed ${expanded} from recent workspaces`, "success");
    return true;
  },

  removeProject: async (path) => {
    const { notify } = get();
    const expanded = expandPath(path);
    const { config, configPath } = loadYamlConfig();
    const next = config.projects.filter((p) => expandPath(p.path) !== expanded);
    if (next.length === config.projects.length) {
      notify(`Project not registered: ${expanded}`, "warning");
      return false;
    }

    try {
      saveYamlConfig({ ...config, projects: next }, configPath);
    } catch (err) {
      notify(`Failed to remove project: ${err instanceof Error ? err.message : String(err)}`, "error");
      return false;
    }

    await get().loadProjects({ silent: true });
    notify(`Removed project ${expanded}`, "success");
    return true;
  },

  pushProjectSkill: async (projectPath, name, sourceSkillDir) => {
    const { notify } = get();
    const mode = getProjectSkillMode();
    const result = await pushSkillToProject(projectPath, sourceSkillDir, name, backupRetention(), {
      mode,
      sourceRepo: getConfigRepoPath(),
    });
    if (!result.ok) {
      notify(`Push failed: ${result.error}`, "error");
      return false;
    }
    await commitWorkspaceLock(projectPath);
    await get().loadProjects({ silent: true });
    if (result.warnings?.length) notify(result.warnings[0], "warning");
    else notify(mode === "link" ? `Installed ${name} (skills-lock.json, linked from the central store)` : `Pushed ${name} into workspace`, "success");
    return true;
  },

  pullProjectSkill: async (projectPath, name, projectSkillDir, sourceSkillDir) => {
    const { notify } = get();
    const sourceRepo = getConfigRepoPath();
    if (!sourceRepo) {
      notify("No source repo configured — can't pull", "error");
      return false;
    }
    const result = await pullSkillToSource(sourceRepo, projectSkillDir, name, sourceSkillDir, backupRetention());
    if (!result.ok) {
      notify(`Pull failed: ${result.error}`, "error");
      return false;
    }
    await get().loadProjects({ silent: true });
    notify(`Pulled ${name} to source repo`, "success");
    return true;
  },

  toggleProjectSkill: async (projectPath, name, currentlyEnabled) => {
    const { notify } = get();
    const result = toggleProjectSkillFs(projectPath, name, currentlyEnabled);
    if (!result.ok) {
      notify(`Toggle failed: ${result.error}`, "error");
      return false;
    }
    await commitWorkspaceLock(projectPath);
    await get().loadProjects({ silent: true });
    notify(`${currentlyEnabled ? "Disabled" : "Enabled"} ${name}`, "success");
    return true;
  },

  removeProjectSkill: async (name, skillDir) => {
    const { notify } = get();
    const result = await deleteProjectSkillFs(skillDir, name, backupRetention());
    if (!result.ok) {
      notify(`Delete failed: ${result.error}`, "error");
      return false;
    }
    const workspace = workspaceDirForSkill(skillDir);
    if (workspace) await commitWorkspaceLock(workspace);
    await get().loadProjects({ silent: true });
    notify(`Removed ${name} from workspace`, "success");
    return true;
  },

  adoptUnmanagedSkills: async () => {
    const { notify } = get();
    const sourceRepo = getConfigRepoPath();
    if (!sourceRepo) {
      notify("No source repo configured — can't adopt", "error");
      return false;
    }
    const unmanaged = collectUnmanagedSkills(get().projects);
    if (unmanaged.length === 0) {
      notify("No unmanaged skills to adopt", "info");
      return false;
    }

    const retention = backupRetention();
    const adoptedPaths: string[] = [];
    const failures: string[] = [];
    for (const skill of unmanaged) {
      const result = await pullSkillToSource(sourceRepo, skill.fromPath, skill.name, undefined, retention);
      if (result.ok) adoptedPaths.push(join(sourceRepo, "skills", skill.name));
      else failures.push(skill.name);
    }

    if (adoptedPaths.length > 0) {
      // Durable: commit the newly-adopted skills to the source repo (best-effort push).
      commitAndPushSourceRepo(sourceRepo, adoptedPaths, `chore: adopt ${adoptedPaths.length} skill(s) into library`);
    }

    await get().loadProjects({ silent: true });
    if (failures.length > 0) {
      notify(`Adopted ${adoptedPaths.length}; failed: ${failures.slice(0, 3).join(", ")}`, "error");
    } else {
      notify(`Adopted ${adoptedPaths.length} skill(s) into the source repo`, "success");
    }
    return adoptedPaths.length > 0;
  },

  applyProfile: async (workspacePath, name) => {
    const { notify } = get();
    const sourceRepo = getConfigRepoPath();
    const lock = get().profileLocks[name] ?? legacyProfileLock(name, sourceRepo);
    if (!lock || Object.keys(lock.skills).length === 0) {
      notify(`Profile "${name}" is empty`, "warning");
      return false;
    }

    // Legacy vendored-copy mode for projects: copy source-repo skills as before.
    if (getProjectSkillMode() === "copy" && !isGlobalWorkspace(workspacePath)) {
      if (!sourceRepo) {
        notify("No source repo configured — can't apply a profile in copy mode", "error");
        return false;
      }
      const sourceIndex = indexSourceSkills(sourceRepo);
      let applied = 0;
      for (const skillName of Object.keys(lock.skills)) {
        const dir = sourceIndex.get(skillName);
        if (!dir) continue;
        const result = await pushSkillToProject(workspacePath, dir, skillName, backupRetention(), { mode: "copy" });
        if (result.ok) applied += 1;
      }
      await get().loadProjects({ silent: true });
      notify(`Applied profile "${name}" (${applied} copied)`, applied > 0 ? "success" : "warning");
      return applied > 0;
    }

    const result = await applyProfileToWorkspace(workspacePath, name, lock, getToolInstances());
    if (!isGlobalWorkspace(workspacePath)) await commitWorkspaceLock(workspacePath);
    await get().loadProjects({ silent: true });
    if (result.errors.length > 0) {
      notify(`Applied "${name}": +${result.added.length} −${result.removed.length}; failed — ${result.errors[0]}`, "error");
      return result.added.length + result.removed.length > 0;
    }
    if (result.added.length === 0 && result.removed.length === 0) {
      notify(`"${name}" is already up to date here`, "success");
      return true;
    }
    notify(`Applied "${name}": +${result.added.length} added, −${result.removed.length} removed`, "success");
    return true;
  },

  saveProfile: async (name, skills, previousName) => {
    const { notify } = get();
    const trimmed = name.trim();
    if (!trimmed || !isValidProfileName(trimmed)) {
      notify("Profile names are letters, digits, space, dot, dash, or underscore", "error");
      return false;
    }
    const sourceRepo = getConfigRepoPath();
    if (!sourceRepo) {
      notify("No source repo configured — profiles live in <source repo>/profiles/", "error");
      return false;
    }
    const own = get().profileLocks[previousName ?? trimmed] ?? get().profileLocks[trimmed];
    // A skill picked from another profile keeps that profile's source; this
    // profile's own entries win.
    const known = Object.assign({}, ...Object.values(get().profileLocks).map((l) => l.skills), own?.skills ?? {});
    const { lock, unresolved } = buildProfileLock(skills, sourceRepo, { version: 1, skills: known });
    try {
      writeProfileLock(sourceRepo, trimmed, lock);
      dropLegacyProfile(trimmed);
    } catch (err) {
      notify(`Failed to save profile: ${err instanceof Error ? err.message : String(err)}`, "error");
      return false;
    }
    await commitProfiles(sourceRepo, [trimmed], "save", notify);
    await get().loadProjects({ silent: true });
    const count = Object.keys(lock.skills).length;
    notify(
      unresolved.length > 0
        ? `Saved "${trimmed}" (${count}); no known source for: ${unresolved.slice(0, 3).join(", ")}`
        : `Saved profile "${trimmed}" (${count} skill${count === 1 ? "" : "s"}) to profiles/${trimmed}.skills-lock.json`,
      unresolved.length > 0 ? "warning" : "success",
    );
    return true;
  },

  saveLockAsProfile: async (workspace, name) => {
    const { notify } = get();
    const trimmed = name.trim();
    if (!trimmed || !isValidProfileName(trimmed)) {
      notify("Profile names are letters, digits, space, dot, dash, or underscore", "error");
      return false;
    }
    const sourceRepo = getConfigRepoPath();
    if (!sourceRepo) {
      notify("No source repo configured — profiles live in <source repo>/profiles/", "error");
      return false;
    }
    if (get().profileLocks[trimmed] || get().profiles[trimmed]) {
      notify(`Profile "${trimmed}" already exists — pick another name`, "error");
      return false;
    }
    const { lock, localOnly } = lockAsProfile(workspace, sourceRepo);
    const names = Object.keys(lock.skills);
    if (names.length === 0) {
      notify("This workspace's skills lock is empty — nothing to save", "warning");
      return false;
    }
    try {
      writeProfileLock(sourceRepo, trimmed, lock);
      markProfileApplied(workspace, trimmed, names);
    } catch (err) {
      notify(`Failed to save profile: ${err instanceof Error ? err.message : String(err)}`, "error");
      return false;
    }
    await commitProfiles(sourceRepo, [trimmed], "save", notify);
    await get().loadProjects({ silent: true });
    notify(
      localOnly.length > 0
        ? `Saved "${trimmed}" (${names.length}); local paths only work on this machine: ${localOnly.slice(0, 3).join(", ")}`
        : `Saved profile "${trimmed}" (${names.length} skill${names.length === 1 ? "" : "s"}) to profiles/${trimmed}.skills-lock.json`,
      localOnly.length > 0 ? "warning" : "success",
    );
    return true;
  },

  setSkillProfiles: async (skill, members) => {
    const { notify, profiles, profileLocks } = get();
    const sourceRepo = getConfigRepoPath();
    if (!sourceRepo) {
      notify("No source repo configured — profiles live in <source repo>/profiles/", "error");
      return false;
    }
    const want = new Set(members);
    const addTo = Object.keys(profiles).filter((p) => want.has(p) && !profiles[p].includes(skill));
    const removeFrom = Object.keys(profiles).filter((p) => !want.has(p) && profiles[p].includes(skill));
    if (addTo.length === 0 && removeFrom.length === 0) {
      notify(`No profile changes for ${skill}`, "info");
      return true;
    }
    // Where the skill comes from: any profile that already has it, then the global lock or source repo.
    const known: SkillLockFile = { version: 1, skills: Object.assign({}, ...Object.values(profileLocks).map((l) => l.skills)) };
    const { lock: resolved, unresolved } = buildProfileLock([skill], sourceRepo, known);
    if (addTo.length > 0 && unresolved.length > 0) {
      notify(`No known source for ${skill} — add it to the source repo or install it with the skills CLI first`, "error");
      return false;
    }
    const failed: string[] = [];
    for (const name of [...addTo, ...removeFrom]) {
      // Legacy config.yaml profiles convert to a file on first change.
      const base = profileLocks[name] ?? buildProfileLock(profiles[name], sourceRepo, known).lock;
      const skills = { ...base.skills };
      if (addTo.includes(name)) skills[skill] = resolved.skills[skill];
      else delete skills[skill];
      try {
        writeProfileLock(sourceRepo, name, { version: 1, skills });
        dropLegacyProfile(name);
      } catch (err) {
        failed.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await commitProfiles(sourceRepo, [...addTo, ...removeFrom], "update", notify);
    await get().loadProjects({ silent: true });
    const parts = [
      addTo.length ? `added to ${addTo.join(", ")}` : "",
      removeFrom.length ? `removed from ${removeFrom.join(", ")}` : "",
    ].filter(Boolean);
    if (failed.length > 0) {
      notify(`Failed to update profiles: ${failed.join("; ")}`, "error");
      return false;
    }
    notify(`${skill}: ${parts.join("; ")}`, "success");
    return true;
  },

  deleteProfile: async (name) => {
    const { notify } = get();
    const sourceRepo = getConfigRepoPath();
    const removedFile = sourceRepo ? deleteProfileLock(sourceRepo, name) : false;
    const removedLegacy = dropLegacyProfile(name);
    if (!removedFile && !removedLegacy) {
      notify(`Profile "${name}" not found`, "warning");
      return false;
    }
    if (removedFile && sourceRepo) await commitProfiles(sourceRepo, [name], "delete", notify);
    await get().loadProjects({ silent: true });
    notify(`Deleted profile "${name}"`, "success");
    return true;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Profile loading helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Legacy config `profiles:` (skill names) as a lock, resolved on demand. */
function legacyProfileLock(name: string, sourceRepo: string | null): SkillLockFile | null {
  const names = loadYamlConfig().config.profiles?.[name];
  return names ? buildProfileLock(names, sourceRepo).lock : null;
}

/** Remove a legacy config profile; true when one existed. */
function dropLegacyProfile(name: string): boolean {
  const { config, configPath } = loadYamlConfig();
  if (!config.profiles || !(name in config.profiles)) return false;
  const { [name]: _removed, ...rest } = config.profiles;
  saveYamlConfig({ ...config, profiles: rest }, configPath);
  return true;
}

function loadAllProfiles(): {
  profiles: Record<string, string[]>;
  profileLocks: Record<string, SkillLockFile>;
  coverageLocks: Record<string, SkillLockFile>;
} {
  const sourceRepo = getConfigRepoPath();
  const profileLocks = listProfileLocks(sourceRepo);
  const profiles: Record<string, string[]> = {};
  const coverageLocks: Record<string, SkillLockFile> = { ...profileLocks };
  for (const [name, names] of Object.entries(loadYamlConfig().config.profiles ?? {})) {
    if (name in profileLocks) continue;
    profiles[name] = [...names];
    const legacy = legacyProfileLock(name, sourceRepo);
    if (legacy) coverageLocks[name] = legacy;
  }
  for (const [name, lock] of Object.entries(profileLocks)) profiles[name] = Object.keys(lock.skills).sort();
  return { profiles, profileLocks, coverageLocks };
}

function safeCoverage(path: string, locks: Record<string, SkillLockFile>) {
  try {
    return workspaceCoverage(path, locks);
  } catch {
    return [];
  }
}

function safeLockCount(path: string): number {
  try {
    return Object.keys(workspaceLock(path).skills).length;
  } catch {
    return 0;
  }
}
