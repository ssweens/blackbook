import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted spies so the vi.mock factory (which is hoisted above imports) can close
// over them safely.
const { notify, clearNotification, loadInstalledPlugins, loadFiles, withSpinner } = vi.hoisted(() => ({
  notify: vi.fn(),
  clearNotification: vi.fn(),
  loadInstalledPlugins: vi.fn(async () => {}),
  loadFiles: vi.fn(async () => {}),
  withSpinner: vi.fn(async (_label: string, fn: () => Promise<void>) => { await fn(); }),
}));

vi.mock("./store.js", () => ({
  useStore: { getState: () => ({ notify, clearNotification, loadInstalledPlugins, loadFiles }) },
  withSpinner,
}));

import { runMutation } from "./detail-callbacks.js";

describe("runMutation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("runs fn under a spinner then reloads plugins for refresh:'plugins'", async () => {
    const fn = vi.fn(async () => {});
    await runMutation("Doing thing...", fn, { refresh: "plugins" });

    expect(withSpinner).toHaveBeenCalledWith("Doing thing...", fn, notify, clearNotification);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(loadInstalledPlugins).toHaveBeenCalledWith({ silent: true });
    expect(loadFiles).not.toHaveBeenCalled();
  });

  it("reloads files for refresh:'files'", async () => {
    const fn = vi.fn(async () => {});
    await runMutation("Deleting file...", fn, { refresh: "files" });

    expect(loadFiles).toHaveBeenCalledWith({ silent: true });
    expect(loadInstalledPlugins).not.toHaveBeenCalled();
  });

  it("reloads only after the mutation completes (spinner before reload)", async () => {
    const order: string[] = [];
    const fn = vi.fn(async () => { order.push("mutate"); });
    loadInstalledPlugins.mockImplementationOnce(async () => { order.push("reload"); });

    await runMutation("x", fn, { refresh: "plugins" });

    expect(order).toEqual(["mutate", "reload"]);
  });
});
