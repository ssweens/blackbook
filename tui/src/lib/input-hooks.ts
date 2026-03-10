import { useCallback } from "react";
import type { DiffInstanceRef, DiffTarget, FileStatus, MissingSummary, PiPackage, Plugin, Tab } from "./types.js";
import type { ItemAction } from "../components/ItemDetail.js";
import type { MarketplaceDetailAction } from "./marketplace-detail.js";

export interface InputKey {
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
}

export function useDiffInput(diffTarget: DiffTarget | null, missingSummary: MissingSummary | null) {
  return useCallback((_: string, key: InputKey): boolean => {
    if (!diffTarget && !missingSummary) return false;
    return Boolean(key.upArrow || key.downArrow);
  }, [diffTarget, missingSummary]);
}

interface UseDetailInputParams {
  activeDetail: { actions: ItemAction[] } | null;
  activeMarketplaceDetail: { actions: MarketplaceDetailAction[] } | null;
  detailToolOpen: boolean;
  detailFile: FileStatus | null;
  detailPlugin: Plugin | null;
  actionIndex: number;
  diffTarget: DiffTarget | null;
  missingSummary: MissingSummary | null;
  setActionIndex: (value: number | ((prev: number) => number)) => void;
  onEntityAction: (index: number) => void;
  onMarketplaceAction: (index: number) => void;
  onPullbackFile: (file: FileStatus, instance: DiffInstanceRef) => void;
  onPullbackPlugin: (plugin: Plugin, instance: DiffInstanceRef) => void;
}

export function useDetailInput({
  activeDetail,
  activeMarketplaceDetail,
  detailToolOpen,
  detailFile,
  detailPlugin,
  actionIndex,
  diffTarget,
  missingSummary,
  setActionIndex,
  onEntityAction,
  onMarketplaceAction,
  onPullbackFile,
  onPullbackPlugin,
}: UseDetailInputParams) {
  return useCallback((input: string, key: InputKey): boolean => {
    if (key.upArrow) {
      if (activeDetail || activeMarketplaceDetail) {
        setActionIndex((i) => Math.max(0, i - 1));
        return true;
      }
      if (detailToolOpen) return true;
      return false;
    }

    if (key.downArrow) {
      if (activeDetail) {
        setActionIndex((i) => Math.min(activeDetail.actions.length - 1, i + 1));
        return true;
      }
      if (activeMarketplaceDetail) {
        setActionIndex((i) => Math.min(activeMarketplaceDetail.actions.length - 1, i + 1));
        return true;
      }
      if (detailToolOpen) return true;
      return false;
    }

    if (input === "p" && !diffTarget && !missingSummary && activeDetail) {
      const pullAction = activeDetail.actions.find((a) => a.type === "pullback");
      if (pullAction?.instance) {
        const instance = pullAction.instance as DiffInstanceRef;
        if (detailFile) {
          onPullbackFile(detailFile, instance);
        } else if (detailPlugin) {
          onPullbackPlugin(detailPlugin, instance);
        }
      }
      return true;
    }

    if (key.return) {
      if (activeDetail) {
        onEntityAction(actionIndex);
        return true;
      }
      if (activeMarketplaceDetail) {
        onMarketplaceAction(actionIndex);
        return true;
      }
      if (detailToolOpen) return true;
    }

    return false;
  }, [
    activeDetail,
    activeMarketplaceDetail,
    actionIndex,
    detailToolOpen,
    detailFile,
    diffTarget,
    missingSummary,
    onEntityAction,
    onMarketplaceAction,
    onPullbackFile,
    onPullbackPlugin,
    setActionIndex,
    detailPlugin,
  ]);
}

interface UseListInputParams {
  discoverSubView: "plugins" | "piPackages" | null;
  tab: Tab;
  subViewIndex: number;
  maxIndex: number;
  selectedIndex: number;
  filteredPlugins: Plugin[];
  marketplaceBrowsePlugins: Plugin[];
  filteredPiPackages: PiPackage[];
  isOverlayOpen: boolean;
  setSubViewIndex: (value: number | ((prev: number) => number)) => void;
  setSelectedIndex: (value: number) => void;
  setDetailPiPackage: (pkg: PiPackage) => void;
  setActionIndex: (value: number) => void;
  setSyncArmed: (value: boolean) => void;
  onOpenPluginDetail: (plugin: Plugin) => void;
  onEnterList: () => void;
  onSpaceToggle: () => void;
}

export function useListInput({
  discoverSubView,
  tab,
  subViewIndex,
  maxIndex,
  selectedIndex,
  filteredPlugins,
  marketplaceBrowsePlugins,
  filteredPiPackages,
  isOverlayOpen,
  setSubViewIndex,
  setSelectedIndex,
  setDetailPiPackage,
  setActionIndex,
  setSyncArmed,
  onOpenPluginDetail,
  onEnterList,
  onSpaceToggle,
}: UseListInputParams) {
  return useCallback((input: string, key: InputKey): boolean => {
    if (key.upArrow) {
      if (discoverSubView) {
        setSubViewIndex((i) => Math.max(0, i - 1));
      } else {
        setSelectedIndex(Math.max(0, selectedIndex - 1));
        if (tab === "sync") setSyncArmed(false);
      }
      return true;
    }

    if (key.downArrow) {
      if (discoverSubView) {
        const pluginList = tab === "marketplaces" ? marketplaceBrowsePlugins : filteredPlugins;
        const maxSubViewIndex = discoverSubView === "plugins" ? pluginList.length - 1 : filteredPiPackages.length - 1;
        setSubViewIndex((i) => Math.min(maxSubViewIndex, i + 1));
      } else {
        setSelectedIndex(Math.min(maxIndex, selectedIndex + 1));
        if (tab === "sync") setSyncArmed(false);
      }
      return true;
    }

    if (key.return) {
      if (discoverSubView) {
        if (discoverSubView === "plugins") {
          const list = tab === "marketplaces" ? marketplaceBrowsePlugins : filteredPlugins;
          const plugin = list[subViewIndex];
          if (plugin) onOpenPluginDetail(plugin);
        } else {
          const pkg = filteredPiPackages[subViewIndex];
          if (pkg) {
            setDetailPiPackage(pkg);
            setActionIndex(0);
          }
        }
      } else {
        onEnterList();
      }
      return true;
    }

    if (input === " " && !isOverlayOpen) {
      onSpaceToggle();
      return true;
    }

    return false;
  }, [
    discoverSubView,
    filteredPiPackages,
    filteredPlugins,
    isOverlayOpen,
    marketplaceBrowsePlugins,
    maxIndex,
    onEnterList,
    onOpenPluginDetail,
    onSpaceToggle,
    selectedIndex,
    setActionIndex,
    setDetailPiPackage,
    setSelectedIndex,
    setSubViewIndex,
    setSyncArmed,
    subViewIndex,
    tab,
  ]);
}
