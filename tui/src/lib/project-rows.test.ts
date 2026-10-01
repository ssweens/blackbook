import { describe, it, expect } from "vitest";
import { buildProjectRows, skillNamespaceFromSourcePath } from "./projects.js";
import type { ProjectInfo } from "./projects.js";

function project(): ProjectInfo {
  return {
    path: "/p", name: "p", exists: true, hasAgentsDir: true,
    skills: [
      { name: "mixing-fundamentals", diskPath: "/p/.agents/skills/mixing-fundamentals", enabled: true, status: "in-sync", sourcePath: "/repo/skills/ssmp/mixing-fundamentals" },
      { name: "deslop", diskPath: "/p/.agents/skills/deslop", enabled: true, status: "drifted", sourcePath: "/repo/skills/deslop" },
    ],
    available: [
      { name: "vocal-mixing", sourcePath: "/repo/skills/ssmp/vocal-mixing" },
      { name: "qc-review", sourcePath: "/repo/skills/qc-review" },
    ],
  } as ProjectInfo;
}

const label = (rows: ReturnType<typeof buildProjectRows>) =>
  rows.map((r) => r.kind === "namespace" ? `# ${r.name} (${r.count})${r.collapsed ? " ▸" : " ▾"}` : `  ${r.kind === "present" ? r.skill.name : r.available.name}@${r.depth}`);

describe("skillNamespaceFromSourcePath", () => {
  it("reads the namespace segment under skills/, else null", () => {
    expect(skillNamespaceFromSourcePath("/repo/skills/ssmp/vocal-mixing")).toBe("ssmp");
    expect(skillNamespaceFromSourcePath("/repo/skills/deslop")).toBeNull();
    expect(skillNamespaceFromSourcePath(undefined)).toBeNull();
  });
});

describe("buildProjectRows", () => {
  it("groups namespaced skills under collapsible headers, top-level skills after with no header", () => {
    expect(label(buildProjectRows(project(), "", new Set()))).toEqual([
      "# ssmp (2) ▾",
      "  mixing-fundamentals@1",
      "  vocal-mixing@1",
      "  deslop@0",
      "  qc-review@0",
    ]);
  });

  it("a collapsed namespace shows only its header", () => {
    expect(label(buildProjectRows(project(), "", new Set(["ssmp"])))).toEqual([
      "# ssmp (2) ▸",
      "  deslop@0",
      "  qc-review@0",
    ]);
  });

  it("expandAll overrides collapse so search matches stay visible", () => {
    const rows = buildProjectRows(project(), "mix", new Set(["ssmp"]), { expandAll: true });
    expect(label(rows)).toEqual(["# ssmp (2) ▾", "  mixing-fundamentals@1", "  vocal-mixing@1"]);
  });
});
