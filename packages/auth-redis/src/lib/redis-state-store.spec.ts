import { describe, expect, it } from "vitest";
import RedisMock from "ioredis-mock";
import type { OAuthStateStore } from "@mantlejs/auth-oauth";
import type { RedisClientLike } from "./redis-client.js";
import { redisStateStore } from "./redis-state-store.js";

function makeClient(): RedisClientLike {
  return new RedisMock() as unknown as RedisClientLike;
}

describe("redisStateStore", () => {
  it("round-trips a pending state with its code verifier and an expiry", async () => {
    const store: OAuthStateStore = redisStateStore(makeClient());
    const before = Date.now();

    await store.set("state-1", { codeVerifier: "verifier-1" });
    const entry = await store.get("state-1");

    expect(entry).toBeDefined();
    expect(entry?.codeVerifier).toBe("verifier-1");
    expect(entry?.expiresAt).toBeGreaterThanOrEqual(before);
  });

  it("stores states without a code verifier (non-PKCE providers)", async () => {
    const store = redisStateStore(makeClient());

    await store.set("state-1", {});

    expect((await store.get("state-1"))?.codeVerifier).toBeUndefined();
  });

  it("returns undefined for an unknown state", async () => {
    const store = redisStateStore(makeClient());

    expect(await store.get("nope")).toBeUndefined();
  });

  it("deletes a state so it cannot be replayed", async () => {
    const store = redisStateStore(makeClient());

    await store.set("state-1", { codeVerifier: "v" });
    await store.delete("state-1");

    expect(await store.get("state-1")).toBeUndefined();
  });

  it("shares state between instances using the same Redis (multi-instance callback)", async () => {
    const client = makeClient();
    const instanceA = redisStateStore(client);
    const instanceB = redisStateStore(client);

    await instanceA.set("state-1", { codeVerifier: "v" });

    expect((await instanceB.get("state-1"))?.codeVerifier).toBe("v");
  });

  it("isolates stores with different prefixes", async () => {
    const client = makeClient();
    const google = redisStateStore(client, { prefix: "google:" });
    const github = redisStateStore(client, { prefix: "github:" });

    await google.set("state-1", { codeVerifier: "v" });

    expect(await github.get("state-1")).toBeUndefined();
  });

  it("cleanup is a no-op (Redis expires keys itself)", async () => {
    const store = redisStateStore(makeClient());

    await store.set("state-1", { codeVerifier: "v" });
    await store.cleanup();

    expect(await store.get("state-1")).toBeDefined();
  });

  describe("consume — atomic read-and-remove (GETDEL)", () => {
    it("returns the pending entry once, then undefined", async () => {
      const store = redisStateStore(makeClient());
      await store.set("state-1", { codeVerifier: "v" });

      expect((await store.consume("state-1"))?.codeVerifier).toBe("v");
      expect(await store.consume("state-1")).toBeUndefined();
    });

    it("returns undefined for an unknown state", async () => {
      const store = redisStateStore(makeClient());
      expect(await store.consume("nope")).toBeUndefined();
    });

    it("a state consumed on one instance cannot be consumed again on another (multi-instance)", async () => {
      const client = makeClient();
      const instanceA = redisStateStore(client);
      const instanceB = redisStateStore(client);

      await instanceA.set("state-1", { codeVerifier: "v" });
      expect((await instanceB.consume("state-1"))?.codeVerifier).toBe("v");
      expect(await instanceA.consume("state-1")).toBeUndefined();
    });

    it("is atomic under concurrent calls for the same state — exactly one caller sees the entry", async () => {
      // The real guarantee here comes from Redis's GETDEL being a single atomic server-side
      // command (verified against a live Redis container during development, matching the
      // rotation-theft guarantee redisRefreshTokenStore's own consume() already relies on).
      // This proves the store's own async wrapper doesn't reintroduce a race around that call.
      const store = redisStateStore(makeClient());
      await store.set("state-1", { codeVerifier: "v" });

      const [first, second] = await Promise.all([store.consume("state-1"), store.consume("state-1")]);
      const winners = [first, second].filter((r) => r !== undefined);
      expect(winners).toHaveLength(1);
      expect(winners[0]?.codeVerifier).toBe("v");
    });
  });
});
