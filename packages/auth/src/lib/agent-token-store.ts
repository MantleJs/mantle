import type { AgentTokenStore } from "./types.js";

/**
 * In-memory `AgentTokenStore`. Tracks issued agent-token ids so `revokeAgentToken()` can revoke a
 * token before its JWT's natural expiry — the same problem `memoryRefreshTokenStore` solves for
 * refresh tokens. Multi-instance deployments must inject a shared implementation (e.g. a Redis-backed
 * store); this default only knows about tokens issued by the same process.
 */
export function memoryAgentTokenStore(): AgentTokenStore {
  const issued = new Map<string, number>(); // id -> expiresAt (epoch seconds)

  function reap(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [id, expiresAt] of issued) {
      if (expiresAt <= now) issued.delete(id);
    }
  }

  return {
    add(id: string, expiresAt: number): void {
      issued.set(id, expiresAt);
    },
    isValid(id: string): boolean {
      reap();
      return issued.has(id);
    },
    revoke(id: string): void {
      issued.delete(id);
    },
  };
}
