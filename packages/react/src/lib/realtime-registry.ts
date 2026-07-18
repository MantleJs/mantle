import type { MantleClient, ServiceEvent } from "@mantlejs/client";
import type { QueryClient } from "@tanstack/react-query";

const SERVICE_EVENTS: readonly ServiceEvent[] = ["created", "updated", "patched", "removed"];

/**
 * Reference-counted real-time subscriptions: one set of service-event
 * listeners per service, shared by every mounted `useFind`/`useGet` hook and
 * removed when the last hook for that service unmounts. Each event invalidates
 * the whole `[service]` key prefix so find and get caches stay consistent.
 */
export class RealtimeRegistry {
  private readonly entries = new Map<string, { count: number; detach: () => void }>();

  constructor(
    private readonly client: MantleClient,
    private readonly queryClient: QueryClient,
  ) {}

  /** Returns an idempotent unsubscribe; a no-op when the client has no socket configured. */
  subscribe(path: string): () => void {
    const service = this.client.service(path);
    if (!service.realtime) return () => undefined;
    let entry = this.entries.get(path);
    if (!entry) {
      const invalidate = (): void => {
        void this.queryClient.invalidateQueries({ queryKey: [path] });
      };
      for (const event of SERVICE_EVENTS) service.on(event, invalidate);
      entry = {
        count: 0,
        detach: (): void => {
          for (const event of SERVICE_EVENTS) service.off(event, invalidate);
        },
      };
      this.entries.set(path, entry);
    }
    const active = entry;
    active.count += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active.count -= 1;
      if (active.count === 0 && this.entries.get(path) === active) {
        this.entries.delete(path);
        active.detach();
      }
    };
  }
}
