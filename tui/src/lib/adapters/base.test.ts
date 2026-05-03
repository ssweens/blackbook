import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  atomicCopyDir,
  atomicCopyFile,
  atomicWriteFile,
  checkRequiredEnv,
  collectMcpEnvRefs,
  discoverMarkdownDir,
  discoverSkillsDir,
  expandHome,
  extractEnvRef,
  hashDir,
  hashFile,
  resolveEnvValue,
} from "./base.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "blackbook-base-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("expandHome", () => {
  it("expands lone tilde", () => {
    expect(expandHome("~")).not.toContain("~");
  });
  it("expands ~/path", () => {
    expect(expandHome("~/x")).toMatch(/[/\\]x$/);
  });
  it("passes absolute paths through", () => {
    expect(expandHome("/abs/path")).toBe("/abs/path");
  });
});

describe("atomicWriteFile + hashFile", () => {
  it("writes a file and hashes deterministically", () => {
    const p = join(tmp, "f.txt");
    atomicWriteFile(p, "hello");
    expect(hashFile(p)).toBe(hashFile(p));
  });

  it("creates parent dirs", () => {
    atomicWriteFile(join(tmp, "deep/path/f.txt"), "x");
    // No throw
  });
});

describe("atomicCopyFile + atomicCopyDir", () => {
  it("copies a file", () => {
    const src = join(tmp, "src.txt");
    const dest = join(tmp, "dest.txt");
    writeFileSync(src, "abc");
    atomicCopyFile(src, dest);
    expect(hashFile(src)).toBe(hashFile(dest));
  });

  it("copies a directory recursively", () => {
    const src = join(tmp, "src");
    mkdirSync(src);
    writeFileSync(join(src, "a.txt"), "a");
    mkdirSync(join(src, "sub"));
    writeFileSync(join(src, "sub", "b.txt"), "b");
    const dest = join(tmp, "dest");
    atomicCopyDir(src, dest);
    expect(hashDir(src)).toBe(hashDir(dest));
  });

  it("overwrites existing dest atomically", () => {
    const src = join(tmp, "src");
    mkdirSync(src);
    writeFileSync(join(src, "a.txt"), "newer");
    const dest = join(tmp, "dest");
    mkdirSync(dest);
    writeFileSync(join(dest, "old.txt"), "stale");
    atomicCopyDir(src, dest);
    expect(hashDir(src)).toBe(hashDir(dest));
  });
});

describe("hashDir", () => {
  it("differs for different content", () => {
    const a = join(tmp, "a");
    const b = join(tmp, "b");
    mkdirSync(a);
    mkdirSync(b);
    writeFileSync(join(a, "x"), "1");
    writeFileSync(join(b, "x"), "2");
    expect(hashDir(a)).not.toBe(hashDir(b));
  });
  it("matches for identical content", () => {
    const a = join(tmp, "a");
    const b = join(tmp, "b");
    mkdirSync(a);
    mkdirSync(b);
    writeFileSync(join(a, "x"), "same");
    writeFileSync(join(b, "x"), "same");
    expect(hashDir(a)).toBe(hashDir(b));
  });
  it("is order-independent for sibling files", () => {
    const a = join(tmp, "a");
    const b = join(tmp, "b");
    mkdirSync(a);
    mkdirSync(b);
    writeFileSync(join(a, "1"), "x");
    writeFileSync(join(a, "2"), "y");
    writeFileSync(join(b, "2"), "y");
    writeFileSync(join(b, "1"), "x");
    expect(hashDir(a)).toBe(hashDir(b));
  });
});

describe("env-var indirection", () => {
  it("extracts $env:NAME placeholder", () => {
    expect(extractEnvRef("$env:GITHUB_TOKEN")).toBe("GITHUB_TOKEN");
  });
  it("extracts {from_env: NAME}", () => {
    expect(extractEnvRef({ from_env: "X" })).toBe("X");
  });
  it("rejects literal strings", () => {
    expect(extractEnvRef("just a value")).toBeUndefined();
  });
  it("resolveEnvValue returns env value for refs", () => {
    expect(resolveEnvValue("$env:FOO", { FOO: "bar" } as NodeJS.ProcessEnv)).toBe("bar");
  });
  it("resolveEnvValue returns literal when not a ref", () => {
    expect(resolveEnvValue("literal", {} as NodeJS.ProcessEnv)).toBe("literal");
  });
  it("collectMcpEnvRefs returns bearerTokenEnv for remote", () => {
    expect(
      collectMcpEnvRefs({
        name: "x",
        type: "remote",
        url: "https://x",
        bearerTokenEnv: "TOKEN",
        headers: {},
        enabled: true,
        compat: {},
      }),
    ).toEqual(["TOKEN"]);
  });
  it("collectMcpEnvRefs returns env-map refs for local", () => {
    expect(
      collectMcpEnvRefs({
        name: "x",
        type: "local",
        command: ["echo"],
        env: { A: "$env:A_VAR", B: "literal" },
        enabled: true,
        compat: {},
      }),
    ).toEqual(["A_VAR"]);
  });
});

describe("discoverSkillsDir", () => {
  it("finds dirs containing SKILL.md", () => {
    const skills = join(tmp, "skills");
    mkdirSync(join(skills, "ok"), { recursive: true });
    writeFileSync(join(skills, "ok", "SKILL.md"), "# ok");
    mkdirSync(join(skills, "missing"), { recursive: true });
    const found = discoverSkillsDir(skills);
    expect(found.map((f) => f.name)).toEqual(["ok"]);
  });
  it("skips dot-prefixed dirs (e.g. .system)", () => {
    const skills = join(tmp, "skills");
    mkdirSync(join(skills, ".system"), { recursive: true });
    writeFileSync(join(skills, ".system", "SKILL.md"), "# system");
    expect(discoverSkillsDir(skills)).toEqual([]);
  });
  it("returns [] for missing dir", () => {
    expect(discoverSkillsDir(join(tmp, "nope"))).toEqual([]);
  });
});

describe("discoverMarkdownDir", () => {
  it("finds .md files", () => {
    const dir = join(tmp, "commands");
    mkdirSync(dir);
    writeFileSync(join(dir, "a.md"), "");
    writeFileSync(join(dir, "b.md"), "");
    writeFileSync(join(dir, "c.txt"), "");
    expect(discoverMarkdownDir(dir).map((f) => f.name)).toEqual(["a", "b"]);
  });
});

describe("checkRequiredEnv", () => {
  it("reports missing", () => {
    expect(checkRequiredEnv(["A", "B"], { A: "x" } as NodeJS.ProcessEnv)).toEqual({
      ok: false,
      missing: ["B"],
    });
  });
  it("ok when all set", () => {
    expect(checkRequiredEnv(["A"], { A: "x" } as NodeJS.ProcessEnv)).toEqual({
      ok: true,
      missing: [],
    });
  });
});
