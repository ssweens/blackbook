import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeDiffCounts,
  computeUnifiedDiff,
  isBinaryFile,
  computeFileDetail,
  buildFileDiffTarget,
  buildFileMissingSummary,
} from "./diff.js";
import type { DiffFileSummary, DiffInstanceRef } from "./types.js";

describe("diff utilities", () => {
  describe("computeDiffCounts", () => {
    it("counts added and removed lines correctly", () => {
      const oldText = "line1\nline2\nline3\n";
      const newText = "line1\nlineModified\nline3\nline4\n";
      const result = computeDiffCounts(oldText, newText);
      expect(result.linesAdded).toBe(2);
      expect(result.linesRemoved).toBe(1);
    });

    it("returns zeros for identical content", () => {
      const text = "same\ncontent\n";
      const result = computeDiffCounts(text, text);
      expect(result.linesAdded).toBe(0);
      expect(result.linesRemoved).toBe(0);
    });

    it("handles empty strings", () => {
      const result = computeDiffCounts("", "new content\n");
      expect(result.linesAdded).toBe(1);
      expect(result.linesRemoved).toBe(0);
    });

    it("handles all lines removed", () => {
      const result = computeDiffCounts("old content\n", "");
      expect(result.linesAdded).toBe(0);
      expect(result.linesRemoved).toBe(1);
    });
  });

  describe("computeUnifiedDiff", () => {
    it("produces hunks with correct structure", () => {
      const oldText = "line1\nline2\nline3\n";
      const newText = "line1\nmodified\nline3\n";
      const hunks = computeUnifiedDiff(oldText, newText, "old", "new");

      expect(hunks.length).toBeGreaterThan(0);
      expect(hunks[0].header).toContain("@@");
      expect(hunks[0].lines.some((l) => l.type === "remove")).toBe(true);
      expect(hunks[0].lines.some((l) => l.type === "add")).toBe(true);
    });

    it("returns empty array for identical content", () => {
      const text = "same\n";
      const hunks = computeUnifiedDiff(text, text, "old", "new");
      expect(hunks).toEqual([]);
    });

    it("handles adding content to empty file", () => {
      const hunks = computeUnifiedDiff("", "new line\n", "old", "new");
      expect(hunks.length).toBeGreaterThan(0);
      expect(hunks[0].lines.every((l) => l.type === "add" || l.type === "context")).toBe(true);
    });
  });

  describe("isBinaryFile", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `blackbook-diff-test-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("returns false for text file", () => {
      const textFile = join(testDir, "text.txt");
      writeFileSync(textFile, "hello world\n");
      expect(isBinaryFile(textFile)).toBe(false);
    });

    it("returns true for binary file with null bytes", () => {
      const binFile = join(testDir, "binary.bin");
      const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]); // "Hel\0o"
      writeFileSync(binFile, buffer);
      expect(isBinaryFile(binFile)).toBe(true);
    });

    it("returns false for nonexistent file", () => {
      expect(isBinaryFile(join(testDir, "nonexistent.txt"))).toBe(false);
    });
  });

  describe("computeFileDetail", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `blackbook-diff-detail-${Date.now()}`);
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("computes hunks for modified file", () => {
      // GitHub-style orientation: local (target) = head/green/+, source = base/red/-
      // Source has "lineNew" (base), target has "lineOld" (head).
      // So diff shows: REMOVE "lineNew" (was in base) + ADD "lineOld" (now in head).
      const sourceFile = join(testDir, "source.txt");
      const targetFile = join(testDir, "target.txt");
      writeFileSync(sourceFile, "line1\nlineNew\nline3\n");
      writeFileSync(targetFile, "line1\nlineOld\nline3\n");

      const summary: DiffFileSummary = {
        id: "test",
        displayPath: "test.txt",
        sourcePath: sourceFile,
        targetPath: targetFile,
        status: "modified",
        linesAdded: 1,
        linesRemoved: 1,
        sourceMtime: null,
        targetMtime: null,
      };

      const detail = computeFileDetail(summary);
      expect(detail.hunks.length).toBeGreaterThan(0);
      // Target (head) has lineOld -> shown as ADDITION
      expect(detail.hunks[0].lines.some((l) => l.type === "add" && l.content === "lineOld")).toBe(
        true
      );
      // Source (base) had lineNew -> shown as REMOVAL
      expect(detail.hunks[0].lines.some((l) => l.type === "remove" && l.content === "lineNew")).toBe(
        true
      );
    });

    it("handles missing target (all removals from head)", () => {
      // Source has content, target doesn't. In GitHub orientation: base had content,
      // head doesn't -> all REMOVALS.
      const sourceFile = join(testDir, "source.txt");
      writeFileSync(sourceFile, "new content\n");

      const summary: DiffFileSummary = {
        id: "test",
        displayPath: "test.txt",
        sourcePath: sourceFile,
        targetPath: join(testDir, "nonexistent.txt"),
        status: "missing",
        linesAdded: 0,
        linesRemoved: 1,
        sourceMtime: null,
        targetMtime: null,
      };

      const detail = computeFileDetail(summary);
      expect(detail.hunks.length).toBeGreaterThan(0);
      const allRemoves = detail.hunks.every((h) =>
        h.lines.every((l) => l.type === "remove" || l.type === "context")
      );
      expect(allRemoves).toBe(true);
    });

    it("handles extra file (all additions in head)", () => {
      // Target exists, source doesn't. In GitHub orientation: head has content that
      // base doesn't -> all ADDITIONS.
      const targetFile = join(testDir, "target.txt");
      writeFileSync(targetFile, "extra content\n");

      const summary: DiffFileSummary = {
        id: "test",
        displayPath: "test.txt",
        sourcePath: null,
        targetPath: targetFile,
        status: "extra",
        linesAdded: 1,
        linesRemoved: 0,
        sourceMtime: null,
        targetMtime: null,
      };

      const detail = computeFileDetail(summary);
      expect(detail.hunks.length).toBeGreaterThan(0);
      const allAdds = detail.hunks.every((h) =>
        h.lines.every((l) => l.type === "add" || l.type === "context")
      );
      expect(allAdds).toBe(true);
    });

    it("returns empty hunks for binary file", () => {
      const summary: DiffFileSummary = {
        id: "test",
        displayPath: "test.bin",
        sourcePath: null,
        targetPath: null,
        status: "binary",
        linesAdded: 0,
        linesRemoved: 0,
        sourceMtime: null,
        targetMtime: null,
      };

      const detail = computeFileDetail(summary);
      expect(detail.hunks).toEqual([]);
      expect(detail.status).toBe("binary");
    });
  });
});

describe("diff target builders", () => {
  // These tests require mocking getToolInstances and file system
  // For now we test the core logic; full integration tests would be in install.integration.test.ts
  describe("DiffInstanceRef structure", () => {
    it("has required fields", () => {
      const ref: DiffInstanceRef = {
        toolId: "claude-code",
        instanceId: "default",
        instanceName: "Claude",
        configDir: "/home/user/.claude",
      };
      expect(ref.toolId).toBe("claude-code");
      expect(ref.instanceId).toBe("default");
      expect(ref.instanceName).toBe("Claude");
      expect(ref.configDir).toBe("/home/user/.claude");
    });
  });

  describe("glob sources spanning subdirectories preserve structure", () => {
    let testDir: string;
    let sourceDir: string;
    let targetDir: string;
    const instance: DiffInstanceRef = {
      toolId: "test-tool",
      instanceId: "default",
      instanceName: "Test",
      configDir: "",
    };

    beforeEach(() => {
      testDir = join(tmpdir(), `blackbook-diff-glob-${Date.now()}`);
      sourceDir = join(testDir, "source");
      targetDir = join(testDir, "target");
      mkdirSync(join(sourceDir, "themes", "nested"), { recursive: true });
      mkdirSync(join(targetDir, "themes", "nested"), { recursive: true });
    });

    afterEach(() => {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("buildFileDiffTarget diffs against the nested target path, not a flattened basename", () => {
      // Source and target counterparts live under themes/ and themes/nested/,
      // matching what glob-copy.ts actually writes to on a real sync.
      writeFileSync(join(sourceDir, "themes", "dark.json"), "line1\nline2\n");
      writeFileSync(join(targetDir, "themes", "dark.json"), "line1\nlineChanged\n");
      writeFileSync(join(sourceDir, "themes", "nested", "light.json"), "lineA\nlineB\n");
      writeFileSync(join(targetDir, "themes", "nested", "light.json"), "lineA\nlineChangedB\n");

      const globPattern = join(sourceDir, "themes", "**", "*.json");
      const result = buildFileDiffTarget("Test", "Test", globPattern, targetDir, instance);

      expect(result.files.length).toBe(2);

      const dark = result.files.find((f) => f.displayPath === join("themes", "dark.json"));
      const light = result.files.find((f) => f.displayPath === join("themes", "nested", "light.json"));

      expect(dark).toBeDefined();
      expect(light).toBeDefined();

      // The computed target path must resolve to the nested location that
      // glob-copy.ts actually writes to, not <targetDir>/dark.json / <targetDir>/light.json.
      expect(dark!.targetPath).toBe(join(targetDir, "themes", "dark.json"));
      expect(light!.targetPath).toBe(join(targetDir, "themes", "nested", "light.json"));

      // Since the nested target files were found and differ from source, status
      // should be "modified" (not "missing" — which is what the basename bug produced).
      expect(dark!.status).toBe("modified");
      expect(light!.status).toBe("modified");
    });

    it("buildFileMissingSummary reports files present at their nested target path (not missing)", () => {
      writeFileSync(join(sourceDir, "themes", "dark.json"), "line1\nline2\n");
      writeFileSync(join(targetDir, "themes", "dark.json"), "line1\nline2\n");
      writeFileSync(join(sourceDir, "themes", "nested", "light.json"), "lineA\nlineB\n");
      // Intentionally do NOT create the nested target counterpart for light.json,
      // so it should genuinely be reported missing.

      const globPattern = join(sourceDir, "themes", "**", "*.json");
      const result = buildFileMissingSummary("Test", "Test", globPattern, targetDir, instance);

      // dark.json exists at its nested target path, so it must NOT be reported missing.
      expect(result.missingFiles).not.toContain(join("themes", "dark.json"));
      // light.json has no target counterpart at all, so it should be reported missing.
      expect(result.missingFiles).toContain(join("themes", "nested", "light.json"));
    });
  });
});
