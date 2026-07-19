import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { searchSkillsSh, skillsShResultToPlugin, type SkillsShResult } from "./skillssh.js";
import { getCacheDir } from "./config.js";

function clearHttpCache() {
  const cacheDir = join(getCacheDir(), "http_cache");
  if (existsSync(cacheDir)) rmSync(cacheDir, { recursive: true, force: true });
}

describe("skillssh", () => {
  const originalCacheHome = process.env.XDG_CACHE_HOME;

  beforeEach(() => {
    const testCache = join(tmpdir(), `blackbook-skillssh-cache-${Date.now()}-${Math.random()}`);
    mkdirSync(testCache, { recursive: true });
    process.env.XDG_CACHE_HOME = testCache;
    vi.clearAllMocks();
    clearHttpCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearHttpCache();
    if (originalCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = originalCacheHome;
  });

  describe("searchSkillsSh", () => {
    it("returns [] for a query under 2 characters without hitting the network", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const results = await searchSkillsSh("a");
      expect(results).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("parses a successful search response into SkillsShResult rows", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          query: "react",
          skills: [
            { id: "vercel-labs/agent-skills/vercel-react-best-practices", skillId: "vercel-react-best-practices", name: "vercel-react-best-practices", installs: 562059, source: "vercel-labs/agent-skills" },
          ],
          count: 1,
        }),
      } as Response);

      const results = await searchSkillsSh("react");
      expect(results).toEqual([
        { id: "vercel-labs/agent-skills/vercel-react-best-practices", skillId: "vercel-react-best-practices", name: "vercel-react-best-practices", installs: 562059, source: "vercel-labs/agent-skills" },
      ]);
    });

    it("drops malformed entries missing required fields", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          skills: [
            { id: "a/b/c", skillId: "c", name: "c", installs: 1, source: "a/b" },
            { id: "missing-source", skillId: "x" }, // no name/source — dropped
          ],
        }),
      } as Response);

      const results = await searchSkillsSh("query");
      expect(results).toHaveLength(1);
      expect(results[0].skillId).toBe("c");
    });

    it("returns [] on a non-ok HTTP response", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 500 } as Response);
      const results = await searchSkillsSh("query");
      expect(results).toEqual([]);
    });

    it("returns [] when fetch throws (network failure)", async () => {
      vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));
      const results = await searchSkillsSh("query");
      expect(results).toEqual([]);
    });

    it("caches results and does not re-fetch for the same query within the TTL", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ skills: [{ id: "a/b/c", skillId: "c", name: "c", installs: 1, source: "a/b" }] }),
      } as Response);

      await searchSkillsSh("cached-query");
      await searchSkillsSh("cached-query");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("skillsShResultToPlugin", () => {
    const result: SkillsShResult = {
      id: "vercel-labs/agent-skills/vercel-react-view-transitions",
      skillId: "vercel-react-view-transitions",
      name: "vercel-react-view-transitions",
      installs: 81649,
      source: "vercel-labs/agent-skills",
    };

    it("names the plugin from the globally-unique skills.sh id, never the bare skill id alone (avoids collisions across skills sharing a repo)", () => {
      const plugin = skillsShResultToPlugin(result);
      expect(plugin.name).toBe("vercel-labs-agent-skills-vercel-react-view-transitions");
      expect(plugin.name).not.toBe(result.skillId);
    });

    it("gives two skills from the same repo distinct plugin names", () => {
      const other: SkillsShResult = { ...result, id: "vercel-labs/agent-skills/vercel-react-native-skills", skillId: "vercel-react-native-skills", name: "vercel-react-native-skills" };
      const a = skillsShResultToPlugin(result);
      const b = skillsShResultToPlugin(other);
      expect(a.name).not.toBe(b.name);
    });

    it("puts the actual skill id in skills[], matching the download-API slug", () => {
      const plugin = skillsShResultToPlugin(result);
      expect(plugin.skills).toEqual(["vercel-react-view-transitions"]);
    });

    it("sources from GitHub via owner/repo, never skills.sh's own flat convention", () => {
      const plugin = skillsShResultToPlugin(result);
      expect(plugin.source).toEqual({ source: "github", repo: "vercel-labs/agent-skills" });
      expect(plugin.marketplace).toBe("skills.sh");
    });

    it("declares no commands/agents/hooks/mcp — skills.sh is skills-only", () => {
      const plugin = skillsShResultToPlugin(result);
      expect(plugin.commands).toEqual([]);
      expect(plugin.agents).toEqual([]);
      expect(plugin.hooks).toEqual([]);
      expect(plugin.hasMcp).toBe(false);
    });
  });
});
