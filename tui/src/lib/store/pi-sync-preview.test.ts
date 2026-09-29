import { describe, it, expect } from "vitest";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { buildPiPackageSyncPreview } from "./files-slice.js";
import type { PiPackage } from "../types.js";

const pkg = (over: Partial<PiPackage>): PiPackage =>
  ({ name: "p", description: "", version: "1.0.0", source: "npm:p", sourceType: "npm", marketplace: "npm", installed: true, ...over }) as PiPackage;

const rows = (packages: PiPackage[]) =>
  buildPiPackageSyncPreview(packages).map((i) => (i.kind === "piPackage" ? `${i.piPackage.name}:${i.problem}` : ""));

describe("buildPiPackageSyncPreview (Pi's own settings are the truth per machine)", () => {
  it("never flags a recommended package this machine's settings don't list", () => {
    expect(rows([pkg({ name: "suggested", installed: false, recommended: true })])).toEqual([]);
  });

  it("flags a listed npm package that no package manager has as missing", () => {
    expect(rows([pkg({ name: "gone", installedVersion: undefined })])).toEqual(["gone:missing"]);
  });

  it("flags a listed local package whose path is gone, and not one that exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "bb-pi-local-"));
    expect(rows([
      pkg({ name: "here", sourceType: "local", source: dir }),
      pkg({ name: "moved", sourceType: "local", source: join(dir, "nope") }),
    ])).toEqual(["moved:missing"]);
  });

  it("flags an installed package with an update, and nothing for a current one or a git source", () => {
    expect(rows([
      pkg({ name: "old", installedVersion: "0.9.0", hasUpdate: true }),
      pkg({ name: "current", installedVersion: "1.0.0" }),
      pkg({ name: "gitpkg", sourceType: "git", source: "git:github.com/o/r" }),
    ])).toEqual(["old:update"]);
  });
});
