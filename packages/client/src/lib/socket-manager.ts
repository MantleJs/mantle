import { MantleClientError } from "./errors.js";
import type { SocketFactory, SocketLike, SocketOptions } from "./types.js";

type Handler = (data: unknown) => void;

/**
 * Owns the single lazily-created socket.io connection shared by all service
 * clients. Handlers register synchronously into a local registry; the socket
 * (and the optional `socket.io-client` peer) is loaded on the first `on()`
 * call, and one underlying socket listener per event name multiplexes to
 * every registered handler.
 */
export class SocketManager {
  private socket?: SocketLike;
  private connecting = false;
  private connectError?: MantleClientError;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly dispatchers = new Map<string, (...args: unknown[]) => void>();
  private everConnected = false;

  constructor(
    private readonly url: string,
    private readonly options: SocketOptions,
    private readonly onReconnect: () => void,
  ) {}

  on(eventName: string, handler: Handler): void {
    if (this.connectError) throw this.connectError;
    let set = this.handlers.get(eventName);
    if (!set) {
      set = new Set();
      this.handlers.set(eventName, set);
    }
    set.add(handler);
    this.ensureSocket();
    this.attach(eventName);
  }

  off(eventName: string, handler: Handler): void {
    const set = this.handlers.get(eventName);
    if (!set) return;
    set.delete(handler);
    if (set.size > 0) return;
    this.handlers.delete(eventName);
    const dispatcher = this.dispatchers.get(eventName);
    if (dispatcher) {
      this.dispatchers.delete(eventName);
      this.socket?.off(eventName, dispatcher);
    }
  }

  /** Attach the multiplexing socket listener for an event name (once, socket permitting). */
  private attach(eventName: string): void {
    if (!this.socket || this.dispatchers.has(eventName)) return;
    const dispatcher = (data: unknown): void => {
      const set = this.handlers.get(eventName);
      if (!set) return;
      for (const handler of [...set]) handler(data);
    };
    this.dispatchers.set(eventName, dispatcher);
    this.socket.on(eventName, dispatcher);
  }

  private ensureSocket(): void {
    if (this.socket || this.connecting) return;
    this.connecting = true;
    void this.createSocket().catch((err: unknown) => {
      // `on()` is synchronous, so a failed dynamic import of the optional peer
      // can only surface on the next call — stash it and rethrow there.
      this.connectError =
        err instanceof MantleClientError
          ? err
          : new MantleClientError(String(err instanceof Error ? err.message : err), 500, "GeneralError");
    });
  }

  private async createSocket(): Promise<void> {
    const { io, ...connectOptions } = this.options;
    const factory = io ?? (await loadSocketIoClient());
    const socket = factory(this.url, connectOptions);
    this.socket = socket;
    socket.on("connect", () => {
      if (this.everConnected) this.onReconnect();
      this.everConnected = true;
    });
    for (const eventName of this.handlers.keys()) this.attach(eventName);
  }
}

async function loadSocketIoClient(): Promise<SocketFactory> {
  try {
    const mod = (await import("socket.io-client")) as { io: SocketFactory };
    return mod.io;
  } catch {
    throw new MantleClientError(
      "Real-time events require the optional peer dependency socket.io-client — npm install socket.io-client",
      500,
      "GeneralError",
    );
  }
}
