/**
 * The subset of Redis commands the stores use, shaped to match `ioredis`.
 * Typing structurally keeps `ioredis` out of this package's runtime
 * dependencies — any client with these signatures works, including
 * `ioredis-mock` in tests.
 */
export interface RedisClientLike {
  set(key: string, value: string, expiryMode: "EX", seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  /** Atomic get-and-delete (Redis ≥ 6.2) — the consume-once primitive. */
  getdel(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<number>;
}
