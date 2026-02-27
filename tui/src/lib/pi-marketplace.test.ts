import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { writeFileSync, rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getSourceType, scanLocalMarketplace } from "./pi-marketplace.js";

describe("getSourceType", () => {
  it("detects npm sources", () => {
    expect(getSourceType("npm:@foo/bar")).toBe("npm");
    expect(getSourceType("npm:my-package")).toBe("npm");
    expect(getSourceType("npm:@scope/pkg@1.0.0")).toBe("npm");
  });

  it("detects git sources", () => {
    expect(getSourceType("git:github.com/user/repo")).toBe("git");
    expect(getSourceType("https://github.com/user/repo")).toBe("git");
    expect(getSourceType("https://github.com/user/repo.git")).toBe("git");
    expect(getSourceType("git@github.com:user/repo.git")).toBe("git");
    expect(getSourceType("https://gitlab.com/group/repo.git")).toBe("git");
  });

  it("detects local sources", () => {
    expect(getSourceType("/absolute/path")).toBe("local");
    expect(getSourceType("./relative/path")).toBe("local");
    expect(getSourceType("~/home/path")).toBe("local");
  });
});

describe("scanLocalMarketplace", () => {
  const TEST_DIR = join(tmpdir(), `blackbook-pi-market-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("finds packages with pi key in package.json", () => {
    const pkgDir = join(TEST_DIR, "my-pi-pkg");
    mkdirSync(pkgDir);
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "my-pi-pkg",
        description: "A test package",
        version: "1.0.0",
        pi: {
          extensions: ["./ext.ts"],
          skills: ["./skills"],
        },
      })
    );

    const packages = scanLocalMarketplace("test", TEST_DIR);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe("my-pi-pkg");
    expect(packages[0].description).toBe("A test package");
    expect(packages[0].sourceType).toBe("local");
    expect(packages[0].marketplace).toBe("test");
  });

  it("finds packages with pi-package keyword", () => {
    const pkgDir = join(TEST_DIR, "keyword-pkg");
    mkdirSync(pkgDir);
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "keyword-pkg",
        keywords: ["pi-package", "utility"],
      })
    );

    const packages = scanLocalMarketplace("test", TEST_DIR);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe("keyword-pkg");
  });

  it("ignores packages without pi key or keyword", () => {
    const pkgDir = join(TEST_DIR, "regular-pkg");
    mkdirSync(pkgDir);
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "regular-pkg",
        version: "1.0.0",
      })
    );

    const packages = scanLocalMarketplace("test", TEST_DIR);
    expect(packages).toHaveLength(0);
  });

  it("scans convention directories when no pi manifest", () => {
    const pkgDir = join(TEST_DIR, "convention-pkg");
    mkdirSync(pkgDir);
    mkdirSync(join(pkgDir, "extensions"));
    mkdirSync(join(pkgDir, "skills"));
    writeFileSync(join(pkgDir, "extensions", "my-ext.ts"), "// extension");
    writeFileSync(join(pkgDir, "skills", "SKILL.md"), "# Skill");
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "convention-pkg",
        keywords: ["pi-package"],
      })
    );

    const packages = scanLocalMarketplace("test", TEST_DIR);
    expect(packages).toHaveLength(1);
    expect(packages[0].extensions).toContain("my-ext.ts");
    expect(packages[0].skills).toContain("SKILL.md");
  });

  it("returns empty array for non-existent path", () => {
    const packages = scanLocalMarketplace("test", "/nonexistent/path");
    expect(packages).toHaveLength(0);
  });
});
