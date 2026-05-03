import React, { useEffect, useMemo } from "react";
import { Box, Text } from "ink";
import { useStore } from "../lib/store.js";
import { MarketplaceList } from "../components/MarketplaceList.js";
import { buildMarketplaceRows } from "../lib/marketplace-row.js";
import type { Tab } from "../lib/types.js";

export function MarketplacesTab() {
  const selectedIndex = useStore((s) => s.selectedIndex);
  const marketplaces = useStore((s) => s.marketplaces);
  const piMarketplaces = useStore((s) => s.piMarketplaces);
  const showPiFeatures = useStore((s) => {
    const piEnabled = s.tools.some((t) => t.toolId === "pi" && t.enabled);
    const piInstalled = s.toolDetection.pi?.installed === true;
    return piEnabled || piInstalled;
  });
  const loadMarketplaces = useStore((s) => s.loadMarketplaces);
  const loadPiPackages = useStore((s) => s.loadPiPackages);

  useEffect(() => {
    void loadMarketplaces();
    void loadPiPackages();
  }, [loadMarketplaces, loadPiPackages]);

  const marketplaceRows = useMemo(
    () => buildMarketplaceRows(marketplaces, piMarketplaces, showPiFeatures),
    [marketplaces, piMarketplaces, showPiFeatures]
  );

  const shouldShowLoading = marketplaces.length === 0 && piMarketplaces.length === 0;

  if (shouldShowLoading) {
    return (
      <Box marginY={1}>
        <Text color="cyan">⠋ Loading marketplaces...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <MarketplaceList rows={marketplaceRows} selectedIndex={selectedIndex} />
    </Box>
  );
}
