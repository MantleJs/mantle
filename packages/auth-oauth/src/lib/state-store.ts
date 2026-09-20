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
  /**
   * Atomically read and remove a pending state entry — the callback handler's single-use check.
   * Must not be implementable as a separate `get()` followed by `delete()`: two concurrent
   * callback requests for the same `state` (a double-fired network request, or a replayed
   * callback URL) would otherwise both pass the pending-state check before either deletes it,
   * letting both proceed to exchange the same authorization code. Implementations backed by a
   * real datastore should use its native atomic fetch-and-delete (e.g. Redis `GETDEL`, which
   * `@mantlejs/auth-redis`'s `redisStateStore` uses); the in-memory default here is atomic by
   * construction since it never awaits between the read and the delete.
   */
  consume(state: string): OAuthStateData | undefined | Promise<OAuthStateData | undefined>;
  /** Prune expired entries. May be a no-op where the backend expires keys itself. */
  cleanup(): void | Promise<void>;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function createStateStore(ttlMs = DEFAULT_TTL_MS): OAuthStateStore {
  const store = new Map<string, OAuthStateData>();

  function readValid(state: string): OAuthStateData | undefined {
    const entry = store.get(state);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      store.delete(state);
      return undefined;
    }
    return entry;
  }

  return {
    set(state, data) {
      store.set(state, { ...data, expiresAt: Date.now() + ttlMs });
    },
    get(state) {
      return readValid(state);
    },
    delete(state) {
      store.delete(state);
    },
    consume(state) {
      const entry = readValid(state);
      store.delete(state);
      return entry;
    },
    cleanup() {
      const now = Date.now();
      for (const [key, val] of store) {
        if (val.expiresAt < now) store.delete(key);
      }
    },
  };
}
