import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { ConfigSyncConfig } from "./types.js";
import { getConfigSourceFiles } from "./install.js";
import * as config from "./config.js";

const TEST_ROOT = join(tmpdir(), `blackbook-config-sync-${Date.now()}`);

function setupRepo(): string {
  const repoPath = join(TEST_ROOT, `repo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(repoPath, { recursive: true });
  return repoPath;
}

afterEach(() => {
  try {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    // ignore
  }
  vi.restoreAllMocks();
});

describe("getConfigSourceFiles", () => {
  it("expands mappings with directories and globs", async () => {
    const repo = setupRepo();
    const piDir = join(repo, "pi");
    const themesDir = join(piDir, "themes");

    mkdirSync(themesDir, { recursive: true });
    writeFileSync(join(piDir, "config.toml"), "config");
    writeFileSync(join(piDir, "keybindings.toml"), "keys");
    writeFileSync(join(piDir, "extra.json"), "extra");
    writeFileSync(join(themesDir, "dark.json"), "dark");
    writeFileSync(join(themesDir, "light.json"), "light");

    const cfg: ConfigSyncConfig = {
      name: "Pi Config",
      toolId: "pi",
      mappings: [
        { source: "pi/config.toml", target: "config.toml" },
        { source: "pi/themes/", target: "themes/" },
        { source: "pi/*.json", target: "." },
      ],
    };

    vi.spyOn(config, "getConfigRepoPath").mockReturnValue(repo);

    const files = await getConfigSourceFiles(cfg);
    const targets = files.map((file) => file.targetPath).sort();

    expect(targets).toEqual([
      "config.toml",
      "extra.json",
      "themes/dark.json",
      "themes/light.json",
    ].sort());
  });

  it("supports legacy source/target format", async () => {
    const repo = setupRepo();
    const piDir = join(repo, "pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "config.toml"), "config");

    const cfg: ConfigSyncConfig = {
      name: "Legacy Config",
      toolId: "pi",
      sourcePath: "pi/config.toml",
      targetPath: "configs/",
    };

    vi.spyOn(config, "getConfigRepoPath").mockReturnValue(repo);

    const files = await getConfigSourceFiles(cfg);
    expect(files).toHaveLength(1);
    expect(files[0].targetPath).toBe("configs/config.toml");
  });

  it("throws when mappings have no files", async () => {
    const repo = setupRepo();
    mkdirSync(repo, { recursive: true });

    const cfg: ConfigSyncConfig = {
      name: "Missing Config",
      toolId: "pi",
      mappings: [
        { source: "pi/missing/", target: "." },
      ],
    };

    vi.spyOn(config, "getConfigRepoPath").mockReturnValue(repo);

    await expect(getConfigSourceFiles(cfg)).rejects.toThrow("No files found");
  });
});
