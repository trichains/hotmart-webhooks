import type { IdempotencyStore } from "./handler.js";

export interface MemoryIdempotencyStoreOptions {
  /** How long an id is remembered. Default: 24 hours. */
  ttlMs?: number;
  /** Oldest ids are evicted past this size. Default: 10,000. */
  maxEntries?: number;
  /** Clock override, for tests. */
  now?: () => number;
}

/**
 * In-memory idempotency store. Good for local development, tests and a single
 * long-running process. It does not survive restarts and is not shared between
 * instances or serverless invocations: use Redis or a database in production.
 */
export function createMemoryIdempotencyStore(
  options: MemoryIdempotencyStoreOptions = {},
): IdempotencyStore & { size(): number; clear(): void } {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const maxEntries = options.maxEntries ?? 10_000;
  const now = options.now ?? Date.now;
  // Map preserves insertion order, so the first key is always the oldest.
  const seen = new Map<string, number>();

  return {
    has(id) {
      const expiresAt = seen.get(id);
      if (expiresAt === undefined) return false;
      if (expiresAt <= now()) {
        seen.delete(id);
        return false;
      }
      return true;
    },
    set(id) {
      seen.delete(id);
      seen.set(id, now() + ttlMs);
      while (seen.size > maxEntries) {
        const oldest = seen.keys().next().value as string;
        seen.delete(oldest);
      }
    },
    size: () => seen.size,
    clear: () => seen.clear(),
  };
}
