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

    it("parses plugins with local source paths", async () => {
      const mockMarketplace = createMockMarketplace("test-org-1");
      const mockMarketplaceJson = {
        plugins: [
          {
            name: "test-plugin",
            description: "A test plugin",
            source: "./plugins/test-plugin",
          },
        ],
      };

      const mockTreeResponse = {
        payload: {
          tree: {
            items: [
              { name: "skills/my-skill", path: "plugins/test-plugin/skills/my-skill", contentType: "directory" },
              { name: "commands/my-command.md", path: "plugins/test-plugin/commands/my-command.md", contentType: "file" },
              { name: ".mcp.json", path: "plugins/test-plugin/.mcp.json", contentType: "file" },
            ],
          },
        },
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("marketplace.json")) {
          return { ok: true, json: async () => mockMarketplaceJson } as Response;
        }
        if (urlStr.includes("/tree/")) {
          return { ok: true, json: async () => mockTreeResponse } as Response;
        }
        return { ok: false } as Response;
      });

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe("test-plugin");
      expect(plugins[0].skills).toContain("my-skill");
      expect(plugins[0].commands).toContain("my-command");
      expect(plugins[0].hasMcp).toBe(true);
    });

    it("parses plugins with github source object", async () => {
      const mockMarketplace = createMockMarketplace("test-org-2");
      const mockMarketplaceJson = {
        plugins: [
          {
            name: "github-plugin",
            description: "A GitHub-sourced plugin",
            source: { source: "github", repo: "owner/repo", ref: "main" },
          },
        ],
      };

      const mockTreeResponse = {
        payload: {
          tree: {
            items: [
              { name: "agents/my-agent.md", path: "agents/my-agent.md", contentType: "file" },
              { name: "hooks/my-hook.json", path: "hooks/my-hook.json", contentType: "file" },
            ],
          },
        },
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("marketplace.json")) {
          return { ok: true, json: async () => mockMarketplaceJson } as Response;
        }
        if (urlStr.includes("/tree/")) {
          return { ok: true, json: async () => mockTreeResponse } as Response;
        }
        return { ok: false } as Response;
      });

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe("github-plugin");
      expect(plugins[0].agents).toContain("my-agent");
      expect(plugins[0].hooks).toContain("my-hook");
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
          },
        ],
      };

      const mockTreeResponse = {
        payload: {
          tree: {
            items: [
              { name: ".mcp.json", path: ".mcp.json", contentType: "file" },
              { name: "skills/external-skill", path: "skills/external-skill", contentType: "directory" },
            ],
          },
        },
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("marketplace.json")) {
          return { ok: true, json: async () => mockMarketplaceJson } as Response;
        }
        if (urlStr.includes("/tree/")) {
          return { ok: true, json: async () => mockTreeResponse } as Response;
        }
        return { ok: false } as Response;
      });

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe("external-plugin");
      expect(plugins[0].skills).toContain("external-skill");
      expect(plugins[0].hasMcp).toBe(true);
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
        if (urlStr.includes("/tree/")) {
          return { ok: true, json: async () => ({ payload: { tree: { items: [] } } }) } as Response;
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
        if (urlStr.includes("/tree/")) {
          return { ok: true, json: async () => ({ payload: { tree: { items: [] } } }) } as Response;
        }
        return { ok: false } as Response;
      });

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].hasMcp).toBe(true);
    });

    it("detects .mcp.json file in plugin directory", async () => {
      const mockMarketplace = createMockMarketplace("test-org-6");
      const mockMarketplaceJson = {
        plugins: [
          {
            name: "mcp-file-plugin",
            description: "Plugin with .mcp.json file",
            source: "./plugins/mcp-file-plugin",
          },
        ],
      };

      const mockTreeResponse = {
        payload: {
          tree: {
            items: [
              { name: ".mcp.json", path: "plugins/mcp-file-plugin/.mcp.json", contentType: "file" },
            ],
          },
        },
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("marketplace.json")) {
          return { ok: true, json: async () => mockMarketplaceJson } as Response;
        }
        if (urlStr.includes("/tree/")) {
          return { ok: true, json: async () => mockTreeResponse } as Response;
        }
        return { ok: false } as Response;
      });

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].hasMcp).toBe(true);
    });

    it("detects mcp.json file (without dot prefix)", async () => {
      const mockMarketplace = createMockMarketplace("test-org-7");
      const mockMarketplaceJson = {
        plugins: [
          {
            name: "mcp-nodot-plugin",
            description: "Plugin with mcp.json file",
            source: "./plugins/mcp-nodot-plugin",
          },
        ],
      };

      const mockTreeResponse = {
        payload: {
          tree: {
            items: [
              { name: "mcp.json", path: "plugins/mcp-nodot-plugin/mcp.json", contentType: "file" },
            ],
          },
        },
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("marketplace.json")) {
          return { ok: true, json: async () => mockMarketplaceJson } as Response;
        }
        if (urlStr.includes("/tree/")) {
          return { ok: true, json: async () => mockTreeResponse } as Response;
        }
        return { ok: false } as Response;
      });

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].hasMcp).toBe(true);
    });

    it("extracts skills from nested directory paths", async () => {
      const mockMarketplace = createMockMarketplace("test-org-8");
      const mockMarketplaceJson = {
        plugins: [
          {
            name: "nested-skills-plugin",
            description: "Plugin with nested skill paths",
            source: "./plugins/nested-skills",
          },
        ],
      };

      const mockTreeResponse = {
        payload: {
          tree: {
            items: [
              { name: "skills/skill-one", path: "plugins/nested-skills/skills/skill-one", contentType: "directory" },
              { name: "skills/skill-two", path: "plugins/nested-skills/skills/skill-two", contentType: "directory" },
            ],
          },
        },
      };

      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes("marketplace.json")) {
          return { ok: true, json: async () => mockMarketplaceJson } as Response;
        }
        if (urlStr.includes("/tree/")) {
          return { ok: true, json: async () => mockTreeResponse } as Response;
        }
        return { ok: false } as Response;
      });

      const plugins = await fetchMarketplace(mockMarketplace);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].skills).toEqual(["skill-one", "skill-two"]);
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
