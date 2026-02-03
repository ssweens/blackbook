import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeDiffCounts,
  computeUnifiedDiff,
  isBinaryFile,
  computeFileDetail,
  buildAssetDiffTarget,
  buildAssetMissingSummary,
  buildConfigDiffTarget,
  buildConfigMissingSummary,
  getDriftedAssetInstances,
  getMissingAssetInstances,
} from "./diff.js";
import type { DiffFileSummary, Asset, ConfigFile, DiffInstanceRef } from "./types.js";

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
      };

      const detail = computeFileDetail(summary);
      expect(detail.hunks.length).toBeGreaterThan(0);
      expect(detail.hunks[0].lines.some((l) => l.type === "add" && l.content === "lineNew")).toBe(
        true
      );
      expect(detail.hunks[0].lines.some((l) => l.type === "remove" && l.content === "lineOld")).toBe(
        true
      );
    });

    it("handles missing target (all additions)", () => {
      const sourceFile = join(testDir, "source.txt");
      writeFileSync(sourceFile, "new content\n");

      const summary: DiffFileSummary = {
        id: "test",
        displayPath: "test.txt",
        sourcePath: sourceFile,
        targetPath: join(testDir, "nonexistent.txt"),
        status: "missing",
        linesAdded: 1,
        linesRemoved: 0,
      };

      const detail = computeFileDetail(summary);
      expect(detail.hunks.length).toBeGreaterThan(0);
      // All lines should be additions (type === "add")
      const allAdds = detail.hunks.every((h) =>
        h.lines.every((l) => l.type === "add" || l.type === "context")
      );
      expect(allAdds).toBe(true);
    });

    it("handles extra file (all removals)", () => {
      const targetFile = join(testDir, "target.txt");
      writeFileSync(targetFile, "extra content\n");

      const summary: DiffFileSummary = {
        id: "test",
        displayPath: "test.txt",
        sourcePath: null,
        targetPath: targetFile,
        status: "extra",
        linesAdded: 0,
        linesRemoved: 1,
      };

      const detail = computeFileDetail(summary);
      expect(detail.hunks.length).toBeGreaterThan(0);
      // All lines should be removals (type === "remove")
      const allRemoves = detail.hunks.every((h) =>
        h.lines.every((l) => l.type === "remove" || l.type === "context")
      );
      expect(allRemoves).toBe(true);
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
});
