/**
 * Unified Action Dispatch — Phase 4 of Architecture Refactor
 *
 * Single dispatch function for all entity actions, replacing 5 separate
 * action handlers in App.tsx (`handleFileAction`, `handlePluginAction`,
 * `handlePiPackageAction`, etc.).
 *
 * The dispatcher takes callbacks for state transitions so it stays
 * decoupled from App.tsx's local state.
 */

import type { ManagedItem } from "../lib/managed-item.js";
import type { ItemAction } from "../components/ItemDetail.js";
import type { DiffInstanceRef, DiffTarget, FileStatus, Plugin, SyncPreviewItem, PiPackage } from "../lib/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Callback Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callbacks that the dispatcher invokes for state transitions.
 * Each maps to a specific App.tsx action.
 */
export interface DispatchCallbacks {
  // Navigation
  closeDetail: () => void;
  openDiffForFile: (file: FileStatus, instance?: DiffInstanceRef) => void;
  openMissingSummaryForFile: (file: FileStatus, instance?: DiffInstanceRef) => void;
  setDiffTarget: (target: DiffTarget) => void;

  // Plugin actions
  installPlugin: (plugin: Plugin) => Promise<boolean>;
  uninstallPlugin: (plugin: Plugin) => Promise<boolean>;
  updatePlugin: (plugin: Plugin) => Promise<boolean>;
  trackPluginInSource?: (plugin: Plugin) => Promise<boolean>;
  installPluginToInstance: (plugin: Plugin, toolId: string, instanceId: string) => Promise<void>;
  uninstallPluginFromInstance: (plugin: Plugin, toolId: string, instanceId: string) => Promise<void>;
  refreshDetailPlugin: (plugin: Plugin) => void;

  // File / plugin pullback actions
  syncFiles: (items: SyncPreviewItem[]) => Promise<void>;
  pullbackFileInstance: (file: FileStatus, instance: DiffInstanceRef) => Promise<boolean>;
  pullbackPluginInstance: (plugin: Plugin, instance: DiffInstanceRef) => Promise<boolean>;

  // Pi package actions
  installPiPackage: (pkg: PiPackage) => Promise<boolean>;
  uninstallPiPackage: (pkg: PiPackage) => Promise<boolean>;
  updatePiPackage: (pkg: PiPackage) => Promise<boolean>;
  trackPiPackageInSource?: (pkg: PiPackage) => Promise<boolean>;
  deletePiPackageEverywhere?: (pkg: PiPackage) => Promise<boolean>;
  refreshDetailPiPackage: (pkg: PiPackage) => void;

  // Plugin diff support
  buildPluginDiffTarget: (plugin: Plugin, toolId: string, instanceId: string) => Promise<DiffTarget | null>;

  // Skill actions
  uninstallSkillAll?: (skill: import("./install.js").StandaloneSkill) => Promise<void>;
  uninstallSkillFromInstance?: (skill: import("./install.js").StandaloneSkill, toolId: string, instanceId: string) => Promise<void>;
  installSkillToInstance?: (skill: import("./install.js").StandaloneSkill, toolId: string, instanceId: string) => Promise<void>;
  installSkillToAll?: (skill: import("./install.js").StandaloneSkill) => Promise<void>;
  pullbackSkillFromInstance?: (skill: import("./install.js").StandaloneSkill, toolId: string, instanceId: string) => Promise<void>;
  deleteSkillEverywhere?: (skill: import("./install.js").StandaloneSkill) => Promise<void>;
  refreshDetailSkill?: (skill: import("./install.js").StandaloneSkill) => void;
  removeRedundantSkillInstallations?: (skill: import("./install.js").StandaloneSkill, redundant: import("./install.js").SkillInstallation[]) => Promise<void>;

  // Namespace actions
  syncNamespace?: (ns: import("./install.js").NamespaceGroup) => Promise<void>;
  resyncNamespace?: (ns: import("./install.js").NamespaceGroup) => Promise<void>;
  deleteNamespaceEverywhere?: (ns: import("./install.js").NamespaceGroup) => Promise<void>;
  uninstallNamespaceAll?: (ns: import("./install.js").NamespaceGroup) => Promise<void>;
  uninstallNamespaceFromInstance?: (ns: import("./install.js").NamespaceGroup, toolId: string, instanceId: string) => Promise<void>;
  pullbackNamespaceFromInstance?: (ns: import("./install.js").NamespaceGroup, toolId: string, instanceId: string) => Promise<void>;
  openSkillDetail?: (skill: import("./install.js").StandaloneSkill) => void;
  openSkillDiff?: (skill: import("./install.js").StandaloneSkill, toolId: string, instanceId: string) => void;
  refreshDetailNamespace?: (ns: import("./install.js").NamespaceGroup) => void;

  // Plugin / file delete-everywhere
  deletePluginEverywhere?: (plugin: Plugin) => Promise<void>;
  deleteFileEverywhere?: (file: FileStatus) => Promise<void>;

  // Remove from git (source-repo prescription/copy only — local installs untouched)
  removePluginFromGit?: (plugin: Plugin) => Promise<void>;
  removePiPackageFromGit?: (pkg: PiPackage) => Promise<void>;
  removeFileFromGit?: (file: FileStatus) => Promise<void>;
  removeSkillFromGit?: (skill: import("./install.js").StandaloneSkill) => Promise<void>;
  removeNamespaceFromGit?: (ns: import("./install.js").NamespaceGroup) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle an action on a ManagedItem.
 *
 * Returns true if the action was handled, false if it was a no-op.
 */
export async function handleItemAction(
  item: ManagedItem,
  action: ItemAction,
  callbacks: DispatchCallbacks,
): Promise<boolean> {
  switch (action.type) {
    case "back":
      callbacks.closeDetail();
      return true;

    case "status":
      // Status rows are informational — no action
      return false;

    case "diff":
      return handleDiffAction(item, action, callbacks);

    case "missing":
      return handleMissingAction(item, action, callbacks);

    case "sync":
      if (item._namespace) {
        if (action.id === "sync_missing" && callbacks.syncNamespace) {
          await callbacks.syncNamespace(item._namespace);
          callbacks.refreshDetailNamespace?.(item._namespace);
          return true;
        }
        if (action.id === "resync_drifted" && callbacks.resyncNamespace) {
          await callbacks.resyncNamespace(item._namespace);
          callbacks.refreshDetailNamespace?.(item._namespace);
          return true;
        }
        return false;
      }
      return handleSyncAction(item, callbacks);

    case "install":
      return handleInstallAction(item, callbacks);

    case "open_skill":
      if (item._namespace && callbacks.openSkillDetail) {
        const skill = item._namespace.skills.find((s) => s.name === action.id);
        if (skill) {
          callbacks.openSkillDetail(skill);
          return true;
        }
      }
      return false;

    case "uninstall":
      return handleUninstallAction(item, callbacks);

    case "update":
      return handleUpdateAction(item, callbacks);

    case "install_tool":
      return handleInstallToolAction(item, action, callbacks);

    case "uninstall_tool":
      return handleUninstallToolAction(item, action, callbacks);

    case "pullback":
      return handlePullbackAction(item, action, callbacks);

    case "track":
      if (item._piPackage && callbacks.trackPiPackageInSource) {
        await callbacks.trackPiPackageInSource(item._piPackage);
        callbacks.refreshDetailPiPackage(item._piPackage);
        return true;
      }
      if (item._plugin && callbacks.trackPluginInSource) {
        await callbacks.trackPluginInSource(item._plugin);
        callbacks.refreshDetailPlugin(item._plugin);
        return true;
      }
      return false;

    case "remove_redundant":
      if (item._skill) {
        const redundant = item._skill.installations.filter((i) => i.redundant);
        if (redundant.length > 0 && callbacks.removeRedundantSkillInstallations) {
          await callbacks.removeRedundantSkillInstallations(item._skill, redundant);
          if (callbacks.refreshDetailSkill) callbacks.refreshDetailSkill(item._skill);
          return true;
        }
      }
      return false;

    case "remove_from_git":
      return handleRemoveFromGit(item, callbacks);

    case "delete_everywhere":
      if (item._namespace && callbacks.deleteNamespaceEverywhere) {
        await callbacks.deleteNamespaceEverywhere(item._namespace);
        return true;
      }
      if (item._skill && callbacks.deleteSkillEverywhere) {
        await callbacks.deleteSkillEverywhere(item._skill);
        return true;
      }
      if (item._plugin && callbacks.deletePluginEverywhere) {
        await callbacks.deletePluginEverywhere(item._plugin);
        return true;
      }
      if (item._file && callbacks.deleteFileEverywhere) {
        await callbacks.deleteFileEverywhere(item._file);
        return true;
      }
      if (item._piPackage && callbacks.deletePiPackageEverywhere) {
        await callbacks.deletePiPackageEverywhere(item._piPackage);
        return true;
      }
      return false;

    default:
      return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-Type Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleDiffAction(
  item: ManagedItem,
  action: ItemAction,
  callbacks: DispatchCallbacks,
): Promise<boolean> {
  if (!action.instance) return false;

  if (item._file) {
    callbacks.openDiffForFile(item._file, action.instance as DiffInstanceRef);
    return true;
  }

  if (item._skill && callbacks.openSkillDiff) {
    const inst = action.instance as DiffInstanceRef;
    callbacks.openSkillDiff(item._skill, inst.toolId, inst.instanceId);
    return true;
  }

  if (item._plugin) {
    const inst = action.instance as DiffInstanceRef;
    const diffTarget = await callbacks.buildPluginDiffTarget(
      item._plugin,
      inst.toolId,
      inst.instanceId,
    );
    if (diffTarget) {
      callbacks.setDiffTarget(diffTarget);
      return true;
    }
  }

  return false;
}

async function handleMissingAction(
  item: ManagedItem,
  action: ItemAction,
  callbacks: DispatchCallbacks,
): Promise<boolean> {
  if (!action.instance || !item._file) return false;
  callbacks.openMissingSummaryForFile(item._file, action.instance as DiffInstanceRef);
  return true;
}

async function handleSyncAction(
  item: ManagedItem,
  callbacks: DispatchCallbacks,
): Promise<boolean> {
  if (item._file) {
    const syncItem: SyncPreviewItem = {
      kind: "file",
      file: item._file,
      missingInstances: item._file.instances
        .filter((i) => i.status === "missing")
        .map((i) => i.instanceName),
      driftedInstances: item._file.instances
        .filter((i) => i.status === "drifted")
        .map((i) => i.instanceName),
      // "Sync to tool" is an explicit push: force-sync even both-changed instances.
      forceBothChanged: true,
    };
    await callbacks.syncFiles([syncItem]);
    return true;
  }
  return false;
}

async function handleInstallAction(
  item: ManagedItem,
  callbacks: DispatchCallbacks,
): Promise<boolean> {
  if (item._plugin) {
    await callbacks.installPlugin(item._plugin);
    callbacks.refreshDetailPlugin(item._plugin);
    return true;
  }
  if (item._piPackage) {
    await callbacks.installPiPackage(item._piPackage);
    callbacks.refreshDetailPiPackage(item._piPackage);
    return true;
  }
  // Skills: bulk "sync to all missing tools" action. Iterate every supported,
  // enabled tool instance that doesn't already have this skill installed and
  // sync from source-repo path.
  if (item._skill && callbacks.installSkillToAll) {
    await callbacks.installSkillToAll(item._skill);
    callbacks.refreshDetailSkill?.(item._skill);
    return true;
  }
  return false;
}

async function handleUninstallAction(
  item: ManagedItem,
  callbacks: DispatchCallbacks,
): Promise<boolean> {
  if (item._namespace && callbacks.uninstallNamespaceAll) {
    await callbacks.uninstallNamespaceAll(item._namespace);
    callbacks.refreshDetailNamespace?.(item._namespace);
    return true;
  }
  if (item._plugin) {
    await callbacks.uninstallPlugin(item._plugin);
    callbacks.refreshDetailPlugin(item._plugin);
    return true;
  }
  if (item._piPackage) {
    await callbacks.uninstallPiPackage(item._piPackage);
    callbacks.refreshDetailPiPackage(item._piPackage);
    return true;
  }
  if (item._skill && callbacks.uninstallSkillAll) {
    await callbacks.uninstallSkillAll(item._skill);
    callbacks.refreshDetailSkill?.(item._skill);
    return true;
  }
  return false;
}

async function handleUpdateAction(
  item: ManagedItem,
  callbacks: DispatchCallbacks,
): Promise<boolean> {
  if (item._plugin) {
    await callbacks.updatePlugin(item._plugin);
    callbacks.refreshDetailPlugin(item._plugin);
    return true;
  }
  if (item._piPackage) {
    await callbacks.updatePiPackage(item._piPackage);
    callbacks.refreshDetailPiPackage(item._piPackage);
    return true;
  }
  return false;
}

async function handleInstallToolAction(
  item: ManagedItem,
  action: ItemAction,
  callbacks: DispatchCallbacks,
): Promise<boolean> {
  const toolId = action.instance?.toolId ?? action.toolStatus?.toolId;
  const instanceId = action.instance?.instanceId ?? action.toolStatus?.instanceId;
  if (!toolId || !instanceId) return false;

  if (item._plugin) {
    await callbacks.installPluginToInstance(item._plugin, toolId, instanceId);
    callbacks.refreshDetailPlugin(item._plugin);
    return true;
  }

  if (item._skill && callbacks.installSkillToInstance) {
    await callbacks.installSkillToInstance(item._skill, toolId, instanceId);
    callbacks.refreshDetailSkill?.(item._skill);
    return true;
  }

  return false;
}

async function handleUninstallToolAction(
  item: ManagedItem,
  action: ItemAction,
  callbacks: DispatchCallbacks,
): Promise<boolean> {
  const toolId = action.instance?.toolId ?? action.toolStatus?.toolId;
  const instanceId = action.instance?.instanceId ?? action.toolStatus?.instanceId;
  if (!toolId || !instanceId) return false;

  if (item._namespace && callbacks.uninstallNamespaceFromInstance) {
    await callbacks.uninstallNamespaceFromInstance(item._namespace, toolId, instanceId);
    callbacks.refreshDetailNamespace?.(item._namespace);
    return true;
  }

  if (item._plugin) {
    await callbacks.uninstallPluginFromInstance(item._plugin, toolId, instanceId);
    callbacks.refreshDetailPlugin(item._plugin);
    return true;
  }

  if (item._skill && callbacks.uninstallSkillFromInstance) {
    await callbacks.uninstallSkillFromInstance(item._skill, toolId, instanceId);
    callbacks.refreshDetailSkill?.(item._skill);
    return true;
  }

  return false;
}

async function handlePullbackAction(
  item: ManagedItem,
  action: ItemAction,
  callbacks: DispatchCallbacks,
): Promise<boolean> {
  if (!action.instance) return false;
  const instance = action.instance as DiffInstanceRef;

  if (item._namespace && callbacks.pullbackNamespaceFromInstance) {
    await callbacks.pullbackNamespaceFromInstance(item._namespace, instance.toolId, instance.instanceId);
    callbacks.refreshDetailNamespace?.(item._namespace);
    return true;
  }

  if (item._file) {
    await callbacks.pullbackFileInstance(item._file, instance);
    return true;
  }

  if (item._plugin) {
    await callbacks.pullbackPluginInstance(item._plugin, instance);
    callbacks.refreshDetailPlugin(item._plugin);
    return true;
  }

  if (item._skill && callbacks.pullbackSkillFromInstance) {
    await callbacks.pullbackSkillFromInstance(item._skill, instance.toolId, instance.instanceId);
    callbacks.refreshDetailSkill?.(item._skill);
    return true;
  }

  return false;
}

async function handleRemoveFromGit(
  item: ManagedItem,
  callbacks: DispatchCallbacks,
): Promise<boolean> {
  if (item._namespace && callbacks.removeNamespaceFromGit) {
    await callbacks.removeNamespaceFromGit(item._namespace);
    callbacks.refreshDetailNamespace?.(item._namespace);
    return true;
  }
  if (item._skill && callbacks.removeSkillFromGit) {
    await callbacks.removeSkillFromGit(item._skill);
    callbacks.refreshDetailSkill?.(item._skill);
    return true;
  }
  if (item._plugin && callbacks.removePluginFromGit) {
    await callbacks.removePluginFromGit(item._plugin);
    callbacks.refreshDetailPlugin(item._plugin);
    return true;
  }
  if (item._file && callbacks.removeFileFromGit) {
    await callbacks.removeFileFromGit(item._file);
    return true;
  }
  if (item._piPackage && callbacks.removePiPackageFromGit) {
    await callbacks.removePiPackageFromGit(item._piPackage);
    callbacks.refreshDetailPiPackage(item._piPackage);
    return true;
  }
  return false;
}
