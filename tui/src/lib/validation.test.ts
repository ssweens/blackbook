import { describe, it, expect } from "vitest";
import { join } from "path";
import {
  validatePluginName,
  validateMarketplaceName,
  validateItemName,
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
});
