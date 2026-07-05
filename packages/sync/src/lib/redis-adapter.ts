import { Redis } from "ioredis";
import type { RedisOptions } from "ioredis";
import type { SyncAdapter, SyncMessage } from "./sync.js";

export interface RedisAdapterOptions {
  /** Redis server hostname. Defaults to "127.0.0.1". Ignored when `url` is set. */
  host?: string;
  /** Redis server port. Defaults to 6379. Ignored when `url` is set. */
  port?: number;
  /** Full Redis connection URL (e.g. "redis://user:pass@host:6379/0"). Takes precedence over host/port. */
  url?: string;
  /** Redis password / AUTH token. */
  password?: string;
  /** Redis database index. Defaults to 0. */
  db?: number;
  /** Enable TLS. */
  tls?: boolean;
}

function createClient(options: RedisAdapterOptions): Redis {
  const shared: Partial<RedisOptions> = options.tls ? { tls: {} } : {};
  if (options.url) {
    return new Redis(options.url, shared);
  }
  return new Redis({
    host: options.host ?? "127.0.0.1",
    port: options.port ?? 6379,
    password: options.password,
    db: options.db,
    ...shared,
  });
}

/**
 * Redis pub/sub adapter for `@mantlejs/sync`.
 *
 * Uses two separate ioredis connections — one dedicated to publishing and one
 * to subscribing — as required by the Redis pub/sub protocol.
 * Compatible with DragonflyDB (drop-in Redis replacement).
 *
 * `ioredis` must be installed as a peer dependency:
 * ```
 * npm install ioredis
 * ```
 *
 * @example
 * ```ts
 * import { sync, redisAdapter } from '@mantlejs/sync';
 *
 * app.configure(sync({ adapter: redisAdapter({ url: process.env.REDIS_URL }) }));
 * ```
 */
export function redisAdapter(options: RedisAdapterOptions = {}): SyncAdapter {
  let pub: InstanceType<typeof Redis> | null = null;
  let sub: InstanceType<typeof Redis> | null = null;

  return {
    async subscribe(channel: string, handler: (message: SyncMessage) => void): Promise<void> {
      pub = createClient(options);
      sub = createClient(options);

      await sub.subscribe(channel);
      sub.on("message", (_ch: string, payload: string) => {
        try {
          handler(JSON.parse(payload) as SyncMessage);
        } catch {
          // malformed payload — ignore
        }
      });
    },

    async publish(channel: string, message: SyncMessage): Promise<void> {
      if (!pub) return;
      await pub.publish(channel, JSON.stringify(message));
    },

    async close(): Promise<void> {
      await Promise.allSettled([pub?.quit(), sub?.quit()]);
      pub = null;
      sub = null;
    },
  };
}
