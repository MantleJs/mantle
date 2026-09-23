import { describe, expect, it, vi } from "vitest";
import { memoryAgentTokenStore } from "./agent-token-store.js";

describe("memoryAgentTokenStore", () => {
  it("is valid immediately after being added", async () => {
    const store = memoryAgentTokenStore();
    const future = Math.floor(Date.now() / 1000) + 3600;
    await store.add("agent-1", future);
    expect(await store.isValid("agent-1")).toBe(true);
  });

  it("is invalid for an id that was never issued", async () => {
    const store = memoryAgentTokenStore();
    expect(await store.isValid("unknown")).toBe(false);
  });

  it("is invalid after revoke()", async () => {
    const store = memoryAgentTokenStore();
    const future = Math.floor(Date.now() / 1000) + 3600;
    await store.add("agent-1", future);
    await store.revoke("agent-1");
    expect(await store.isValid("agent-1")).toBe(false);
  });

  it("reaps an entry once its recorded expiresAt has passed", async () => {
    vi.useFakeTimers();
    try {
      const store = memoryAgentTokenStore();
      const soon = Math.floor(Date.now() / 1000) + 1;
      await store.add("agent-1", soon);
      expect(await store.isValid("agent-1")).toBe(true);

      vi.advanceTimersByTime(2000);
      expect(await store.isValid("agent-1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
