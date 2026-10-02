import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compareLockToInstall, lockInstallText } from "./lock-install-sync.js";
import type { LockEntry } from "./skill-profiles.js";

const entry = (): LockEntry => ({ source: "o/r", sourceType: "github" });
const mkSkill = (dir: string, name: string, body = "x") => {
  const d = join(dir, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "SKILL.md"), `---\nname: ${name}\n---\n${body}\n`);
  return d;
};

let installed: string;
let source: string;

beforeEach(() => {
  installed = mkdtempSync(join(tmpdir(), "bb-inst-"));
  source = mkdtempSync(join(tmpdir(), "bb-src-"));
});
afterEach(() => {
  rmSync(installed, { recursive: true, force: true });
  rmSync(source, { recursive: true, force: true });
});

describe("compareLockToInstall", () => {
  it("is out of sync with a missing count when lock skills aren't installed", () => {
    const skills = { a: entry(), b: entry(), c: entry() };
    mkSkill(installed, "a"); // only a installed
    const h = compareLockToInstall(skills, installed, new Map());
    expect(h.state).toBe("out-of-sync");
    expect(h.missing).toBe(2);
    expect(h.color).toBe("red");
    expect(lockInstallText(h).text).toBe("out of sync · 2 missing");
  });

  it("is in sync when every lock skill is installed (and no source to drift-check)", () => {
    const skills = { a: entry(), b: entry() };
    mkSkill(installed, "a");
    mkSkill(installed, "b");
    const h = compareLockToInstall(skills, installed, new Map());
    expect(h.state).toBe("in-sync");
    expect(lockInstallText(h)).toEqual({ text: "in sync", color: "green" });
  });

  it("flags drift when installed content differs from the source", () => {
    const skills = { a: entry() };
    mkSkill(installed, "a", "changed");
    const srcA = mkSkill(source, "a", "original");
    const h = compareLockToInstall(skills, installed, new Map([["a", srcA]]));
    expect(h.state).toBe("out-of-sync");
    expect(h.drifted).toBe(1);
    expect(h.missing).toBe(0);
    expect(h.color).toBe("yellow");
    expect(lockInstallText(h).text).toBe("out of sync · 1 drifted");
  });

  it("counts both missing and drifted", () => {
    const skills = { a: entry(), b: entry() };
    mkSkill(installed, "a", "changed");
    const srcA = mkSkill(source, "a", "original");
    const h = compareLockToInstall(skills, installed, new Map([["a", srcA]]));
    expect(h.missing).toBe(1); // b
    expect(h.drifted).toBe(1); // a
    expect(lockInstallText(h).text).toBe("out of sync · 1 missing, 1 drifted");
  });

  it("reports an empty lock distinctly", () => {
    const h = compareLockToInstall({}, installed, new Map());
    expect(h.state).toBe("empty");
    expect(lockInstallText(h).text).toBe("empty");
  });
});
