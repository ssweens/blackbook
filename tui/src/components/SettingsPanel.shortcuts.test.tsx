import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig } from "../lib/config/loader.js";
import { SettingsPanel, buildMenuItems, updateDevShortcuts } from "./SettingsPanel.js";

const DOWN = "\u001B[B";
const ENTER = "\r";
const tick = () => new Promise((r) => setTimeout(r, 30));

async function waitFor(frame: () => string | undefined, pred: (f: string) => boolean, ms = 3000): Promise<string> {
  const end = Date.now() + ms;
  for (;;) {
    const f = frame() ?? "";
    if (pred(f)) return f;
    if (Date.now() > end) throw new Error(`Timed out. Last frame:\n${f}`);
    await tick();
  }
}

async function typeText(stdin: { write: (s: string) => void }, text: string): Promise<void> {
  stdin.write(text);
  await tick();
}

describe("dev shortcut helpers", () => {
  it("lists shortcuts sorted, followed by the add action", () => {
    const items = buildMenuItems(null, { "github.com/b/b": "~/b", "github.com/a/a": "~/a" });
    const rows = items.filter((i) => i.kind === "shortcut" || (i.kind === "action" && i.id === "add_shortcut"));
    expect(rows.map((i) => (i.kind === "shortcut" ? i.repo : "add"))).toEqual(["github.com/a/a", "github.com/b/b", "add"]);
  });

  it("sets, replaces and removes entries, dropping the map when empty", () => {
    const one = updateDevShortcuts(undefined, "github.com/a/a", "~/a");
    expect(one).toEqual({ "github.com/a/a": "~/a" });
    expect(updateDevShortcuts(one, "github.com/a/a", "~/other")).toEqual({ "github.com/a/a": "~/other" });
    expect(updateDevShortcuts(one, "github.com/a/a", null)).toBeUndefined();
  });
});

describe("SettingsPanel dev shortcuts", () => {
  let checkout: string;

  beforeEach(() => {
    const configDir = join(process.env.XDG_CONFIG_HOME!, "blackbook");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.yaml"), "settings:\n  package_manager: npm\n");
    checkout = mkdtempSync(join(tmpdir(), "bb-shortcut-checkout-"));
    return () => rmSync(checkout, { recursive: true, force: true });
  });

  it("adds, edits and removes a shortcut, saving each change to config", async () => {
    const { stdin, lastFrame, unmount } = render(<SettingsPanel />);
    try {
      await waitFor(lastFrame, (f) => f.includes("Add dev shortcut"));
      for (let i = 0; i < 30 && !(lastFrame() ?? "").includes("❯ Add dev shortcut"); i++) {
        stdin.write(DOWN);
        await tick();
      }
      stdin.write(ENTER);
      await waitFor(lastFrame, (f) => f.includes("Repo:"));
      await typeText(stdin, "github.com/acme/tools");
      stdin.write(ENTER);
      await waitFor(lastFrame, (f) => f.includes("github.com/acme/tools →"));
      await typeText(stdin, "/nope/missing");
      stdin.write(ENTER);
      await waitFor(lastFrame, (f) => f.includes("(missing)"));
      expect(loadConfig().config.settings.dev_shortcuts).toEqual({ "github.com/acme/tools": "/nope/missing" });

      // The saved row is selected; edit its path.
      await waitFor(lastFrame, (f) => f.includes("❯ github.com/acme/tools"));
      stdin.write(ENTER);
      await tick();
      for (let i = 0; i < "/nope/missing".length; i++) await typeText(stdin, "\u007F");
      await typeText(stdin, checkout);
      stdin.write(ENTER);
      await waitFor(lastFrame, (f) => f.includes(checkout) && !f.includes("(missing)"));
      expect(loadConfig().config.settings.dev_shortcuts).toEqual({ "github.com/acme/tools": checkout });

      stdin.write("d");
      await waitFor(lastFrame, (f) => !f.includes("github.com/acme/tools →"));
      expect(loadConfig().config.settings.dev_shortcuts).toBeUndefined();
    } finally {
      unmount();
    }
  });
});
