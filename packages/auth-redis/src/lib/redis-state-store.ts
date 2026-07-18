import type { OAuthStateData, OAuthStateStore } from "@mantlejs/auth-oauth";
import type { RedisClientLike } from "./redis-client.js";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_PREFIX = "mantle:oauth:state:";

export interface RedisStateStoreOptions {
  /** How long a pending authorization state stays valid. @default 600_000 (10 minutes) */
  ttlMs?: number;
  /** Key prefix. @default "mantle:oauth:state:" */
  prefix?: string;
}

/**
 * Redis-backed {@link OAuthStateStore} for multi-instance deployments, where
 * the callback request may land on a different instance than the one that
 * started the flow. Entries are written with `SET … EX`, so Redis expires
 * them itself and `cleanup()` is a no-op.
 */
export function redisStateStore(client: RedisClientLike, options: RedisStateStoreOptions = {}): OAuthStateStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const prefix = options.prefix ?? DEFAULT_PREFIX;

  return {
    async set(state, data): Promise<void> {
      const payload: OAuthStateData = { ...data, expiresAt: Date.now() + ttlMs };
      await client.set(prefix + state, JSON.stringify(payload), "EX", Math.ceil(ttlMs / 1000));
    },

    async get(state): Promise<OAuthStateData | undefined> {
      const raw = await client.get(prefix + state);
      if (raw === null) return undefined;
      return JSON.parse(raw) as OAuthStateData;
    },

    async delete(state): Promise<void> {
      await client.del(prefix + state);
    },

    cleanup(): void {
      // Redis expires keys itself — nothing to prune.
    },
  };
}
