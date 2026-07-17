import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { mapLimit, computeAllPluginsDrift, resolvePluginSourcePaths } from "./plugin-drift.js";
import type { Plugin } from "./types.js";

vi.mock("./config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config.js")>();
  return { ...actual, parseMarketplaces: vi.fn().mockReturnValue([]), getToolInstances: vi.fn().mockReturnValue([]) };
});

import { parseMarketplaces } from "./config.js";

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

describe("resolvePluginSourcePaths", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "plugin-drift-source-"));
    mkdirSync(join(repoRoot, "plugins", "my-plugin", "skills", "my-skill"), { recursive: true });
    writeFileSync(
      join(repoRoot, "plugins", "my-plugin", "skills", "my-skill", "SKILL.md"),
      "# my-skill\n",
    );
    writeFileSync(
      join(repoRoot, "marketplace.json"),
      JSON.stringify({
        plugins: [{ name: "my-plugin", source: "./plugins/my-plugin" }],
      }),
    );
    vi.mocked(parseMarketplaces).mockReset();
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("resolves a plugin from a bare-path local marketplace", () => {
    vi.mocked(parseMarketplaces).mockReturnValue([{ url: repoRoot } as any]);
    const result = resolvePluginSourcePaths({ name: "my-plugin" } as Plugin);
    expect(result).toEqual({
      pluginDir: join(repoRoot, "plugins", "my-plugin"),
      repoRoot,
    });
  });

  it("resolves a plugin from a file:// local marketplace URL", () => {
    // Regression: resolvePluginSource's local-marketplace check only matched
    // /, ~, ./, ../ prefixes — a file:// URL (a legitimate, real marketplace
    // URL format; marketplace.ts and path-utils.ts both handle it elsewhere)
    // fell through unrecognized, so drift was silently never detected for
    // plugins registered via a file://-scheme marketplace.
    vi.mocked(parseMarketplaces).mockReturnValue([{ url: pathToFileURL(repoRoot).href } as any]);
    const result = resolvePluginSourcePaths({ name: "my-plugin" } as Plugin);
    expect(result).toEqual({
      pluginDir: join(repoRoot, "plugins", "my-plugin"),
      repoRoot,
    });
  });

  it("resolves a file:// marketplace URL pointing directly at marketplace.json", () => {
    const marketplaceJsonUrl = pathToFileURL(join(repoRoot, "marketplace.json")).href;
    vi.mocked(parseMarketplaces).mockReturnValue([{ url: marketplaceJsonUrl } as any]);
    const result = resolvePluginSourcePaths({ name: "my-plugin" } as Plugin);
    expect(result).toEqual({
      pluginDir: join(repoRoot, "plugins", "my-plugin"),
      repoRoot,
    });
  });

  it("returns null when no marketplace resolves the plugin", () => {
    vi.mocked(parseMarketplaces).mockReturnValue([{ url: repoRoot } as any]);
    const result = resolvePluginSourcePaths({ name: "unknown-plugin" } as Plugin);
    expect(result).toBeNull();
  });

  it("returns null for a remote (non-local) marketplace", () => {
    vi.mocked(parseMarketplaces).mockReturnValue([{ url: "https://github.com/org/repo.git" } as any]);
    const result = resolvePluginSourcePaths({ name: "my-plugin" } as Plugin);
    expect(result).toBeNull();
  });
});
