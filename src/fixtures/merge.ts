/** Recursively optional version of `T`. Arrays are replaced, not merged. */
export type DeepPartial<T> = T extends readonly (infer U)[]
  ? readonly U[] | U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Deep merge for JSON-like data. Plain objects merge key by key; arrays and
 * primitives in `override` replace the base value; `undefined` is ignored.
 * Neither input is mutated.
 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined) return structuredClone(base);
  if (!isPlainObject(base) || !isPlainObject(override)) return structuredClone(override) as T;
  const out: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (FORBIDDEN_KEYS.has(key) || value === undefined) continue;
    out[key] = key in out ? deepMerge(out[key], value) : structuredClone(value);
  }
  return out as T;
}

/**
 * Set a value at a dot path, creating objects (or arrays for numeric segments)
 * along the way: `setPath(obj, "data.purchase.price.value", 97)`.
 * Mutates and returns `target`.
 */
export function setPath<T extends object>(target: T, path: string, value: unknown): T {
  const segments = path.split(".");
  if (segments.length === 0 || segments.some((s) => s === "")) {
    throw new Error(`Invalid path: "${path}"`);
  }
  if (segments.some((s) => FORBIDDEN_KEYS.has(s))) {
    throw new Error(`Refusing to write to "${path}"`);
  }
  let node: Record<string, unknown> = target as Record<string, unknown>;
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i] as string;
    const nextIsIndex = /^\d+$/.test(segments[i + 1] as string);
    const current = node[key];
    if (typeof current !== "object" || current === null) {
      node[key] = nextIsIndex ? [] : {};
    }
    node = node[key] as Record<string, unknown>;
  }
  node[segments[segments.length - 1] as string] = value;
  return target;
}
