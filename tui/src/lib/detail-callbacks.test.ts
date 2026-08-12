import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted spies so the vi.mock factory (which is hoisted above imports) can close
// over them safely.
const { notify, clearNotification, loadInstalledPlugins, loadFiles, refreshDetail, withSpinner } = vi.hoisted(() => ({
  notify: vi.fn(),
  clearNotification: vi.fn(),
  loadInstalledPlugins: vi.fn(async () => {}),
  loadFiles: vi.fn(async () => {}),
  refreshDetail: vi.fn(),
  withSpinner: vi.fn(async (_label: string, fn: () => Promise<void>) => { await fn(); }),
}));

vi.mock("./store.js", () => ({
  useStore: { getState: () => ({ notify, clearNotification, loadInstalledPlugins, loadFiles, refreshDetail }) },
  withSpinner,
}));

import { runMutation } from "./detail-callbacks.js";

describe("runMutation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("runs fn under a spinner then reloads plugins for refresh:'plugins'", async () => {
    const fn = vi.fn(async () => {});
    await runMutation("Doing thing...", fn, { refresh: "plugins" });

    expect(withSpinner).toHaveBeenCalledWith("Doing thing...", expect.any(Function), notify, clearNotification);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(loadInstalledPlugins).toHaveBeenCalledWith({ silent: true });
    expect(refreshDetail).toHaveBeenCalledTimes(1);
    expect(loadFiles).not.toHaveBeenCalled();
  });

  it("reloads files for refresh:'files'", async () => {
    const fn = vi.fn(async () => {});
    await runMutation("Deleting file...", fn, { refresh: "files" });

    expect(loadFiles).toHaveBeenCalledWith({ silent: true });
    expect(loadInstalledPlugins).not.toHaveBeenCalled();
  });

  it("keeps the spinner active through reload and detail reconciliation", async () => {
    const order: string[] = [];
    const fn = vi.fn(async () => { order.push("mutate"); });
    withSpinner.mockImplementationOnce(async (_label: string, work: () => Promise<void>) => {
      order.push("spinner-start");
      await work();
      order.push("spinner-end");
    });
    loadInstalledPlugins.mockImplementationOnce(async () => { order.push("reload"); });
    refreshDetail.mockImplementationOnce(() => { order.push("reconcile"); });

    await runMutation("x", fn, { refresh: "plugins" });

    expect(order).toEqual(["spinner-start", "mutate", "reload", "reconcile", "spinner-end"]);
  });

  it("reconciles durable state when the mutation throws", async () => {
    const failure = new Error("disk write failed");

    await expect(runMutation(
      "Updating...",
      async () => { throw failure; },
      { refresh: "plugins" },
    )).rejects.toBe(failure);

    expect(loadInstalledPlugins).toHaveBeenCalledWith({ silent: true });
    expect(refreshDetail).toHaveBeenCalledTimes(1);
  });
});
