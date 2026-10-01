import { describe, it, expect, beforeEach, vi } from "vitest";
import { createProjectsSlice } from "./projects-slice.js";

// Mock the slice's direct dependencies so we can exercise it in isolation from
// the full composed store.
const getProjectsMock = vi.fn();
const collectUnmanagedMock = vi.fn();
const indexSourceSkillsMock = vi.fn();
const loadConfigMock = vi.fn();
const saveConfigMock = vi.fn();
const statSyncMock = vi.fn();
const pushSkillMock = vi.fn();
const addSkillsMock = vi.fn();
let projectSkillMode: "copy" | "link" = "copy";
const pullSkillMock = vi.fn();
const commitMock = vi.fn();
const buildWorkspaceInfoMock = vi.fn();
const recordRecentMock = vi.fn();
const removeRecentFsMock = vi.fn();

vi.mock("../projects.js", () => ({
  getProjects: () => getProjectsMock(),
  collectUnmanagedSkills: (...a: unknown[]) => collectUnmanagedMock(...a),
  indexSourceSkills: (...a: unknown[]) => indexSourceSkillsMock(...a),
  buildWorkspaceInfo: (...a: unknown[]) => buildWorkspaceInfoMock(...a),
}));
vi.mock("../recent-workspaces.js", () => ({
  recordRecentWorkspace: (...a: unknown[]) => recordRecentMock(...a),
  removeRecentWorkspace: (...a: unknown[]) => removeRecentFsMock(...a),
}));
vi.mock("../project-actions.js", () => ({
  pushSkillToProject: (...a: unknown[]) => pushSkillMock(...a),
  pullSkillToSource: (...a: unknown[]) => pullSkillMock(...a),
  toggleProjectSkill: vi.fn(),
  deleteProjectSkill: vi.fn(),
  addSourceSkillsToProject: (...a: unknown[]) => addSkillsMock(...a),
}));
vi.mock("../install.js", () => ({ commitAndPushSourceRepo: (...a: unknown[]) => commitMock(...a) }));
vi.mock("../config.js", () => ({
  getConfigRepoPath: () => "/src",
  getProjectSkillMode: () => projectSkillMode,
  getToolInstances: () => [],
}));
// Skill-lock profiles: in-memory stand-in for <source repo>/profiles/*.skills-lock.json.
let profileFiles: Record<string, { version: number; skills: Record<string, { source: string; sourceType: string }> }> = {};
const applyToWorkspaceMock = vi.fn();
const markAppliedMock = vi.fn();
const buildProfileLockCalls: unknown[] = [];
let lockAsProfileResult: { lock: { version: number; skills: Record<string, { source: string; sourceType: string }> }; localOnly: string[] } = { lock: { version: 1, skills: {} }, localOnly: [] };
const commitLockFilesMock = vi.fn().mockResolvedValue({ committed: true, pushed: true });
vi.mock("../lock-commit.js", () => ({
  commitLockFiles: (...a: unknown[]) => commitLockFilesMock(...a),
  findGitRoot: () => "/src",
}));
vi.mock("../skill-profiles.js", () => ({
  listProfileLocks: () => ({ ...profileFiles }),
  writeProfileLock: (_repo: string, name: string, lock: never) => {
    profileFiles[name] = lock;
  },
  deleteProfileLock: (_repo: string, name: string) => {
    const had = name in profileFiles;
    delete profileFiles[name];
    return had;
  },
  buildProfileLock: (names: string[], _repo: unknown, existing: unknown) => (buildProfileLockCalls.push(existing), {
    lock: { version: 1, skills: Object.fromEntries(names.map((n) => [n, { source: "ssweens/playbook", sourceType: "github" }])) },
    unresolved: [],
  }),
  isValidProfileName: (n: string) => /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(n),
  isGlobalWorkspace: (p: string) => p === "/home",
  applyProfileToWorkspace: (...a: unknown[]) => applyToWorkspaceMock(...a),
  workspaceCoverage: () => [],
  workspaceLock: () => ({ version: 1, skills: {} }),
  profileLockPath: (_repo: string, name: string) => `/src/profiles/${name}.skills-lock.json`,
  lockAsProfile: () => lockAsProfileResult,
  markProfileApplied: (...a: unknown[]) => markAppliedMock(...a),
}));
vi.mock("../config/loader.js", () => ({ loadConfig: () => loadConfigMock() }));
vi.mock("../config/writer.js", () => ({ saveConfig: (...a: unknown[]) => saveConfigMock(...a) }));
vi.mock("../config/path.js", () => ({ expandPath: (p: string) => p }));
vi.mock("fs", () => ({ statSync: (...a: unknown[]) => statSyncMock(...a) }));

// A minimal store harness: set() shallow-merges, get() returns the latest object.
function makeStore() {
  let state: Record<string, unknown> = {};
  const set = (partial: unknown) => {
    const patch = typeof partial === "function" ? (partial as (s: unknown) => object)(state) : partial;
    state = { ...state, ...(patch as object) };
  };
  const get = () => state as any;
  const slice = createProjectsSlice(set as any, get as any);
  state = { ...slice, notify: vi.fn(), setTab: vi.fn(), projects: [], projectsLoaded: false };
  return { get, state: () => state };
}

beforeEach(() => {
  getProjectsMock.mockReset();
  collectUnmanagedMock.mockReset();
  loadConfigMock.mockReset();
  saveConfigMock.mockReset();
  statSyncMock.mockReset();
  indexSourceSkillsMock.mockReset();
  pushSkillMock.mockReset();
  addSkillsMock.mockReset();
  projectSkillMode = "copy";
  profileFiles = {};
  applyToWorkspaceMock.mockReset();
  markAppliedMock.mockReset();
  buildProfileLockCalls.length = 0;
  commitLockFilesMock.mockClear();
  lockAsProfileResult = { lock: { version: 1, skills: {} }, localOnly: [] };
  pullSkillMock.mockReset();
  commitMock.mockReset();
  buildWorkspaceInfoMock.mockReset();
  recordRecentMock.mockReset();
  removeRecentFsMock.mockReset();
  // Default config so loadProjects() (called after mutations) can read profiles.
  loadConfigMock.mockReturnValue({ config: { projects: [], profiles: {}, settings: { backup_retention: 3 } }, configPath: "/cfg" });
});

describe("projects-slice", () => {
  it("loadProjects populates from getProjects and marks loaded", async () => {
    getProjectsMock.mockReturnValue([{ path: "/p", name: "p", exists: true, hasAgentsDir: true, skills: [], available: [] }]);
    const { get } = makeStore();
    await get().loadProjects();
    expect(get().projects).toHaveLength(1);
    expect(get().projectsLoaded).toBe(true);
  });

  it("addProject writes the appended list and reloads", async () => {
    statSyncMock.mockReturnValue({ isDirectory: () => true });
    loadConfigMock.mockReturnValue({ config: { projects: [] }, configPath: "/cfg" });
    getProjectsMock.mockReturnValue([]);
    const { get } = makeStore();

    const ok = await get().addProject("/new/proj");
    expect(ok).toBe(true);
    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    const [written] = saveConfigMock.mock.calls[0];
    expect((written as any).projects).toEqual([{ path: "/new/proj" }]);
  });

  it("addProject rejects a non-directory without writing", async () => {
    statSyncMock.mockImplementation(() => { throw new Error("ENOENT"); });
    const { get } = makeStore();
    const ok = await get().addProject("/nope");
    expect(ok).toBe(false);
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("addProject refuses a duplicate (already registered)", async () => {
    statSyncMock.mockReturnValue({ isDirectory: () => true });
    loadConfigMock.mockReturnValue({ config: { projects: [{ path: "/dup" }] }, configPath: "/cfg" });
    const { get } = makeStore();
    const ok = await get().addProject("/dup");
    expect(ok).toBe(false);
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("removeProject filters the entry and writes", async () => {
    loadConfigMock.mockReturnValue({ config: { projects: [{ path: "/a" }, { path: "/b" }] }, configPath: "/cfg" });
    getProjectsMock.mockReturnValue([]);
    const { get } = makeStore();

    const ok = await get().removeProject("/a");
    expect(ok).toBe(true);
    const [written] = saveConfigMock.mock.calls[0];
    expect((written as any).projects).toEqual([{ path: "/b" }]);
  });

  it("removeProject returns false when the path is not registered", async () => {
    loadConfigMock.mockReturnValue({ config: { projects: [{ path: "/a" }] }, configPath: "/cfg" });
    const { get } = makeStore();
    const ok = await get().removeProject("/missing");
    expect(ok).toBe(false);
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("openWorkspace on a known path drills in without touching recents", async () => {
    statSyncMock.mockReturnValue({ isDirectory: () => true });
    getProjectsMock.mockReturnValue([{ path: "/known", name: "known", exists: true, hasAgentsDir: true, skills: [], available: [] }]);
    const { get } = makeStore();

    const ok = await get().openWorkspace("/known");
    expect(ok).toBe(true);
    expect(get().setTab).toHaveBeenCalledWith("projects");
    expect(get().projectDetailPath).toBe("/known");
    expect(recordRecentMock).not.toHaveBeenCalled();
    expect(buildWorkspaceInfoMock).not.toHaveBeenCalled();
  });

  it("openWorkspace on a new dir scans it transiently and records a recent", async () => {
    statSyncMock.mockReturnValue({ isDirectory: () => true });
    getProjectsMock.mockReturnValue([]);
    const info = { path: "/new", name: "new", exists: true, hasAgentsDir: false, skills: [], available: [], transient: true };
    buildWorkspaceInfoMock.mockReturnValue(info);
    const { get } = makeStore();

    const ok = await get().openWorkspace("/new");
    expect(ok).toBe(true);
    expect(recordRecentMock).toHaveBeenCalledWith("/new");
    expect(get().projects).toEqual([info]);
    expect(get().projectDetailPath).toBe("/new");
    // Transient: nothing written to config.yaml.
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("openWorkspace rejects a non-directory", async () => {
    statSyncMock.mockImplementation(() => { throw new Error("ENOENT"); });
    const { get } = makeStore();
    const ok = await get().openWorkspace("/nope");
    expect(ok).toBe(false);
    expect(recordRecentMock).not.toHaveBeenCalled();
    expect(get().projectDetailPath).toBe(null);
  });

  it("removeRecentWorkspace drops the transient row and updates the cache", async () => {
    const { get, state } = makeStore();
    const transient = { path: "/t", name: "t", exists: true, hasAgentsDir: false, skills: [], available: [], transient: true };
    const registered = { path: "/r", name: "r", exists: true, hasAgentsDir: false, skills: [], available: [] };
    (state() as any).projects = [registered, transient];

    const ok = await get().removeRecentWorkspace("/t");
    expect(ok).toBe(true);
    expect(removeRecentFsMock).toHaveBeenCalledWith("/t");
    expect(get().projects).toEqual([registered]);
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("adoptUnmanagedSkills pulls each unmanaged skill and commits once", async () => {
    loadConfigMock.mockReturnValue({ config: { settings: { backup_retention: 3 }, projects: [] }, configPath: "/cfg" });
    collectUnmanagedMock.mockReturnValue([
      { name: "a", fromPath: "/w/a", workspace: "Global" },
      { name: "b", fromPath: "/w/b", workspace: "proj" },
    ]);
    pullSkillMock.mockResolvedValue({ ok: true });
    getProjectsMock.mockReturnValue([]);
    const { get } = makeStore();

    const ok = await get().adoptUnmanagedSkills();
    expect(ok).toBe(true);
    expect(pullSkillMock).toHaveBeenCalledTimes(2);
    expect(commitMock).toHaveBeenCalledTimes(1);
    // Committed the two adopted source paths.
    const [, paths] = commitMock.mock.calls[0];
    expect(paths).toEqual(["/src/skills/a", "/src/skills/b"]);
  });

  it("adoptUnmanagedSkills no-ops (no commit) when there is nothing unmanaged", async () => {
    collectUnmanagedMock.mockReturnValue([]);
    const { get } = makeStore();
    const ok = await get().adoptUnmanagedSkills();
    expect(ok).toBe(false);
    expect(pullSkillMock).not.toHaveBeenCalled();
    expect(commitMock).not.toHaveBeenCalled();
  });

  it("loadProjects reads profiles from skill-lock files, with legacy config profiles alongside", async () => {
    profileFiles = { web: { version: 1, skills: { b: { source: "x/y", sourceType: "github" }, a: { source: "x/y", sourceType: "github" } } } };
    loadConfigMock.mockReturnValue({ config: { projects: [], profiles: { old: ["z"], web: ["ignored"] }, settings: {} }, configPath: "/cfg" });
    getProjectsMock.mockReturnValue([]);
    const { get } = makeStore();
    await get().loadProjects();
    expect(get().profiles).toEqual({ web: ["a", "b"], old: ["z"] });
    expect(Object.keys(get().profileLocks)).toEqual(["web"]);
  });

  it("applyProfile (link mode) applies the profile's lock entries to the workspace", async () => {
    projectSkillMode = "link";
    profileFiles = { web: { version: 1, skills: { a: { source: "x/y", sourceType: "github" } } } };
    getProjectsMock.mockReturnValue([]);
    applyToWorkspaceMock.mockResolvedValue({ added: ["a"], removed: [], errors: [] });
    const { get } = makeStore();
    await get().loadProjects();
    expect(await get().applyProfile("/ws", "web")).toBe(true);
    expect(applyToWorkspaceMock).toHaveBeenCalledWith("/ws", "web", profileFiles.web, []);
    expect(get().notify).toHaveBeenLastCalledWith(expect.stringContaining("+1 added"), "success");
  });

  it("pushProjectSkill commits the workspace skills-lock.json without pushing", async () => {
    pushSkillMock.mockResolvedValue({ ok: true });
    getProjectsMock.mockReturnValue([]);
    const { get } = makeStore();
    expect(await get().pushProjectSkill("/ws", "a", "/src/skills/a")).toBe(true);
    expect(commitLockFilesMock).toHaveBeenCalledWith(["/ws/skills-lock.json"], expect.any(String), { push: false });
  });

  it("applyProfile in copy mode still copies source-repo skills into a project", async () => {
    profileFiles = { web: { version: 1, skills: { a: { source: "x/y", sourceType: "github" }, missing: { source: "x/y", sourceType: "github" } } } };
    indexSourceSkillsMock.mockReturnValue(new Map([["a", "/src/skills/a"]]));
    pushSkillMock.mockResolvedValue({ ok: true });
    getProjectsMock.mockReturnValue([]);
    const { get } = makeStore();
    await get().loadProjects();
    expect(await get().applyProfile("/ws", "web")).toBe(true);
    expect(pushSkillMock).toHaveBeenCalledTimes(1);
    expect(pushSkillMock).toHaveBeenCalledWith("/ws", "/src/skills/a", "a", 3, { mode: "copy" });
    expect(applyToWorkspaceMock).not.toHaveBeenCalled();
  });

  it("applyProfile warns and no-ops for an empty/unknown profile", async () => {
    getProjectsMock.mockReturnValue([]);
    const { get } = makeStore();
    expect(await get().applyProfile("/ws", "nope")).toBe(false);
    expect(applyToWorkspaceMock).not.toHaveBeenCalled();
    expect(get().notify).toHaveBeenCalledWith(expect.stringContaining("empty"), "warning");
  });

  it("saveProfile writes a skill-lock profile file and drops a same-named legacy config profile", async () => {
    loadConfigMock.mockReturnValue({ config: { projects: [], profiles: { web: ["a"] }, settings: {} }, configPath: "/cfg" });
    getProjectsMock.mockReturnValue([]);
    const { get } = makeStore();
    expect(await get().saveProfile("web", ["a", "b"])).toBe(true);
    expect(Object.keys(profileFiles.web.skills)).toEqual(["a", "b"]);
    expect(saveConfigMock).toHaveBeenCalledWith(expect.objectContaining({ profiles: {} }), "/cfg");
    // Auto-committed to the source repo and pushed.
    expect(commitLockFilesMock).toHaveBeenCalledWith(["/src/profiles/web.skills-lock.json"], expect.stringContaining("save web"), { push: true });
  });

  it("saveProfile resolves sources from every profile, with the edited profile's own entries winning", async () => {
    getProjectsMock.mockReturnValue([]);
    profileFiles = {
      Docs: { version: 1, skills: { docx: { source: "anthropics/skills", sourceType: "github" }, shared: { source: "other/docs", sourceType: "github" } } },
      Coding: { version: 1, skills: { shared: { source: "mine/coding", sourceType: "github" } } },
    };
    const { get } = makeStore();
    await get().loadProjects({ silent: true });
    expect(await get().saveProfile("Coding", ["docx", "shared"])).toBe(true);
    expect(buildProfileLockCalls.at(-1)).toEqual({
      version: 1,
      skills: { docx: { source: "anthropics/skills", sourceType: "github" }, shared: { source: "mine/coding", sourceType: "github" } },
    });
  });

  it("setSkillProfiles adds a skill to checked profiles and removes it from unchecked ones, in one pass", async () => {
    getProjectsMock.mockReturnValue([]);
    profileFiles = {
      Coding: { version: 1, skills: { deslop: { source: "ssweens/playbook", sourceType: "github" } } },
      UI: { version: 1, skills: {} },
      Docs: { version: 1, skills: { "blast-radius": { source: "ssweens/playbook", sourceType: "github" }, pdf: { source: "anthropics/skills", sourceType: "github" } } },
    };
    const { get } = makeStore();
    await get().loadProjects({ silent: true });
    expect(await get().setSkillProfiles("blast-radius", ["Coding", "UI"])).toBe(true);
    expect(Object.keys(profileFiles.Coding.skills).sort()).toEqual(["blast-radius", "deslop"]);
    expect(Object.keys(profileFiles.UI.skills)).toEqual(["blast-radius"]);
    expect(Object.keys(profileFiles.Docs.skills)).toEqual(["pdf"]);
    expect(get().notify).toHaveBeenCalledWith("blast-radius: added to Coding, UI; removed from Docs", "success");
  });

  it("setSkillProfiles with no changes writes nothing", async () => {
    getProjectsMock.mockReturnValue([]);
    profileFiles = { Coding: { version: 1, skills: { deslop: { source: "ssweens/playbook", sourceType: "github" } } } };
    const { get } = makeStore();
    await get().loadProjects({ silent: true });
    const before = JSON.stringify(profileFiles);
    expect(await get().setSkillProfiles("deslop", ["Coding"])).toBe(true);
    expect(JSON.stringify(profileFiles)).toBe(before);
    expect(get().notify).toHaveBeenCalledWith("No profile changes for deslop", "info");
  });

  it("saveProfile rejects an empty or invalid name without writing", async () => {
    const { get } = makeStore();
    expect(await get().saveProfile("   ", ["a"])).toBe(false);
    expect(await get().saveProfile("../x", ["a"])).toBe(false);
    expect(profileFiles).toEqual({});
  });

  it("saveLockAsProfile writes the workspace lock as a new profile and marks it applied there", async () => {
    getProjectsMock.mockReturnValue([]);
    lockAsProfileResult = { lock: { version: 1, skills: { a: { source: "x/y", sourceType: "github" } } }, localOnly: [] };
    const { get } = makeStore();
    expect(await get().saveLockAsProfile("/ws", " web ")).toBe(true);
    expect(profileFiles.web).toEqual(lockAsProfileResult.lock);
    expect(markAppliedMock).toHaveBeenCalledWith("/ws", "web", ["a"]);
    expect(get().notify).toHaveBeenCalledWith(expect.stringContaining('Saved profile "web" (1 skill)'), "success");
  });

  it("saveLockAsProfile never overwrites an existing profile and refuses an empty lock", async () => {
    getProjectsMock.mockReturnValue([]);
    profileFiles = { web: { version: 1, skills: {} } };
    const { get } = makeStore();
    await get().loadProjects({ silent: true });
    lockAsProfileResult = { lock: { version: 1, skills: { a: { source: "x/y", sourceType: "github" } } }, localOnly: [] };
    expect(await get().saveLockAsProfile("/ws", "web")).toBe(false);
    expect(profileFiles.web.skills).toEqual({});
    lockAsProfileResult = { lock: { version: 1, skills: {} }, localOnly: [] };
    expect(await get().saveLockAsProfile("/ws", "other")).toBe(false);
    expect(profileFiles.other).toBeUndefined();
    expect(markAppliedMock).not.toHaveBeenCalled();
  });

  it("saveLockAsProfile warns about machine-local sources", async () => {
    getProjectsMock.mockReturnValue([]);
    lockAsProfileResult = { lock: { version: 1, skills: { a: { source: "/abs/a", sourceType: "local" } } }, localOnly: ["a"] };
    const { get } = makeStore();
    expect(await get().saveLockAsProfile("/ws", "web")).toBe(true);
    expect(get().notify).toHaveBeenCalledWith(expect.stringContaining("only work on this machine: a"), "warning");
  });

  it("deleteProfile removes the profile file", async () => {
    profileFiles = { web: { version: 1, skills: {} } };
    getProjectsMock.mockReturnValue([]);
    const { get } = makeStore();
    expect(await get().deleteProfile("web")).toBe(true);
    expect(profileFiles).toEqual({});
  });

  it("deleteProfile no-ops for an unknown profile", async () => {
    const { get } = makeStore();
    expect(await get().deleteProfile("nope")).toBe(false);
    expect(get().notify).toHaveBeenCalledWith(expect.stringContaining("not found"), "warning");
  });
});
