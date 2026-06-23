export interface OAuthStateData {
  codeVerifier?: string;
  expiresAt: number;
}

export interface OAuthStateStore {
  set(state: string, data: Omit<OAuthStateData, "expiresAt">): void;
  get(state: string): OAuthStateData | undefined;
  delete(state: string): void;
  cleanup(): void;
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
