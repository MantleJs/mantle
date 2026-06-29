import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";

/** Cross-instance sync message — mirrors the shape expected by `@mantlejs/sync`. */
export interface SyncMessage {
  /** UUID identifying the originating process instance. Used for deduplication. */
  originId: string;
  path: string;
  event: string;
  result: unknown;
  params: Record<string, unknown>;
}

/** Pluggable transport interface consumed by `@mantlejs/sync`. */
export interface SyncAdapter {
  publish(channel: string, message: SyncMessage): Promise<void>;
  subscribe(channel: string, handler: (message: SyncMessage) => void): Promise<void>;
  close(): Promise<void>;
}

export interface SupabaseAdapterOptions {
  /** Supabase project URL. Falls back to SUPABASE_URL env var. */
  url?: string;
  /** Service role key. Falls back to SUPABASE_SERVICE_KEY or SUPABASE_KEY env var. */
  key?: string;
}

const BROADCAST_EVENT = "sync";

/**
 * Supabase Realtime Broadcast adapter for `@mantlejs/sync`.
 *
 * Uses Supabase Realtime Broadcast channels as the pub/sub transport,
 * replacing Redis for teams already using Supabase infrastructure.
 *
 * @example
 * ```ts
 * import { sync } from '@mantlejs/sync';
 * import { supabaseAdapter } from '@mantlejs/supabase';
 *
 * app.configure(sync({ adapter: supabaseAdapter() }));
 * ```
 */
export function supabaseAdapter(options: SupabaseAdapterOptions = {}): SyncAdapter {
  const url = options.url ?? process.env["SUPABASE_URL"] ?? "";
  const key = options.key ?? process.env["SUPABASE_SERVICE_KEY"] ?? process.env["SUPABASE_KEY"] ?? "";

  if (!url || !key) {
    throw new Error(
      "supabaseAdapter: url and key are required. Pass them as options or set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.",
    );
  }

  const client: SupabaseClient = createClient(url, key);
  let channel: RealtimeChannel | null = null;

  return {
    async subscribe(channelName: string, handler: (message: SyncMessage) => void): Promise<void> {
      const ch = client.channel(channelName);
      channel = ch;
      await new Promise<void>((resolve, reject) => {
        ch
          .on("broadcast", { event: BROADCAST_EVENT }, ({ payload }: { payload: SyncMessage }) => {
            handler(payload);
          })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") resolve();
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              reject(new Error(`supabaseAdapter: failed to subscribe to channel '${channelName}' (status: ${status})`));
            }
          });
      });
    },

    async publish(channelName: string, message: SyncMessage): Promise<void> {
      const ch = channel;
      if (!ch) return;
      await ch.send({
        type: "broadcast",
        event: BROADCAST_EVENT,
        payload: message,
      });
    },

    async close(): Promise<void> {
      if (channel) {
        await client.removeChannel(channel);
        channel = null;
      }
    },
  };
}
