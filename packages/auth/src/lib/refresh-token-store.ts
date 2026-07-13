import type { RefreshTokenStore } from "./types.js";

interface TokenRecord {
  sub: string;
  expiresAt: number;
}

/**
 * In-memory {@link RefreshTokenStore}. Suitable for a single process only —
 * multi-instance deployments (Cloud Run) must inject a shared store via
 * `AuthConfig.refreshTokenStore`.
 *
 * Expired entries are pruned opportunistically on `add` so the map cannot grow
 * unbounded under normal issuance traffic.
 */
export function memoryRefreshTokenStore(): RefreshTokenStore {
  const tokens = new Map<string, TokenRecord>();
  const bySub = new Map<string, Set<string>>();

  function remove(jti: string): void {
    const record = tokens.get(jti);
    if (!record) return;
    tokens.delete(jti);
    const set = bySub.get(record.sub);
    if (set) {
      set.delete(jti);
      if (set.size === 0) bySub.delete(record.sub);
    }
  }

  function prune(now: number): void {
    for (const [jti, record] of tokens) {
      if (record.expiresAt * 1000 <= now) remove(jti);
    }
  }

  return {
    add(jti: string, sub: string, expiresAt: number): void {
      prune(Date.now());
      tokens.set(jti, { sub, expiresAt });
      let set = bySub.get(sub);
      if (!set) {
        set = new Set();
        bySub.set(sub, set);
      }
      set.add(jti);
    },

    consume(jti: string): boolean {
      const record = tokens.get(jti);
      if (!record) return false;
      remove(jti);
      return record.expiresAt * 1000 > Date.now();
    },

    revokeAll(sub: string): void {
      const set = bySub.get(sub);
      if (!set) return;
      for (const jti of [...set]) remove(jti);
    },
  };
}
