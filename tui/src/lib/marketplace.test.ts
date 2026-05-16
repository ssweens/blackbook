import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fetchMarketplace } from "./marketplace.js";
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
});
