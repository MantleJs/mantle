import { describe, expect, it } from "vitest";
import RedisMock from "ioredis-mock";
import type { RefreshTokenStore } from "@mantlejs/auth";
import type { RedisClientLike } from "./redis-client.js";
import { redisRefreshTokenStore } from "./redis-refresh-token-store.js";

function makeClient(): RedisClientLike {
  return new RedisMock() as unknown as RedisClientLike;
}

function inOneHour(): number {
  return Math.floor(Date.now() / 1000) + 3600;
}

describe("redisRefreshTokenStore", () => {
  it("consumes an outstanding token exactly once", async () => {
    const store: RefreshTokenStore = redisRefreshTokenStore(makeClient());

    await store.add("jti-1", "user-1", inOneHour());

    expect(await store.consume("jti-1")).toBe(true);
    expect(await store.consume("jti-1")).toBe(false);
  });

  it("returns false for a jti that was never added", async () => {
    const store = redisRefreshTokenStore(makeClient());

    expect(await store.consume("unknown")).toBe(false);
  });

  it("never records an already-expired token", async () => {
    const store = redisRefreshTokenStore(makeClient());

    await store.add("jti-1", "user-1", Math.floor(Date.now() / 1000) - 1);

    expect(await store.consume("jti-1")).toBe(false);
  });

  it("revokeAll invalidates every outstanding token for the subject", async () => {
    const store = redisRefreshTokenStore(makeClient());

    await store.add("jti-1", "user-1", inOneHour());
    await store.add("jti-2", "user-1", inOneHour());
    await store.revokeAll("user-1");

    expect(await store.consume("jti-1")).toBe(false);
    expect(await store.consume("jti-2")).toBe(false);
  });

  it("revokeAll leaves other subjects' tokens outstanding", async () => {
    const store = redisRefreshTokenStore(makeClient());

    await store.add("jti-1", "user-1", inOneHour());
    await store.add("jti-2", "user-2", inOneHour());
    await store.revokeAll("user-1");

    expect(await store.consume("jti-2")).toBe(true);
  });

  it("revokeAll on a subject with no tokens is a no-op", async () => {
    const store = redisRefreshTokenStore(makeClient());

    await expect(store.revokeAll("user-1")).resolves.toBeUndefined();
  });

  it("shares tokens between instances using the same Redis (multi-instance rotation)", async () => {
    const client = makeClient();
    const instanceA = redisRefreshTokenStore(client);
    const instanceB = redisRefreshTokenStore(client);

    await instanceA.add("jti-1", "user-1", inOneHour());

    expect(await instanceB.consume("jti-1")).toBe(true);
    expect(await instanceA.consume("jti-1")).toBe(false);
  });

  it("a token consumed on one instance cannot be revived by revokeAll bookkeeping", async () => {
    const client = makeClient();
    const store = redisRefreshTokenStore(client);

    await store.add("jti-1", "user-1", inOneHour());
    await store.consume("jti-1");
    await store.add("jti-2", "user-1", inOneHour());
    await store.revokeAll("user-1");

    expect(await store.consume("jti-1")).toBe(false);
    expect(await store.consume("jti-2")).toBe(false);
  });
});
