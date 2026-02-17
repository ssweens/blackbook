import { describe, it, expect } from "vitest";
import { deepMerge } from "./merge.js";

describe("deepMerge", () => {
  it("merges scalar values (override wins)", () => {
    const result = deepMerge({ a: "base" }, { a: "override" });
    expect(result.a).toBe("override");
  });

  it("adds new keys from override", () => {
    const result = deepMerge({ a: 1 }, { b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("null deletes a key", () => {
    const result = deepMerge({ a: 1, b: 2 }, { a: null });
    expect(result).toEqual({ b: 2 });
    expect("a" in result).toBe(false);
  });

  it("deep merges nested objects", () => {
    const result = deepMerge(
      { settings: { source_repo: "~/dotfiles", package_manager: "pnpm" } },
      { settings: { package_manager: "bun" } },
    );
    expect(result.settings).toEqual({ source_repo: "~/dotfiles", package_manager: "bun" });
  });

  it("replaces scalar arrays entirely", () => {
    const result = deepMerge(
      { tags: ["a", "b", "c"] },
      { tags: ["x", "y"] },
    );
    expect(result.tags).toEqual(["x", "y"]);
  });

  it("merges arrays of objects by 'name' key", () => {
    const base = {
      files: [
        { name: "A", source: "a.md", target: "a.md" },
        { name: "B", source: "b.md", target: "b.md" },
      ],
    };
    const override = {
      files: [
        { name: "A", target: "custom.md" } as Record<string, string>,
        { name: "C", source: "c.md", target: "c.md" },
      ],
    };
    const result = deepMerge(base, override);
    const files = result.files as Array<Record<string, unknown>>;
    expect(files).toHaveLength(3);
    // A merged
    expect(files[0]).toEqual({ name: "A", source: "a.md", target: "custom.md" });
    // B unchanged
    expect(files[1]).toEqual({ name: "B", source: "b.md", target: "b.md" });
    // C added
    expect(files[2]).toEqual({ name: "C", source: "c.md", target: "c.md" });
  });

  it("merges arrays of objects by 'id' key", () => {
    const base = {
      instances: [
        { id: "default", name: "Claude", config_dir: "~/.claude" },
      ],
    };
    const override = {
      instances: [
        { id: "default", config_dir: "~/custom/claude" },
      ],
    };
    const result = deepMerge(base, override);
    const instances = result.instances as Array<Record<string, unknown>>;
    expect(instances).toHaveLength(1);
    expect(instances[0]).toEqual({ id: "default", name: "Claude", config_dir: "~/custom/claude" });
  });

  it("handles override array with new items only", () => {
    const base = { items: [{ name: "A", value: 1 }] };
    const override = { items: [{ name: "B", value: 2 }] };
    const result = deepMerge(base, override);
    const items = result.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
  });

  it("handles type mismatch (override wins)", () => {
    const result = deepMerge(
      { x: "string" },
      { x: [1, 2, 3] },
    );
    expect(result.x).toEqual([1, 2, 3]);
  });

  it("handles empty base", () => {
    const result = deepMerge({}, { a: 1 });
    expect(result).toEqual({ a: 1 });
  });

  it("handles empty override", () => {
    const result = deepMerge({ a: 1 }, {});
    expect(result).toEqual({ a: 1 });
  });
});
