import type { Marketplace, PiMarketplace } from "./types.js";

export type MarketplaceRow =
  | { kind: "add-plugin" }
  | { kind: "plugin"; marketplace: Marketplace }
  | { kind: "add-pi" }
  | { kind: "pi"; marketplace: PiMarketplace };

export function buildMarketplaceRows(
  marketplaces: Marketplace[],
  piMarketplaces: PiMarketplace[],
  showPiFeatures: boolean,
): MarketplaceRow[] {
  const rows: MarketplaceRow[] = [{ kind: "add-plugin" }];
  for (const m of marketplaces) rows.push({ kind: "plugin", marketplace: m });

  if (showPiFeatures) {
    rows.push({ kind: "add-pi" });
    for (const pm of piMarketplaces) rows.push({ kind: "pi", marketplace: pm });
  }

  return rows;
}
