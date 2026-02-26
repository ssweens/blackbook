/**
 * Deep merge for config.yaml + config.local.yaml.
 *
 * Semantics:
 * - Arrays of objects with 'name' or 'id' key: merge by that key
 * - Scalar arrays: replace entirely
 * - Objects: recursive deep merge
 * - null values: delete the key from result
 * - Scalars: override
 */

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function isPlainObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MERGE_KEY_CANDIDATES = ["id", "name"] as const;

function findMergeKey(base: JsonValue[], override: JsonValue[]): string | null {
  // Find a key that exists in at least one item from each array
  for (const candidate of MERGE_KEY_CANDIDATES) {
    const inBase = base.some(
      (item) => isPlainObject(item) && candidate in item && typeof item[candidate] === "string"
    );
    const inOverride = override.some(
      (item) => isPlainObject(item) && candidate in item && typeof item[candidate] === "string"
    );
    if (inBase && inOverride) return candidate;
  }
  // Fallback: any key present in either array
  for (const candidate of MERGE_KEY_CANDIDATES) {
    const inEither = [...base, ...override].some(
      (item) => isPlainObject(item) && candidate in item && typeof item[candidate] === "string"
    );
    if (inEither) return candidate;
  }
  return null;
}

function mergeArrays(base: JsonValue[], override: JsonValue[]): JsonValue[] {
  const mergeKey = findMergeKey(base, override);
  if (!mergeKey) {
    // Scalar arrays or arrays without merge key: replace entirely
    return override;
  }

  // Merge by key
  const result = [...base];
  for (const overrideItem of override) {
    if (!isPlainObject(overrideItem)) {
      result.push(overrideItem);
      continue;
    }
    const key = overrideItem[mergeKey];
    if (typeof key !== "string") {
      result.push(overrideItem);
      continue;
    }
    const existingIndex = result.findIndex(
      (item) => isPlainObject(item) && item[mergeKey] === key
    );
    if (existingIndex >= 0) {
      result[existingIndex] = deepMerge(
        result[existingIndex] as Record<string, JsonValue>,
        overrideItem
      );
    } else {
      result.push(overrideItem);
    }
  }
  return result;
}

export function deepMerge(
  base: Record<string, JsonValue>,
  override: Record<string, JsonValue>
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = { ...base };

  for (const [key, overrideValue] of Object.entries(override)) {
    // null deletes the key
    if (overrideValue === null) {
      delete result[key];
      continue;
    }

    const baseValue = result[key];

    // Both arrays: merge
    if (Array.isArray(baseValue) && Array.isArray(overrideValue)) {
      result[key] = mergeArrays(baseValue, overrideValue);
      continue;
    }

    // Both objects: recursive
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(baseValue, overrideValue);
      continue;
    }

    // Override (scalar, type mismatch, or base missing)
    result[key] = overrideValue;
  }

  return result;
}
