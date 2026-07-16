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
const pullSkillMock = vi.fn();
const commitMock = vi.fn();

vi.mock("../projects.js", () => ({
  getProjects: () => getProjectsMock(),
  collectUnmanagedSkills: (...a: unknown[]) => collectUnmanagedMock(...a),
  indexSourceSkills: (...a: unknown[]) => indexSourceSkillsMock(...a),
}));
vi.mock("../project-actions.js", () => ({
  pushSkillToProject: (...a: unknown[]) => pushSkillMock(...a),
  pullSkillToSource: (...a: unknown[]) => pullSkillMock(...a),
  toggleProjectSkill: vi.fn(),
  deleteProjectSkill: vi.fn(),
}));
vi.mock("../install.js", () => ({ commitAndPushSourceRepo: (...a: unknown[]) => commitMock(...a) }));
vi.mock("../config.js", () => ({ getConfigRepoPath: () => "/src" }));
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
  state = { ...slice, notify: vi.fn(), projects: [], projectsLoaded: false };
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
  pullSkillMock.mockReset();
  commitMock.mockReset();
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

  it("applyProfile pushes each profile skill that exists in source, skipping the rest", async () => {
    // Profiles come from store state, populated by loadProjects from config.
    loadConfigMock.mockReturnValue({
      config: { projects: [], profiles: { web: ["a", "b", "missing"] }, settings: { backup_retention: 3 } },
      configPath: "/cfg",
    });
    indexSourceSkillsMock.mockReturnValue(new Map([["a", "/src/skills/a"], ["b", "/src/skills/b"]]));
    pushSkillMock.mockResolvedValue({ ok: true });
    getProjectsMock.mockReturnValue([]);
    const { get } = makeStore();
    await get().loadProjects(); // populates state.profiles

    const ok = await get().applyProfile("/ws", "web");
    expect(ok).toBe(true);
    // 'a' and 'b' pushed; 'missing' skipped (not in source index).
    expect(pushSkillMock).toHaveBeenCalledTimes(2);
    expect(pushSkillMock).toHaveBeenCalledWith("/ws", "/src/skills/a", "a", 3);
    expect(pushSkillMock).toHaveBeenCalledWith("/ws", "/src/skills/b", "b", 3);
  });

  it("applyProfile warns and no-ops for an empty/unknown profile", async () => {
    getProjectsMock.mockReturnValue([]);
    const { get } = makeStore();
    await get().loadProjects(); // profiles = {} (default mock)
    const ok = await get().applyProfile("/ws", "nope");
    expect(ok).toBe(false);
    expect(pushSkillMock).not.toHaveBeenCalled();
  });
});
