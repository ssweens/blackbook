import { statSync } from "fs";
import type { Store, SliceCreator } from "./types.js";
import { join } from "path";
import { getProjects, collectUnmanagedSkills } from "../projects.js";
import {
  pushSkillToProject,
  pullSkillToSource,
  toggleProjectSkill as toggleProjectSkillFs,
  deleteProjectSkill as deleteProjectSkillFs,
} from "../project-actions.js";
import { commitAndPushSourceRepo } from "../install.js";
import { loadConfig as loadYamlConfig } from "../config/loader.js";
import { saveConfig as saveYamlConfig } from "../config/writer.js";
import { getConfigRepoPath } from "../config.js";
import { expandPath } from "../config/path.js";

export type ProjectsSlice = Pick<
  Store,
  // state
  | "projects"
  | "projectsLoaded"
  | "projectDetailPath"
  // actions
  | "loadProjects"
  | "addProject"
  | "removeProject"
  | "setProjectDetailPath"
  | "pushProjectSkill"
  | "pullProjectSkill"
  | "toggleProjectSkill"
  | "removeProjectSkill"
  | "adoptUnmanagedSkills"
>;

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

  setProjectDetailPath: (path) => set({ projectDetailPath: path }),

  loadProjects: async (options) => {
    const silent = options?.silent === true;
    if (!silent && !get().projectsLoaded) set({ projectsLoaded: false });
    // Scanning is synchronous but can hit the disk for many skills; yield so the
    // UI can paint a loading state first.
    await new Promise<void>((r) => setImmediate(r));
    set({ projects: getProjects(), projectsLoaded: true });
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
    const result = await pushSkillToProject(projectPath, sourceSkillDir, name, backupRetention());
    if (!result.ok) {
      notify(`Push failed: ${result.error}`, "error");
      return false;
    }
    await get().loadProjects({ silent: true });
    notify(`Pushed ${name} into workspace`, "success");
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
    await get().loadProjects({ silent: true });
    notify(`${currentlyEnabled ? "Disabled" : "Enabled"} ${name}`, "success");
    return true;
  },

  removeProjectSkill: async (name, skillDir) => {
    const { notify } = get();
    const result = deleteProjectSkillFs(skillDir, name, backupRetention());
    if (!result.ok) {
      notify(`Delete failed: ${result.error}`, "error");
      return false;
    }
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
});
