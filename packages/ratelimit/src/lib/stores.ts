/** The result of counting a hit against a fixed window. */
export interface RateLimitHit {
  /** Total cost counted in the current window, including this hit. */
  count: number;
  /** Seconds until the current window ends and the count resets. */
  resetSeconds: number;
}

/**
 * Where rate-limit counters live. `hit()` must add `cost` and read the new total atomically, and start a window of
 * `windowSeconds` on the first hit for a key — which `Repository<T>` can't express without a race, so stores have
 * their own interface (PRD Decision #5).
 */
export interface RateLimitStore {
  hit(key: string, windowSeconds: number, cost: number): Promise<RateLimitHit>;
}

/**
 * In-process counters. Correct for a single instance; with several instances behind a load balancer each keeps its
 * own counts, so the effective limit multiplies — use `redisStore()` there. Expired windows are pruned lazily.
 */
export function memoryStore(options: { now?: () => number } = {}): RateLimitStore {
  const now = options.now ?? Date.now;
  const windows = new Map<string, { count: number; resetAt: number }>();
  let nextPrune = 0;

  return {
    async hit(key, windowSeconds, cost) {
      const time = now();
      if (time >= nextPrune) {
        for (const [entryKey, entry] of windows) if (entry.resetAt <= time) windows.delete(entryKey);
        nextPrune = time + 60_000;
      }
      let entry = windows.get(key);
      if (!entry || entry.resetAt <= time) {
        entry = { count: 0, resetAt: time + windowSeconds * 1000 };
        windows.set(key, entry);
      }
      entry.count += cost;
      return { count: entry.count, resetSeconds: (entry.resetAt - time) / 1000 };
    },
  };
}

/**
 * The subset of Redis commands `redisStore()` uses, shaped to match `ioredis`. Typing it structurally keeps `ioredis`
 * out of this package's dependencies; any client with this signature works, including `ioredis-mock` in tests. For
 * `redis` (node-redis), adapt it: `{ eval: (script, n, ...args) => client.eval(script, { keys: args.slice(0, n),
 * arguments: args.slice(n).map(String) }) }`.
 */
export interface RedisEvalClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

/**
 * Count and start the window in one atomic step: INCRBY, then set the expiry only if the key has none (the first hit
 * of a window). Returns the new count and the milliseconds left in the window.
 */
const HIT_SCRIPT = `
local count = redis.call("INCRBY", KEYS[1], ARGV[1])
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
  ttl = tonumber(ARGV[2])
end
return { count, ttl }
`;

/** Counters in Redis, shared by every instance. One key per policy and caller, expiring with its window. */
export function redisStore(client: RedisEvalClient, options: { prefix?: string } = {}): RateLimitStore {
  const prefix = options.prefix ?? "mantle:ratelimit:";
  return {
    async hit(key, windowSeconds, cost) {
      const [count, ttl] = (await client.eval(HIT_SCRIPT, 1, `${prefix}${key}`, cost, windowSeconds * 1000)) as [
        number,
        number,
      ];
      return { count: Number(count), resetSeconds: Number(ttl) / 1000 };
    },
  };
}
