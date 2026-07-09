import { describe, it, expect } from "vitest";
import { homedir } from "os";
import { join } from "path";
import { expandTilde } from "./path-utils.js";

describe("expandTilde", () => {
  it("expands a bare tilde to the home directory", () => {
    expect(expandTilde("~")).toBe(homedir());
  });

  it("expands ~/foo/bar without discarding the home directory", () => {
    // Regression: stripping only the tilde left an absolute "/foo/bar", which
    // resolve(home, "/foo/bar") collapsed back to "/foo/bar".
    expect(expandTilde("~/foo/bar")).toBe(join(homedir(), "foo", "bar"));
  });

  it("expands ~/ to the home directory", () => {
    expect(expandTilde("~/")).toBe(homedir());
  });

  it("leaves an already-absolute path unchanged", () => {
    expect(expandTilde("/already/absolute")).toBe("/already/absolute");
  });

  it("leaves a relative path unchanged", () => {
    expect(expandTilde("foo/bar")).toBe("foo/bar");
  });
});
