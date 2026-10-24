import RedisMock from "ioredis-mock";
import { Redis } from "ioredis";
import { memoryStore, redisStore, type RateLimitStore, type RedisEvalClient } from "./stores.js";

describe("memoryStore", () => {
  it("counts hits within a window and reports the seconds left", async () => {
    let now = 1_000_000;
    const store = memoryStore({ now: () => now });
    await expect(store.hit("k", 60, 1)).resolves.toEqual({ count: 1, resetSeconds: 60 });
    now += 15_000;
    await expect(store.hit("k", 60, 2)).resolves.toEqual({ count: 3, resetSeconds: 45 });
  });

  it("starts a new window once the old one ends", async () => {
    let now = 0;
    const store = memoryStore({ now: () => now });
    await store.hit("k", 10, 5);
    now = 10_000;
    await expect(store.hit("k", 10, 1)).resolves.toEqual({ count: 1, resetSeconds: 10 });
  });

  it("keeps keys apart", async () => {
    const store = memoryStore();
    await store.hit("a", 60, 3);
    await expect(store.hit("b", 60, 1)).resolves.toMatchObject({ count: 1 });
  });
});

/** Shared expectations for any RedisEvalClient-backed store. */
function redisStoreSpecs(label: string, makeClient: () => RedisEvalClient) {
  describe(`redisStore — ${label}`, () => {
    let client: ReturnType<typeof makeClient>;
    let store: RateLimitStore;

    beforeEach(() => {
      client = makeClient();
      // A unique prefix per test instead of FLUSHALL, which would wipe a shared Redis that MANTLE_REDIS_URL points at.
      store = redisStore(client, { prefix: `mantle-spec:${crypto.randomUUID()}:` });
    });

    afterEach(async () => {
      await (client as unknown as { quit?: () => Promise<unknown> }).quit?.();
    });

    it("counts hits and starts the window on the first hit", async () => {
      const first = await store.hit("k", 60, 1);
      expect(first.count).toBe(1);
      expect(first.resetSeconds).toBeGreaterThan(59);
      expect(first.resetSeconds).toBeLessThanOrEqual(60);
      await expect(store.hit("k", 60, 4)).resolves.toMatchObject({ count: 5 });
    });

    it("doesn't extend the window on later hits", async () => {
      await store.hit("k", 2, 1);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const later = await store.hit("k", 2, 1);
      expect(later.count).toBe(2);
      expect(later.resetSeconds).toBeLessThan(1);
    });

    it("resets after the window expires", async () => {
      await store.hit("k", 1, 3);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await expect(store.hit("k", 1, 1)).resolves.toMatchObject({ count: 1 });
    });

    it("counts concurrent hits exactly once each (atomic increment)", async () => {
      const results = await Promise.all(Array.from({ length: 25 }, () => store.hit("k", 60, 1)));
      expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    });
  });
}

redisStoreSpecs("ioredis-mock", () => new RedisMock() as unknown as RedisEvalClient);

// A real Redis proves the Lua script itself. Set MANTLE_REDIS_URL (e.g. redis://127.0.0.1:56379) to run it.
const REDIS_URL = process.env["MANTLE_REDIS_URL"];
describe.skipIf(!REDIS_URL)("real Redis", () => {
  redisStoreSpecs(REDIS_URL ?? "", () => new Redis(REDIS_URL as string) as unknown as RedisEvalClient);
});
