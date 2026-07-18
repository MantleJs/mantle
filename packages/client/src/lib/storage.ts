import type { TokenStorage } from "./types.js";

/** In-memory `TokenStorage` — the default outside the browser. */
export function memoryStorage(): TokenStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

/** `localStorage` when available (browser), otherwise {@link memoryStorage}. */
export function defaultStorage(): TokenStorage {
  const localStorage = (globalThis as { localStorage?: TokenStorage }).localStorage;
  return localStorage ?? memoryStorage();
}
