import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useStore } from "../lib/store.js";
import { MarketplaceList } from "../components/MarketplaceList.js";
import { buildMarketplaceRows } from "../lib/marketplace-row.js";
import type { Tab } from "../lib/types.js";

export function MarketplacesTab() {
  const selectedIndex = useStore((s) => s.selectedIndex);
  const loading = useStore((s) => s.loading);
  const marketplaces = useStore((s) => s.marketplaces);
  const piMarketplaces = useStore((s) => s.piMarketplaces);
  const showPiFeatures = useStore((s) => {
    const piEnabled = s.tools.some((t) => t.toolId === "pi" && t.enabled);
    const piInstalled = s.toolDetection.pi?.installed === true;
    return piEnabled || piInstalled;
  });
  const marketplaceRows = useMemo(
    () => buildMarketplaceRows(marketplaces, piMarketplaces, showPiFeatures),
    [marketplaces, piMarketplaces, showPiFeatures]
  );

  const shouldShowEmpty = marketplaces.length === 0 && piMarketplaces.length === 0;

  if (shouldShowEmpty) {
    return (
      <Box marginY={1}>
        <Text color={loading ? "cyan" : "gray"}>
          {loading ? "⠋ Loading marketplaces..." : "No marketplace data loaded. Press R to refresh."}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <MarketplaceList rows={marketplaceRows} selectedIndex={selectedIndex} />
    </Box>
  );
}
