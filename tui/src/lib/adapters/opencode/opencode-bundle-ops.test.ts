import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BundleEntry, ToolInstance } from "../../playbook/index.js";
import {
  installOpenCodeBundle,
  uninstallOpenCodeBundle,
  updateOpenCodeBundle,
} from "./bundle-ops.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "blackbook-opencode-bundle-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const inst: ToolInstance = {
  id: "default",
  name: "OpenCode",
  config_dir: "",
  enabled: true,
};

function makeInst(): ToolInstance {
  return { ...inst, config_dir: tmp };
}

function makeBundle(pkg: string): BundleEntry {
  return {
    name: pkg,
    source: { type: "npm", package: pkg },
    enabled: true,
    disabled_components: { skills: [], commands: [], agents: [] },
  };
}

describe("opencode bundle-ops", () => {
  it("install creates opencode.json with plugin entry when file absent", async () => {
    await installOpenCodeBundle(makeBundle("opencode-helicone"), makeInst());
    const cfg = JSON.parse(readFileSync(join(tmp, "opencode.json"), "utf-8"));
    expect(cfg.plugin).toContain("opencode-helicone");
    expect(cfg.$schema).toBe("https://opencode.ai/config.json");
  });

  it("install appends to existing plugin array without duplicating", async () => {
    writeFileSync(
      join(tmp, "opencode.json"),
      JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: ["existing-pkg"] }),
    );
    await installOpenCodeBundle(makeBundle("new-pkg"), makeInst());
    const cfg = JSON.parse(readFileSync(join(tmp, "opencode.json"), "utf-8"));
    expect(cfg.plugin).toEqual(["existing-pkg", "new-pkg"]);
    // Second install is idempotent
    await installOpenCodeBundle(makeBundle("new-pkg"), makeInst());
    const cfg2 = JSON.parse(readFileSync(join(tmp, "opencode.json"), "utf-8"));
    expect(cfg2.plugin).toEqual(["existing-pkg", "new-pkg"]);
  });

  it("install preserves other opencode.json keys", async () => {
    writeFileSync(
      join(tmp, "opencode.json"),
      JSON.stringify({ model: "anthropic/claude-opus-4", autoupdate: true }),
    );
    await installOpenCodeBundle(makeBundle("x"), makeInst());
    const cfg = JSON.parse(readFileSync(join(tmp, "opencode.json"), "utf-8"));
    expect(cfg.model).toBe("anthropic/claude-opus-4");
    expect(cfg.autoupdate).toBe(true);
  });

  it("uninstall removes the package from plugin array", async () => {
    writeFileSync(
      join(tmp, "opencode.json"),
      JSON.stringify({ plugin: ["a", "b", "c"] }),
    );
    await uninstallOpenCodeBundle("b", makeInst());
    const cfg = JSON.parse(readFileSync(join(tmp, "opencode.json"), "utf-8"));
    expect(cfg.plugin).toEqual(["a", "c"]);
  });

  it("uninstall is idempotent when package absent", async () => {
    writeFileSync(join(tmp, "opencode.json"), JSON.stringify({ plugin: ["a"] }));
    await uninstallOpenCodeBundle("nope", makeInst());
    const cfg = JSON.parse(readFileSync(join(tmp, "opencode.json"), "utf-8"));
    expect(cfg.plugin).toEqual(["a"]);
  });

  it("uninstall is no-op when config file absent", async () => {
    await uninstallOpenCodeBundle("x", makeInst()); // no throw
  });

  it("update is a no-op (opencode handles at startup)", async () => {
    writeFileSync(join(tmp, "opencode.json"), JSON.stringify({ plugin: ["x"] }));
    await updateOpenCodeBundle("x", makeInst());
    const cfg = JSON.parse(readFileSync(join(tmp, "opencode.json"), "utf-8"));
    expect(cfg.plugin).toEqual(["x"]); // unchanged
  });

  it("throws for invalid JSON", async () => {
    writeFileSync(join(tmp, "opencode.json"), "not json");
    await expect(installOpenCodeBundle(makeBundle("x"), makeInst())).rejects.toThrow(
      /not valid JSON/,
    );
  });
});
