import { randomUUID } from "node:crypto";
import type { Logger, MantleApplication, MantlePlugin } from "@mantlejs/mantle";

export interface SyncMessage {
  /** UUID identifying the originating process instance. Used for deduplication. */
  originId: string;
  path: string;
  event: string;
  result: unknown;
  params: Record<string, unknown>;
}

export interface SyncAdapter {
  publish(channel: string, message: SyncMessage): Promise<void>;
  subscribe(channel: string, handler: (message: SyncMessage) => void): Promise<void>;
  close(): Promise<void>;
}

export interface SyncOptions {
  adapter: SyncAdapter;
  /** Pub/sub channel name shared across all instances. Defaults to "mantle:sync". */
  channel?: string;
}

/**
 * Mantle plugin that synchronises `service:event` emissions across multiple
 * application instances via a pluggable message broker.
 *
 * - Listens for `service:event` on the local event bus and publishes each
 *   event to the broker under a shared channel name.
 * - Subscribes to that channel and re-emits received messages back onto the
 *   local bus — where `@mantlejs/socketio` picks them up and fans them out.
 * - Messages originating from this instance (matched by `instanceId`) are
 *   dropped to prevent double-delivery.
 * - Broker failures are non-fatal: warnings are logged, no exceptions thrown.
 *
 * @example
 * ```ts
 * import { sync, redisAdapter } from '@mantlejs/sync';
 *
 * app.configure(sync({ adapter: redisAdapter() }));
 * ```
 */
export function sync(options: SyncOptions): MantlePlugin {
  return async (app: MantleApplication): Promise<void> => {
    const instanceId = randomUUID();
    const channelName = options.channel ?? "mantle:sync";
    const { adapter } = options;
    const logger = app.get<Logger | undefined>("logger");

    app.on("service:event", (path: unknown, event: unknown, result: unknown, params: unknown) => {
      const message: SyncMessage = {
        originId: instanceId,
        path: path as string,
        event: event as string,
        result,
        params: (params ?? {}) as Record<string, unknown>,
      };
      adapter.publish(channelName, message).catch((err: unknown) => {
        logger?.warn("sync: publish failed", { component: "mantle:sync", error: String(err) });
      });
    });

    try {
      await adapter.subscribe(channelName, (message: SyncMessage) => {
        if (message.originId === instanceId) return;
        app.emit("service:event", message.path, message.event, message.result, message.params);
      });
    } catch (err) {
      logger?.warn("sync: subscribe failed", { component: "mantle:sync", error: String(err) });
    }

    const originalTeardown = app.teardown.bind(app);
    (app as unknown as Record<string, unknown>)["teardown"] = async (): Promise<void> => {
      try {
        await adapter.close();
      } catch (err) {
        logger?.warn("sync: close failed", { component: "mantle:sync", error: String(err) });
      }
      return originalTeardown();
    };
  };
}
