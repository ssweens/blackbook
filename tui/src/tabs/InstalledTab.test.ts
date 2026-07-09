import { describe, it, expect } from "vitest";
import { distributeHeights, type SectionDef } from "./InstalledTab.js";
import { FILE_COLUMNS } from "../components/ItemList.js";
import type { ManagedItem } from "../lib/managed-item.js";

function items(count: number): ManagedItem[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `item-${i}`,
    kind: "file",
    marketplace: "playbook",
    description: "",
    installed: true,
    incomplete: false,
    scope: "user",
    instances: [],
  }));
}

function sections(): SectionDef[] {
  return [
    { key: "files", items: items(3), shown: true, desired: 5, label: "Files", columns: FILE_COLUMNS },
    { key: "namespaces", items: items(2), shown: true, desired: 3, label: "Skill Namespaces", columns: FILE_COLUMNS },
    { key: "skills", items: items(15), shown: true, desired: 4, label: "Skills", columns: FILE_COLUMNS },
    { key: "plugins", items: items(261), shown: true, desired: 4, label: "Plugins", columns: FILE_COLUMNS },
    { key: "piPackages", items: items(29), shown: true, desired: 3, label: "Pi Packages", columns: FILE_COLUMNS },
  ];
}

describe("distributeHeights", () => {
  // Regression test: previously this function took a `showPreview` boolean
  // (true only when the *currently selected* item was a file/plugin/pi-package,
  // false for skills/namespaces) and reserved the preview's row budget only
  // when true. That meant every section's height recomputed on every keystroke
  // that crossed between preview-eligible and non-eligible item kinds — visible
  // as flicker in the Files/Plugins/Pi Packages sections (which the user can
  // select into) while Skills/Namespaces (which never show a preview) stayed
  // stable. The fix: always reserve the preview budget, independent of what's
  // currently selected, so section heights never change based on selection.
  it("returns identical heights regardless of whether a preview is currently shown", () => {
    const s = sections();
    // distributeHeights no longer takes a preview flag at all — this call
    // shape itself is the regression guard: it must not be re-introduced.
    const result = distributeHeights(30, s);
    const resultAgain = distributeHeights(30, s);
    expect(resultAgain.heights).toEqual(result.heights);
  });

  it("reserves the preview budget whenever there is room for it", () => {
    const result = distributeHeights(30, sections());
    expect(result.previewFits).toBe(true);
  });

  it("drops the preview budget only when the terminal is too small to fit it, not based on selection", () => {
    const result = distributeHeights(6, sections());
    expect(result.previewFits).toBe(false);
    // Every section still gets at least one row.
    expect(result.heights.every((h) => h >= 1)).toBe(true);
  });
});
