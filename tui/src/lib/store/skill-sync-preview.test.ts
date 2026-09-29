import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildSkillSyncPreview } from "./files-slice.js";
import type { StandaloneSkill } from "../install.js";
import type { ToolInstance } from "../types.js";

const tool = (toolId: string, name: string): ToolInstance => ({
  toolId,
  instanceId: "default",
  name,
  configDir: `/tmp/${toolId}`,
  skillsSubdir: "skills",
  commandsSubdir: null,
  agentsSubdir: null,
  enabled: true,
  kind: "tool",
  pluginFlatInstall: toolId === "claude-code",
} as ToolInstance);

const tools = [tool("claude-code", "Claude"), tool("openai-codex", "Codex")];

function skill(name: string, opts: { installedOn?: string[]; source?: boolean; driftedOn?: string[] } = {}): StandaloneSkill {
  return {
    name,
    installations: (opts.installedOn ?? []).map((toolId) => ({
      toolId,
      instanceId: "default",
      instanceName: tools.find((t) => t.toolId === toolId)!.name,
      diskPath: `/disk/${toolId}/${name}`,
      drifted: opts.driftedOn?.includes(toolId) ?? false,
    })),
    diskPath: `/disk/${name}`,
    toolId: "",
    instanceId: "",
    instanceName: "",
    sourcePath: opts.source === false ? undefined : `/repo/skills/${name}`,
  } as StandaloneSkill;
}

const rows = (items: ReturnType<typeof buildSkillSyncPreview>) =>
  items.map((i) => (i.kind === "skill" ? { name: i.skill.name, missing: i.missingInstances, drifted: i.driftedInstances } : null));

describe("buildSkillSyncPreview (global lock is the source of truth)", () => {
  it("a source-repo skill outside the lock is available, not missing", () => {
    expect(buildSkillSyncPreview([skill("qc-review")], tools, new Set())).toEqual([]);
  });

  it("a lock skill is missing on every tool without it", () => {
    const preview = buildSkillSyncPreview([skill("the-algorithm", { installedOn: ["openai-codex"] })], tools, new Set(["the-algorithm"]));
    expect(rows(preview)).toEqual([{ name: "the-algorithm", missing: ["Claude"], drifted: [] }]);
  });

  it("a lock skill with no install and no source-repo copy still shows as missing everywhere", () => {
    const preview = buildSkillSyncPreview([], tools, new Set(["skill-creator"]));
    expect(rows(preview)).toEqual([{ name: "skill-creator", missing: ["Claude", "Codex"], drifted: [] }]);
  });

  it("drift and sourceless installs still show whether or not the skill is in the lock", () => {
    const preview = buildSkillSyncPreview(
      [skill("edited", { installedOn: ["openai-codex"], driftedOn: ["openai-codex"] }), skill("orphan", { installedOn: ["claude-code"], source: false })],
      tools,
      new Set(),
    );
    expect(rows(preview)).toEqual([
      { name: "edited", missing: [], drifted: ["Codex"] },
      { name: "orphan", missing: [], drifted: ["Claude"] },
    ]);
  });

  it("a lock skill outside the standalone scan counts as present where its folder exists on disk", () => {
    const root = mkdtempSync(join(tmpdir(), "bb-skill-preview-"));
    const onDisk = [tool("claude-code", "Claude"), tool("openai-codex", "Codex")].map((t) => ({ ...t, configDir: join(root, t.toolId) }));
    mkdirSync(join(root, "openai-codex", "skills", "skill-creator"), { recursive: true });
    writeFileSync(join(root, "openai-codex", "skills", "skill-creator", "SKILL.md"), "# skill-creator\n");
    expect(rows(buildSkillSyncPreview([], onDisk, new Set(["skill-creator"])))).toEqual([{ name: "skill-creator", missing: ["Claude"], drifted: [] }]);
  });

  it("fully installed lock skills produce no row", () => {
    expect(buildSkillSyncPreview([skill("find-skills", { installedOn: ["claude-code", "openai-codex"] })], tools, new Set(["find-skills"]))).toEqual([]);
  });
});
