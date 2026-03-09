import { describe, expect, it } from "vitest";
import { getMarketplaceDetailActions, type MarketplaceDetailContext } from "./marketplace-detail.js";
import type { Marketplace, PiMarketplace, PiPackage } from "./types.js";

function createPluginMarketplace(source: "blackbook" | "claude" = "blackbook"): Marketplace {
  return {
    name: "playbook",
    url: "https://example.com/marketplace.json",
    isLocal: false,
    plugins: [],
    availableCount: 0,
    installedCount: 0,
    updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    autoUpdate: false,
    source,
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

function createPiMarketplace(builtIn = false): PiMarketplace {
  return {
    name: builtIn ? "npm" : "local",
    source: builtIn ? "https://www.npmjs.com" : "~/pi-marketplace",
    sourceType: builtIn ? "npm" : "local",
    packages: [createPiPackage()],
    enabled: true,
    builtIn,
  };
}

describe("getMarketplaceDetailActions", () => {
  it("returns browse/update/remove for writable plugin marketplaces", () => {
    const detail: MarketplaceDetailContext = { kind: "plugin", marketplace: createPluginMarketplace("blackbook") };
    const actions = getMarketplaceDetailActions(detail);

    expect(actions.map((a) => a.type)).toEqual(["browse", "update", "remove"]);
    expect(actions[2].tone).toBe("danger");
  });

  it("omits remove for read-only Claude marketplace", () => {
    const detail: MarketplaceDetailContext = { kind: "plugin", marketplace: createPluginMarketplace("claude") };
    const actions = getMarketplaceDetailActions(detail);

    expect(actions.map((a) => a.type)).toEqual(["browse", "update"]);
  });

  it("returns browse/back for built-in pi marketplace", () => {
    const detail: MarketplaceDetailContext = { kind: "pi", marketplace: createPiMarketplace(true) };
    const actions = getMarketplaceDetailActions(detail);

    expect(actions.map((a) => a.type)).toEqual(["browse", "back"]);
  });

  it("returns browse/remove/back for removable pi marketplace", () => {
    const detail: MarketplaceDetailContext = { kind: "pi", marketplace: createPiMarketplace(false) };
    const actions = getMarketplaceDetailActions(detail);

    expect(actions.map((a) => a.type)).toEqual(["browse", "remove", "back"]);
    expect(actions[1].tone).toBe("danger");
  });
});
