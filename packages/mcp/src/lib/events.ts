import type { MantleApplication } from "@mantlejs/mantle";
import { DEFAULT_EVENT_BUFFER_SIZE } from "./types.js";

export interface EventRecord {
  event: string;
  path: string;
  data: unknown;
  timestamp: string;
}

/**
 * Ring buffer of recent `service:event` emissions, per service path. Deliberately minimal:
 * agents that need real-time should use the socket transport — this exists so an agent can
 * poll "what changed". Buffers every path (events fire before the expose map is resolved);
 * the server layer only ever reads exposed paths, so hidden services never leak.
 */
export class EventLog {
  private readonly buffers = new Map<string, EventRecord[]>();
  private readonly listeners = new Set<(path: string) => void>();

  constructor(app: MantleApplication, private readonly size: number = DEFAULT_EVENT_BUFFER_SIZE) {
    app.on("service:event", (...args: unknown[]) => {
      const [path, event, data] = args as [string, string, unknown];
      const buffer = this.buffers.get(path) ?? [];
      buffer.push({ event, path, data, timestamp: new Date().toISOString() });
      if (buffer.length > this.size) buffer.splice(0, buffer.length - this.size);
      this.buffers.set(path, buffer);
      for (const listener of this.listeners) listener(path);
    });
  }

  read(path: string): EventRecord[] {
    return [...(this.buffers.get(path) ?? [])];
  }

  /** Subscribe to "a new event landed for path"; returns the unsubscribe function. */
  onUpdate(listener: (path: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
