import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

// marketplace.ts's `getGlobalNodeModulesPath` shells out to `npm/pnpm root -g`
// (via execFileSync) whenever fetchNpmPackages() runs its global-install
// cross-reference step. Stub just that export so tests stay fast and hermetic
// instead of invoking real package managers (which can trigger a slow corepack
// download in CI). No other code path in this file touches child_process.
const { execFileSyncMock } = vi.hoisted(() => ({ execFileSyncMock: vi.fn() }));
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execFileSync: execFileSyncMock };
});
import { tmpdir } from "os";
import { fetchMarketplace, fetchNpmPackages, fetchRepoTreePaths, getFetchErrors, resetFetchErrors } from "./marketplace.js";
import { getCacheDir } from "./config.js";
import type { Marketplace } from "./types.js";

function clearHttpCache() {
  const cacheDir = join(getCacheDir(), "http_cache");
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

describe("marketplace", () => {
  const originalCacheHome = process.env.XDG_CACHE_HOME;

  beforeEach(() => {
    const testCache = join(tmpdir(), `blackbook-marketplace-cache-${Date.now()}`);
    mkdirSync(testCache, { recursive: true });
    process.env.XDG_CACHE_HOME = testCache;
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    clearHttpCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearHttpCache();
    if (originalCacheHome === undefined) {
      delete process.env.XDG_CACHE_HOME;
    } else {
      process.env.XDG_CACHE_HOME = originalCacheHome;
    }
  });

  function createMockMarketplace(name = "test-marketplace"): Marketplace {
    return {
      name,
      url: `https://raw.githubusercontent.com/${name}/repo/main/marketplace.json`,
      isLocal: false,
      plugins: [],
      availableCount: 0,
      installedCount: 0,
      autoUpdate: false,
      source: "blackbook",
      enabled: true,
    };
  }

  describe("fetchMarketplace", () => {
    it("loads a local Claude marketplace checkout and scans manifest-declared nested skill roots", async () => {
      const root = join(tmpdir(), `blackbook-local-marketplace-${Date.now()}`);
      const pluginDir = join(root, "plugins", "desk");
      mkdirSync(join(root, ".claude-plugin"), { recursive: true });
      mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
      mkdirSync(join(pluginDir, "skills", "reaper-cli"), { recursive: true });
      mkdirSync(join(pluginDir, "skills", "plugins", "plugin-serum2"), { recursive: true });
      mkdirSync(join(pluginDir, "skills", "plugins", "plugin-microtonic"), { recursive: true });

      writeFileSync(join(root, ".claude-plugin", "marketplace.json"), JSON.stringify({
        plugins: [{
          name: "desk",
          description: "old description",
          source: "./plugins/desk",
        }],
      }));
      writeFileSync(join(pluginDir, ".claude-plugin", "plugin.json"), JSON.stringify({
        version: "0.1.0",
        description: "new description",
        homepage: "https://github.com/ssweens/desk",
        skills: ["./skills/", "./skills/plugins/"],
      }));
      writeFileSync(join(pluginDir, ".mcp.json"), "{}");
      writeFileSync(join(pluginDir, "skills", "reaper-cli", "SKILL.md"), "---\nname: reaper-cli\ndescription: Reaper CLI\n---\n");
      writeFileSync(join(pluginDir, "skills", "plugins", "plugin-serum2", "SKILL.md"), "---\nname: plugin-serum2\ndescription: Serum 2\n---\n");
      writeFileSync(join(pluginDir, "skills", "plugins", "plugin-microtonic", "SKILL.md"), "---\nname: daw-microtonic\ndescription: Microtonic\n---\n");

      const plugins = await fetchMarketplace({
        name: "desk",
        url: root,
        isLocal: true,
        plugins: [],
        availableCount: 0,
        installedCount: 0,
        autoUpdate: false,
        source: "claude",
        enabled: true,
      });

      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toMatchObject({
        name: "desk",
        version: "0.1.0",
        description: "new description",
        homepage: "https://github.com/ssweens/desk",
        hasMcp: true,
      });
      expect(plugins[0].skills).toEqual(["daw-microtonic", "plugin-serum2", "reaper-cli"]);

      rmSync(root, { recursive: true, force: true });
    });

    it("skips marketplace entries with unsafe or missing plugin names", async () => {
      const root = join(tmpdir(), `blackbook-unsafe-marketplace-${Date.now()}`);
      mkdirSync(join(root, ".claude-plugin"), { recursive: true });
      writeFileSync(join(root, ".claude-plugin", "marketplace.json"), JSON.stringify({
        plugins: [
          { name: "good-plugin", description: "fine", source: "./plugins/good-plugin" },
          { name: "../../evil", description: "traversal", source: "./x" },
          { name: "", description: "empty", source: "./y" },
          { description: "no name at all", source: "./z" },
          { name: 42, description: "non-string name", source: "./w" },
        ],
      }));

      const plugins = await fetchMarketplace({
        name: "unsafe",
        url: root,
        isLocal: true,
        plugins: [],
        availableCount: 0,
        installedCount: 0,
        autoUpdate: false,
        source: "claude",
        enabled: true,
      });

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe("good-plugin");

      rmSync(root, { recursive: true, force: true });
    });

    it("reads remote plugin metadata from the marketplace URL's declared source path", async () => {
      const marketplace = createMockMarketplace("EveryInc");
      marketplace.url = "https://raw.githubusercontent.com/EveryInc/compound-engineering-plugin/main/.claude-plugin/marketplace.json";
      marketplace.source = "claude";
      const mockMarketplaceJson = {
        plugins: [{
          name: "compound-engineering",
          description: "old",
          source: "./plugins/compound-engineering",
          skills: ["ce-plan"],
          commands: [],
          agents: [],
          hooks: [],
        }],
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.endsWith("/.claude-plugin/marketplace.json")) {
          return { ok: true, json: async () => mockMarketplaceJson } as Response;
        }
        if (urlStr.endsWith("/plugins/compound-engineering/.claude-plugin/plugin.json")) {
          return { ok: true, text: async () => JSON.stringify({ version: "3.8.2", description: "new metadata" }), json: async () => ({ version: "3.8.2", description: "new metadata" }) } as Response;
        }
        if (urlStr.includes("api.github.com") && urlStr.includes("/contents/plugins/compound-engineering?")) {
          return { ok: true, json: async () => [{ name: "skills", path: "plugins/compound-engineering/skills", type: "dir" }] } as Response;
        }
        if (urlStr.includes("api.github.com") && urlStr.includes("/contents/plugins/compound-engineering/skills?")) {
          return { ok: true, json: async () => [{ name: "ce-plan", path: "plugins/compound-engineering/skills/ce-plan", type: "dir" }] } as Response;
        }
        return { ok: false, status: 404, headers: new Headers() } as Response;
      });

      const plugins = await fetchMarketplace(marketplace, { forceRefresh: true });

      expect(plugins).toHaveLength(1);
      expect(plugins[0].version).toBe("3.8.2");
      expect(plugins[0].latestVersion).toBe("3.8.2");
      expect(plugins[0].description).toBe("new metadata");
      expect(plugins[0].skills).toEqual(["ce-plan"]);
    });

    it("only sends GitHub token to trusted GitHub hosts", async () => {
      const token = "ghp_test_token";
      const originalToken = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = token;

      const mockMarketplaceJson = { plugins: [] };
      let seenAuth: string | undefined;

      vi.spyOn(global, "fetch").mockImplementation(async (_url, options) => {
        const headers = (options as { headers?: Record<string, string> } | undefined)?.headers || {};
        seenAuth = headers.Authorization;
        return { ok: true, json: async () => mockMarketplaceJson } as Response;
      });

      const fakeMarketplace: Marketplace = {
        name: "fake-market",
        url: "https://github-fake.attacker.com/marketplace.json",
        isLocal: false,
        plugins: [],
        availableCount: 0,
        installedCount: 0,
        autoUpdate: false,
        source: "blackbook",
        enabled: true,
      };

      await fetchMarketplace(fakeMarketplace);
      expect(seenAuth).toBeUndefined();

      const realMarketplace: Marketplace = {
        ...fakeMarketplace,
        name: "real-market",
        url: "https://raw.githubusercontent.com/org/repo/main/marketplace.json",
      };

      seenAuth = undefined;
      await fetchMarketplace(realMarketplace);
      expect(seenAuth).toBe(`token ${token}`);

      if (originalToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalToken;
      }
    });

    it("parses plugins with skills/commands/agents declared in marketplace.json", async () => {
      const mockMarketplace = createMockMarketplace("test-org-1");
      const mockMarketplaceJson = {
        plugins: [
          {
            name: "test-plugin",
            description: "A test plugin",
            source: "./plugins/test-plugin",
            skills: ["my-skill"],
            commands: ["my-command"],
            agents: ["my-agent"],
            hooks: ["my-hook"],
          },
        ],
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("marketplace.json")) {
          return { ok: true, json: async () => mockMarketplaceJson } as Response;
        }
        return { ok: false } as Response;
      });

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe("test-plugin");
      expect(plugins[0].skills).toContain("my-skill");
      expect(plugins[0].commands).toContain("my-command");
      expect(plugins[0].agents).toContain("my-agent");
      expect(plugins[0].hooks).toContain("my-hook");
    });

    it("parses plugins with github source object", async () => {
      const mockMarketplace = createMockMarketplace("test-org-2");
      const mockMarketplaceJson = {
        plugins: [
          {
            name: "github-plugin",
            description: "A GitHub-sourced plugin",
            source: { source: "github", repo: "owner/repo", ref: "main" },
            skills: ["gh-skill"],
            commands: ["gh-cmd"],
          },
        ],
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("marketplace.json")) {
          return { ok: true, json: async () => mockMarketplaceJson } as Response;
        }
        return { ok: false } as Response;
      });

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe("github-plugin");
      expect(plugins[0].skills).toContain("gh-skill");
      expect(plugins[0].commands).toContain("gh-cmd");
    });

    it("parses plugins with url source object (external repos)", async () => {
      const mockMarketplace = createMockMarketplace("test-org-3");
      const mockMarketplaceJson = {
        plugins: [
          {
            name: "external-plugin",
            description: "An external plugin",
            source: { source: "url", url: "https://github.com/external-org/external-repo.git" },
            homepage: "https://github.com/external-org/external-repo",
            skills: ["external-skill"],
          },
        ],
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("marketplace.json")) {
          return { ok: true, json: async () => mockMarketplaceJson } as Response;
        }
        return { ok: false } as Response;
      });

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe("external-plugin");
      expect(plugins[0].skills).toContain("external-skill");
      expect(plugins[0].homepage).toBe("https://github.com/external-org/external-repo");
    });

    it("detects lspServers from marketplace manifest", async () => {
      const mockMarketplace = createMockMarketplace("test-org-4");
      const mockMarketplaceJson = {
        plugins: [
          {
            name: "lsp-plugin",
            description: "An LSP plugin",
            source: "./plugins/lsp-plugin",
            lspServers: {
              typescript: {
                command: "typescript-language-server",
                args: ["--stdio"],
              },
            },
          },
        ],
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("marketplace.json")) {
          return { ok: true, json: async () => mockMarketplaceJson } as Response;
        }
        if (urlStr.includes("/contents/")) {
          return { ok: true, json: async () => [] } as Response;
        }
        return { ok: false } as Response;
      });

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].hasLsp).toBe(true);
    });

    it("detects mcpServers from marketplace manifest", async () => {
      const mockMarketplace = createMockMarketplace("test-org-5");
      const mockMarketplaceJson = {
        plugins: [
          {
            name: "mcp-manifest-plugin",
            description: "An MCP plugin defined in manifest",
            source: "./plugins/mcp-plugin",
            mcpServers: {
              myserver: {
                command: "npx",
                args: ["my-mcp-server"],
              },
            },
          },
        ],
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("marketplace.json")) {
          return { ok: true, json: async () => mockMarketplaceJson } as Response;
        }
        if (urlStr.includes("/contents/")) {
          return { ok: true, json: async () => [] } as Response;
        }
        return { ok: false } as Response;
      });

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].hasMcp).toBe(true);
    });

    it("detects mcp from mcpServers in marketplace manifest", async () => {
      const mockMarketplace = createMockMarketplace("test-org-6");
      const mockMarketplaceJson = {
        plugins: [
          {
            name: "mcp-manifest-plugin",
            description: "Plugin with MCP in manifest",
            source: "./plugins/mcp-file-plugin",
            mcpServers: { myserver: { command: "npx", args: ["server"] } },
          },
        ],
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("marketplace.json")) {
          return { ok: true, json: async () => mockMarketplaceJson } as Response;
        }
        return { ok: false } as Response;
      });

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].hasMcp).toBe(true);
    });

    it("normalizes path-like manifest item entries to safe names", async () => {
      const mockMarketplace = createMockMarketplace("test-org-7");
      const mockMarketplaceJson = {
        plugins: [
          {
            name: "path-plugin",
            description: "Plugin with path-like entries",
            source: "./plugins/path-plugin",
            skills: ["./.claude/skills/browser-automation", "./netsuite-ai-connector-instructions"],
            commands: ["./commands/my-command.md"],
            agents: ["./agents/my-agent.md"],
            hooks: ["./hooks/pre-commit.json"],
          },
        ],
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("marketplace.json")) {
          return { ok: true, json: async () => mockMarketplaceJson } as Response;
        }
        return { ok: false } as Response;
      });

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].skills).toEqual(["browser-automation", "netsuite-ai-connector-instructions"]);
      expect(plugins[0].commands).toEqual(["my-command"]);
      expect(plugins[0].agents).toEqual(["my-agent"]);
      expect(plugins[0].hooks).toEqual(["pre-commit"]);
      expect(plugins[0].hasMcp).toBe(false);
    });

    it("returns empty array when fetch fails", async () => {
      const mockMarketplace = createMockMarketplace("test-org-9");
      vi.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toEqual([]);
    });

    it("returns empty array when response is not ok", async () => {
      const mockMarketplace = createMockMarketplace("test-org-10");
      vi.spyOn(global, "fetch").mockResolvedValue({ ok: false } as Response);

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toEqual([]);
    });
  });

  describe("fetch-error surfacing", () => {
    it("records a distinguishable error when npm fetch fails (offline != empty)", async () => {
      resetFetchErrors();
      vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));

      const packages = await fetchNpmPackages();

      // Backwards-compatible empty result for existing callers...
      expect(packages).toEqual([]);
      // ...but the failure is captured so callers can tell offline from empty.
      const errors = getFetchErrors();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes("Failed to fetch npm packages"))).toBe(true);
    });

    it("records no error when npm fetch genuinely returns zero packages", async () => {
      resetFetchErrors();
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ objects: [], total: 0 }),
      } as Response);
      execFileSyncMock.mockImplementation(() => {
        throw new Error("not available in test environment");
      });

      const packages = await fetchNpmPackages();

      expect(packages).toEqual([]);
      expect(getFetchErrors()).toEqual([]);
    });
  });

  describe("fetchRepoTreePaths", () => {
    // Regression test for a real Bun runtime incompatibility: the previous
    // implementation wired curl→tar by passing `curl.stdout` (a Readable
    // stream object) directly as a stdio array element to `spawn("tar", ...)`.
    // Node's child_process supports this; Bun's spawn does not (it throws
    // "TODO: stream.Readable stdio"). This hits the real network against a
    // small, stable public repo to exercise the actual subprocess pipe under
    // whichever runtime the test suite is running on, not a mocked one.
    it("lists a real public repo's tarball contents without a runtime/stdio error", async () => {
      resetFetchErrors();
      const paths = await fetchRepoTreePaths("ssweens/blackbook", "main");
      expect(paths.length).toBeGreaterThan(0);
      expect(paths).toContain("README.md");
      expect(getFetchErrors()).toEqual([]);
    }, 30000);
  });
});
