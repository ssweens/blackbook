import { describe, expect, it } from "vitest";
import { buildMarketplaceRows } from "./marketplace-row.js";
import type { Marketplace, PiMarketplace, PiPackage } from "./types.js";

function createMarketplace(name: string): Marketplace {
  return {
    name,
    url: `https://example.com/${name}.json`,
    isLocal: false,
    plugins: [],
    availableCount: 0,
    installedCount: 0,
    autoUpdate: false,
    source: "blackbook",
    enabled: true,
  };
}

function createPiPackage(): PiPackage {
  return {
    name: "pi-theme-pack",
    description: "themes",
    version: "1.0.0",
    source: "npm:pi-theme-pack",
    sourceType: "npm",
    marketplace: "npm",
    installed: false,
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  };
}

function createPiMarketplace(name: string): PiMarketplace {
  return {
    name,
    source: "https://www.npmjs.com",
    sourceType: "npm",
    packages: [createPiPackage()],
    enabled: true,
    builtIn: true,
  };
}

describe("buildMarketplaceRows", () => {
  it("builds plugin rows only when pi features are hidden", () => {
    const rows = buildMarketplaceRows(
      [createMarketplace("playbook"), createMarketplace("internal")],
      [createPiMarketplace("npm")],
      false,
    );

    expect(rows.map((r) => r.kind)).toEqual(["add-plugin", "plugin", "plugin"]);
  });

  it("builds plugin + pi rows in stable order when pi features are shown", () => {
    const rows = buildMarketplaceRows(
      [createMarketplace("playbook")],
      [createPiMarketplace("npm"), createPiMarketplace("community")],
      true,
    );

    expect(rows.map((r) => r.kind)).toEqual(["add-plugin", "plugin", "add-pi", "pi", "pi"]);
    expect(rows[1].kind === "plugin" && rows[1].marketplace.name).toBe("playbook");
    expect(rows[3].kind === "pi" && rows[3].marketplace.name).toBe("npm");
    expect(rows[4].kind === "pi" && rows[4].marketplace.name).toBe("community");
  });
});
