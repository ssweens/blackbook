import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import {
  expandTilde,
  flattenNamespacedName,
  getPluginMcpServers,
  readSkillFrontmatterName,
  resolveInstanceSubdirPath,
  resolveLocalPath,
  resolveLocalPathRaw,
} from "./path-utils.js";

describe("expandTilde", () => {
  it("expands a bare tilde to the home directory", () => {
    expect(expandTilde("~")).toBe(homedir());
  });

  it("expands ~/foo/bar without discarding the home directory", () => {
    // Regression: stripping only the tilde left an absolute "/foo/bar", which
    // resolve(home, "/foo/bar") collapsed back to "/foo/bar".
    expect(expandTilde("~/foo/bar")).toBe(join(homedir(), "foo", "bar"));
  });

  it("expands ~/ to the home directory", () => {
    expect(expandTilde("~/")).toBe(homedir());
  });

  it("leaves an already-absolute path unchanged", () => {
    expect(expandTilde("/already/absolute")).toBe("/already/absolute");
  });

  it("leaves a relative path unchanged", () => {
    expect(expandTilde("foo/bar")).toBe("foo/bar");
  });
});

describe("resolveInstanceSubdirPath", () => {
  it("joins a relative subdir onto configDir, unchanged from today's behavior", () => {
    expect(resolveInstanceSubdirPath("/home/user/.codex", "skills")).toBe(
      join("/home/user/.codex", "skills"),
    );
  });

  it("joins extra path segments after a relative subdir", () => {
    expect(resolveInstanceSubdirPath("/home/user/.codex", "skills", "my-plugin", "my-skill")).toBe(
      join("/home/user/.codex", "skills", "my-plugin", "my-skill"),
    );
  });

  it("treats an absolute subdir as a full override, ignoring configDir", () => {
    expect(resolveInstanceSubdirPath("/home/user/.codex", "/shared/skills")).toBe("/shared/skills");
  });

  it("expands a ~-prefixed subdir and ignores configDir", () => {
    expect(resolveInstanceSubdirPath("/home/user/.codex", "~/.agents/skills")).toBe(
      join(homedir(), ".agents", "skills"),
    );
  });

  it("joins extra path segments after an absolute/tilde override", () => {
    expect(resolveInstanceSubdirPath("/home/user/.codex", "~/.agents/skills", "my-plugin", "my-skill")).toBe(
      join(homedir(), ".agents", "skills", "my-plugin", "my-skill"),
    );
  });
});

describe("flattenNamespacedName", () => {
  it("prefixes a name with its namespace", () => {
    expect(flattenNamespacedName("myplugin", "verdict")).toBe("myplugin-verdict");
  });

  it("returns the bare name unchanged when there is no prefix", () => {
    expect(flattenNamespacedName(undefined, "verdict")).toBe("verdict");
    expect(flattenNamespacedName(null, "verdict")).toBe("verdict");
    expect(flattenNamespacedName("", "verdict")).toBe("verdict");
  });

  it("returns the bare name unchanged when the name equals the prefix (self-named skill)", () => {
    expect(flattenNamespacedName("myplugin", "myplugin")).toBe("myplugin");
  });

  it("does not double-prefix a name that's already prefix-elided", () => {
    expect(flattenNamespacedName("myplugin", "myplugin-verdict")).toBe("myplugin-verdict");
  });
});

describe("readSkillFrontmatterName", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "read-skill-name-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("reads the name from SKILL.md frontmatter", () => {
    const skillDir = join(testDir, "myplugin-verdict");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      '---\nname: verdict\ndescription: "test"\n---\n\n# Verdict\n',
    );
    // The directory is flattened/prefixed, but the frontmatter name is bare —
    // this is exactly the case a flat-install tool's disk layout produces.
    expect(readSkillFrontmatterName(skillDir)).toBe("verdict");
  });

  it("falls back to the directory name when SKILL.md has no name field", () => {
    const skillDir = join(testDir, "verdict");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Verdict\n\nNo frontmatter here.");
    expect(readSkillFrontmatterName(skillDir)).toBe("verdict");
  });

  it("falls back to the directory name when SKILL.md is missing", () => {
    const skillDir = join(testDir, "verdict");
    mkdirSync(skillDir, { recursive: true });
    expect(readSkillFrontmatterName(skillDir)).toBe("verdict");
  });
});

describe("resolveLocalPath", () => {
  let testDir: string;
  let marketplaceJsonPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "resolve-local-path-"));
    marketplaceJsonPath = join(testDir, ".claude-plugin", "marketplace.json");
    mkdirSync(join(testDir, ".claude-plugin"), { recursive: true });
    writeFileSync(marketplaceJsonPath, "{}");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns a bare absolute directory path unchanged", () => {
    expect(resolveLocalPath(testDir)).toBe(testDir);
  });

  it("resolves a bare absolute path pointing at a file to its directory", () => {
    expect(resolveLocalPath(marketplaceJsonPath)).toBe(join(testDir, ".claude-plugin"));
  });

  it("resolves a file:// URL pointing at a directory to that directory", () => {
    expect(resolveLocalPath(pathToFileURL(testDir).href)).toBe(testDir);
  });

  it("resolves a file:// URL pointing at a file to its directory", () => {
    // Regression: the file:// branch used to return fileURLToPath() directly,
    // skipping the "if it's a file, use its directory" step that the bare-path
    // branch applies — so a file:// marketplace URL pointing at
    // marketplace.json (the common case) resolved to the file itself instead
    // of its containing directory.
    expect(resolveLocalPath(pathToFileURL(marketplaceJsonPath).href)).toBe(
      join(testDir, ".claude-plugin"),
    );
  });

  it("returns null for a remote (non-local) URL", () => {
    expect(resolveLocalPath("https://github.com/owner/repo.git")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(resolveLocalPath("")).toBeNull();
  });
});

describe("resolveLocalPathRaw", () => {
  let testDir: string;
  let marketplaceJsonPath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "resolve-local-path-raw-"));
    marketplaceJsonPath = join(testDir, ".claude-plugin", "marketplace.json");
    mkdirSync(join(testDir, ".claude-plugin"), { recursive: true });
    writeFileSync(marketplaceJsonPath, "{}");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("does not collapse a bare absolute path pointing at a file to its directory", () => {
    // Unlike resolveLocalPath — callers that need to know the raw target is a
    // file (to try alternate filenames when it's a directory instead) use
    // this instead of resolveLocalPath specifically to avoid that collapse.
    expect(resolveLocalPathRaw(marketplaceJsonPath)).toBe(marketplaceJsonPath);
  });

  it("does not collapse a file:// URL pointing at a file to its directory", () => {
    expect(resolveLocalPathRaw(pathToFileURL(marketplaceJsonPath).href)).toBe(marketplaceJsonPath);
  });

  it("returns null for a remote (non-local) URL", () => {
    expect(resolveLocalPathRaw("https://github.com/owner/repo.git")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(resolveLocalPathRaw("")).toBeNull();
  });
});

describe("getPluginMcpServers", () => {
  let pluginDir: string;

  beforeEach(() => {
    pluginDir = mkdtempSync(join(tmpdir(), "plugin-mcp-"));
  });

  afterEach(() => {
    rmSync(pluginDir, { recursive: true, force: true });
  });

  it("reads servers from the standard {mcpServers: {...}} shape in mcp.json", () => {
    writeFileSync(
      join(pluginDir, "mcp.json"),
      JSON.stringify({ mcpServers: { search: { command: "npx", args: ["search-mcp"] } } }),
    );
    expect(getPluginMcpServers(pluginDir)).toEqual({ search: { command: "npx", args: ["search-mcp"] } });
  });

  it("reads servers from a bare servers object in .mcp.json", () => {
    writeFileSync(
      join(pluginDir, ".mcp.json"),
      JSON.stringify({ search: { command: "npx", args: ["search-mcp"] } }),
    );
    expect(getPluginMcpServers(pluginDir)).toEqual({ search: { command: "npx", args: ["search-mcp"] } });
  });

  it("falls back to an inline mcpServers object in .claude-plugin/plugin.json", () => {
    mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(pluginDir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "demo", mcpServers: { search: { command: "npx" } } }),
    );
    expect(getPluginMcpServers(pluginDir)).toEqual({ search: { command: "npx" } });
  });

  it("follows a string mcpServers path in plugin.json to another file", () => {
    mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(pluginDir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "demo", mcpServers: "./custom-mcp.json" }),
    );
    writeFileSync(
      join(pluginDir, "custom-mcp.json"),
      JSON.stringify({ mcpServers: { search: { command: "npx" } } }),
    );
    expect(getPluginMcpServers(pluginDir)).toEqual({ search: { command: "npx" } });
  });

  it("returns null when no MCP definitions are present", () => {
    expect(getPluginMcpServers(pluginDir)).toBeNull();
  });

  it("prefers mcp.json at the plugin root over plugin.json's inline field", () => {
    writeFileSync(join(pluginDir, "mcp.json"), JSON.stringify({ mcpServers: { root: { command: "a" } } }));
    mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(pluginDir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ mcpServers: { inline: { command: "b" } } }),
    );
    expect(getPluginMcpServers(pluginDir)).toEqual({ root: { command: "a" } });
  });
});
