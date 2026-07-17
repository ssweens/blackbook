import { describe, it, expect } from "vitest";
import { mapLimit, computeAllPluginsDrift } from "./plugin-drift.js";
import type { Plugin } from "./types.js";

function mkPlugin(name: string): Plugin {
  return {
    name,
    marketplace: "test-marketplace",
    description: "",
    source: `./plugins/${name}`,
    skills: [],
    commands: [],
    agents: [],
    hooks: [],
    hasMcp: false,
    hasLsp: false,
    homepage: "",
    installed: true,
    scope: "user",
  };
}

describe("mapLimit", () => {
  it("returns results in the same order as the input, regardless of resolution order", async () => {
    const delays = [30, 10, 20];
    const results = await mapLimit(delays, 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(results).toEqual(delays);
  });

  it("never runs more than `limit` tasks concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 6 }, (_, i) => i);

    await mapLimit(items, 2, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
    });

    expect(maxInFlight).toBe(2);
  });

  it("handles an empty input without spawning any workers", async () => {
    const results = await mapLimit([], 4, async () => {
      throw new Error("should never be called");
    });
    expect(results).toEqual([]);
  });

  it("handles limit greater than the item count", async () => {
    const results = await mapLimit([1, 2], 10, async (n) => n * 2);
    expect(results).toEqual([2, 4]);
  });
});

describe("computeAllPluginsDrift", () => {
  // These plugins have no real installed source, so computePluginDrift
  // resolves quickly without shelling out — this exercises the real
  // function (not a mock), asserting on structural correctness rather than
  // specific drift values (which the mapLimit tests above already cover the
  // concurrency-bounding behavior for, generically).
  it("keys results by plugin name for every plugin", async () => {
    const plugins = [mkPlugin("a"), mkPlugin("b"), mkPlugin("c")];
    const result = await computeAllPluginsDrift(plugins);
    expect(Object.keys(result).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns an empty object for an empty plugin list", async () => {
    const result = await computeAllPluginsDrift([]);
    expect(result).toEqual({});
  });
});
