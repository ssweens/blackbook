import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { SkillFileBrowser } from "./SkillFileBrowser.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "blackbook-skill-preview-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("SkillFileBrowser", () => {
  it("opens and previews a skill file", async () => {
    writeFileSync(join(root, "SKILL.md"), "# Example skill\nPreview text");
    const onClose = vi.fn();
    const { lastFrame, stdin } = render(
      React.createElement(SkillFileBrowser, {
        skillName: "example",
        rootPath: root,
        onClose,
      }),
    );

    expect(lastFrame()).toContain("SKILL.md");
    act(() => stdin.write("\r"));
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("# Example skill");
      expect(lastFrame()).toContain("Preview text");
    });

    act(() => stdin.write("\u001b"));
    await vi.waitFor(() => expect(lastFrame()).toContain("Files · example"));
    expect(onClose).not.toHaveBeenCalled();
    act(() => stdin.write("\u001b"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("navigates into folders and previews other files", async () => {
    mkdirSync(join(root, "references"));
    writeFileSync(join(root, "references", "guide.txt"), "Nested reference content");
    const { lastFrame, stdin } = render(
      React.createElement(SkillFileBrowser, {
        skillName: "example",
        rootPath: root,
        onClose: vi.fn(),
      }),
    );

    expect(lastFrame()).toContain("references/");
    act(() => stdin.write("\r"));
    await vi.waitFor(() => expect(lastFrame()).toContain("guide.txt"));
    act(() => stdin.write("\r"));
    await vi.waitFor(() => expect(lastFrame()).toContain("Nested reference content"));
  });

  it("does not render binary file contents", async () => {
    writeFileSync(join(root, "image.bin"), Buffer.from([0, 1, 2, 3]));
    const { lastFrame, stdin } = render(
      React.createElement(SkillFileBrowser, {
        skillName: "example",
        rootPath: root,
        onClose: vi.fn(),
      }),
    );

    act(() => stdin.write("\r"));
    await vi.waitFor(() => expect(lastFrame()).toContain("Binary files cannot be previewed as text."));
  });
});
