import { statSync } from "fs";
import type { Store, SliceCreator } from "./types.js";
import { getProjects } from "../projects.js";
import { loadConfig as loadYamlConfig } from "../config/loader.js";
import { saveConfig as saveYamlConfig } from "../config/writer.js";
import { expandPath } from "../config/path.js";

export type ProjectsSlice = Pick<
  Store,
  // state
  | "projects"
  | "projectsLoaded"
  // actions
  | "loadProjects"
  | "addProject"
  | "removeProject"
>;

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
});
