import { describe, it, expect, beforeEach, vi } from "vitest";
import { createProjectsSlice } from "./projects-slice.js";

// Mock the slice's direct dependencies so we can exercise it in isolation from
// the full composed store.
const getProjectsMock = vi.fn();
const loadConfigMock = vi.fn();
const saveConfigMock = vi.fn();
const statSyncMock = vi.fn();

vi.mock("../projects.js", () => ({ getProjects: () => getProjectsMock() }));
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
  loadConfigMock.mockReset();
  saveConfigMock.mockReset();
  statSyncMock.mockReset();
});

describe("projects-slice", () => {
  it("loadProjects populates from getProjects and marks loaded", async () => {
    getProjectsMock.mockReturnValue([{ path: "/p", name: "p", exists: true, hasAgentsDir: true, skills: [], availableCount: 0 }]);
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
});
