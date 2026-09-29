import { describe, it, expect } from "vitest";
import { buildRows } from "./ProfilesTab.js";

const namespaces = [
  { name: "anthropics/skills", skills: ["docx", "pdf"] },
  { name: "ssmp", skills: ["mixing-fundamentals", "vocal-mixing"] },
];
const topLevel = ["deslop", "qc-mix"];

describe("ProfilesTab buildRows", () => {
  it("is a tree by default, with namespaces expanding to their skills", () => {
    const rows = buildRows(namespaces, topLevel, new Set(["ssmp"]));
    expect(rows.map((r) => `${r.kind}:${r.name}`)).toEqual([
      "namespace:anthropics/skills",
      "namespace:ssmp",
      "skill:mixing-fundamentals",
      "skill:vocal-mixing",
      "skill:deslop",
      "skill:qc-mix",
    ]);
  });

  it("a query gives a flat, sorted list of every matching skill with its namespace, even in collapsed groups", () => {
    const rows = buildRows(namespaces, topLevel, new Set(), { query: "MIX" });
    expect(rows).toEqual([
      { kind: "skill", name: "mixing-fundamentals", depth: 0, namespace: "ssmp" },
      { kind: "skill", name: "qc-mix", depth: 0 },
      { kind: "skill", name: "vocal-mixing", depth: 0, namespace: "ssmp" },
    ]);
  });

  it("selected-only lists just the selected skills, combinable with a query", () => {
    const selected = new Set(["pdf", "deslop", "vocal-mixing"]);
    expect(buildRows(namespaces, topLevel, new Set(), { selectedOnly: true, selected }).map((r) => r.name)).toEqual(["deslop", "pdf", "vocal-mixing"]);
    expect(buildRows(namespaces, topLevel, new Set(), { selectedOnly: true, selected, query: "d" }).map((r) => r.name)).toEqual(["deslop", "pdf"]);
  });
});
