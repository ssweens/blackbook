import type { Marketplace, PiMarketplace } from "./types.js";

export type MarketplaceDetailContext =
  | { kind: "plugin"; marketplace: Marketplace }
  | { kind: "pi"; marketplace: PiMarketplace };

export type MarketplaceDetailActionType = "browse" | "update" | "remove" | "back";

export interface MarketplaceDetailAction {
  type: MarketplaceDetailActionType;
  label: string;
  tone?: "default" | "danger";
}

function formatDate(date?: Date): string {
  if (!date) return "never";
  return date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
}

export function getMarketplaceDetailActions(detail: MarketplaceDetailContext): MarketplaceDetailAction[] {
  if (detail.kind === "plugin") {
    const m = detail.marketplace;
    const actions: MarketplaceDetailAction[] = [
      { type: "browse", label: `Browse plugins (${m.plugins.length})` },
      { type: "update", label: `Update marketplace (last updated ${formatDate(m.updatedAt)})` },
    ];
    if (m.source !== "claude") {
      actions.push({ type: "remove", label: "Remove marketplace", tone: "danger" });
    }
    return actions;
  }

  const pm = detail.marketplace;
  const actions: MarketplaceDetailAction[] = [
    { type: "browse", label: `Browse packages (${pm.packages.length})` },
  ];
  if (!pm.builtIn) {
    actions.push({ type: "remove", label: "Remove marketplace", tone: "danger" });
  }
  actions.push({ type: "back", label: "Back to marketplace list" });
  return actions;
}
