import { getToolDefinitions, getToolInstances } from "./config.js";
import type { ManagedToolRow, ToolInstance } from "./types.js";

function mapInstance(instance: ToolInstance): ManagedToolRow {
  return {
    toolId: instance.toolId,
    displayName: instance.name,
    instanceId: instance.instanceId,
    configDir: instance.configDir,
    enabled: instance.enabled,
    synthetic: false,
  };
}

export function getManagedToolRows(): ManagedToolRow[] {
  const definitions = getToolDefinitions();
  const configuredInstances = getToolInstances() || [];
  const byToolId = new Map<string, ToolInstance[]>();

  for (const instance of configuredInstances) {
    const rows = byToolId.get(instance.toolId) || [];
    rows.push(instance);
    byToolId.set(instance.toolId, rows);
  }

  const rows: ManagedToolRow[] = [];
  for (const toolId of Object.keys(definitions)) {
    const definition = definitions[toolId];
    const instances = byToolId.get(toolId) || [];
    if (instances.length > 0) {
      for (const instance of instances) {
        rows.push(mapInstance(instance));
      }
      continue;
    }

    rows.push({
      toolId,
      displayName: definition.name,
      instanceId: "default",
      configDir: definition.configDir,
      enabled: false,
      synthetic: true,
    });
  }

  return rows;
}
