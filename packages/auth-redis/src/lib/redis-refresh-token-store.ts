import type { RefreshTokenStore } from "@mantlejs/auth";
import type { RedisClientLike } from "./redis-client.js";

const DEFAULT_PREFIX = "mantle:auth:refresh:";

export interface RedisRefreshTokenStoreOptions {
  /** Key prefix. @default "mantle:auth:refresh:" */
  prefix?: string;
}

/**
 * Redis-backed {@link RefreshTokenStore} for multi-instance deployments.
 *
 * Layout: each `jti` is a string key holding its `sub` with a TTL matching the
 * token's `exp` (`SET … EX`), and each subject has a set of its outstanding
 * `jti`s so `revokeAll` can find them. `consume` uses `GETDEL`, so concurrent
 * consumers of the same token — the rotation-theft race — resolve atomically:
 * exactly one caller sees `true`.
 *
 * The per-subject set is re-armed to the newest token's TTL on every `add`.
 * Under a fixed `refreshExpiresIn` the newest token always expires last, so
 * the set outlives all its members; stale members left by key expiry are
 * harmless (`consume` and `revokeAll` treat a missing `jti` key as gone).
 */
export function redisRefreshTokenStore(
  client: RedisClientLike,
  options: RedisRefreshTokenStoreOptions = {},
): RefreshTokenStore {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  const jtiKey = (jti: string): string => `${prefix}jti:${jti}`;
  const subKey = (sub: string): string => `${prefix}sub:${sub}`;

  return {
    async add(jti, sub, expiresAt): Promise<void> {
      const ttl = expiresAt - Math.floor(Date.now() / 1000);
      if (ttl <= 0) return;
      await client.set(jtiKey(jti), sub, "EX", ttl);
      await client.sadd(subKey(sub), jti);
      await client.expire(subKey(sub), ttl);
    },

    async consume(jti): Promise<boolean> {
      const sub = await client.getdel(jtiKey(jti));
      if (sub === null) return false;
      await client.srem(subKey(sub), jti);
      return true;
    },

    async revokeAll(sub): Promise<void> {
      const jtis = await client.smembers(subKey(sub));
      await client.del(...jtis.map(jtiKey), subKey(sub));
    },
  };
}
