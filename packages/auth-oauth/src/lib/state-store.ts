export interface OAuthStateData {
  codeVerifier?: string;
  expiresAt: number;
}

/**
 * Storage for pending OAuth authorization state. Methods are sync-or-async so a
 * shared store (e.g. Redis via `@mantlejs/auth-redis`) can be injected without
 * an interface change.
 */
export interface OAuthStateStore {
  set(state: string, data: Omit<OAuthStateData, "expiresAt">): void | Promise<void>;
  get(state: string): OAuthStateData | undefined | Promise<OAuthStateData | undefined>;
  delete(state: string): void | Promise<void>;
  /** Prune expired entries. May be a no-op where the backend expires keys itself. */
  cleanup(): void | Promise<void>;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function createStateStore(ttlMs = DEFAULT_TTL_MS): OAuthStateStore {
  const store = new Map<string, OAuthStateData>();

  return {
    set(state, data) {
      store.set(state, { ...data, expiresAt: Date.now() + ttlMs });
    },
    get(state) {
      const entry = store.get(state);
      if (!entry) return undefined;
      if (entry.expiresAt < Date.now()) {
        store.delete(state);
        return undefined;
      }
      return entry;
    },
    delete(state) {
      store.delete(state);
    },
    cleanup() {
      const now = Date.now();
      for (const [key, val] of store) {
        if (val.expiresAt < now) store.delete(key);
      }
    },
  };
}
