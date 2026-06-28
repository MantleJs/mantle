import type { Server as HttpServer } from "http";
import { Server, type ServerOptions, type Socket } from "socket.io";
import { GeneralError, MantleError } from "@mantlejs/mantle";
import type {
  ChannelPublisher,
  Id,
  MantleApplication,
  MantleChannel,
  MantlePlugin,
  PublishContext,
  ServiceParams,
} from "@mantlejs/mantle";

export interface SocketioOptions {
  serverOptions?: Partial<ServerOptions>;
  timeout?: number;
  path?: string;
}

type ListenFn = (port: number, callback?: () => void) => HttpServer;

const STANDARD_METHODS = ["find", "get", "create", "update", "patch", "remove"] as const;

// ─── Channel classes ──────────────────────────────────────────────────────────

interface Filterable {
  shouldSend(data: unknown, connection: Record<string, unknown>): boolean;
}

function isFilterable(ch: MantleChannel): ch is MantleChannel & Filterable {
  return typeof (ch as unknown as Record<string, unknown>)["shouldSend"] === "function";
}

class Channel implements MantleChannel {
  private readonly _connections: Record<string, unknown>[] = [];

  get connections(): Record<string, unknown>[] {
    return this._connections;
  }

  join(connection: Record<string, unknown>): this {
    if (!this._connections.includes(connection)) this._connections.push(connection);
    return this;
  }

  leave(connection: Record<string, unknown>): this {
    const idx = this._connections.indexOf(connection);
    if (idx !== -1) this._connections.splice(idx, 1);
    return this;
  }

  filter(fn: (data: unknown, connection: Record<string, unknown>) => boolean): MantleChannel {
    return new FilteredChannel(this, fn);
  }
}

class FilteredChannel implements MantleChannel {
  constructor(
    private readonly source: MantleChannel,
    private readonly predicate: (data: unknown, connection: Record<string, unknown>) => boolean,
  ) {}

  get connections(): Record<string, unknown>[] {
    return this.source.connections;
  }

  join(connection: Record<string, unknown>): this {
    this.source.join(connection);
    return this;
  }

  leave(connection: Record<string, unknown>): this {
    this.source.leave(connection);
    return this;
  }

  filter(fn: (data: unknown, connection: Record<string, unknown>) => boolean): MantleChannel {
    return new FilteredChannel(this.source, (data, conn) => this.predicate(data, conn) && fn(data, conn));
  }

  shouldSend(data: unknown, connection: Record<string, unknown>): boolean {
    return this.predicate(data, connection);
  }
}

class CombinedChannel implements MantleChannel {
  constructor(private readonly sources: Channel[]) {}

  get connections(): Record<string, unknown>[] {
    const seen = new Set<Record<string, unknown>>();
    const result: Record<string, unknown>[] = [];
    for (const source of this.sources) {
      for (const conn of source.connections) {
        if (!seen.has(conn)) {
          seen.add(conn);
          result.push(conn);
        }
      }
    }
    return result;
  }

  join(connection: Record<string, unknown>): this {
    for (const source of this.sources) source.join(connection);
    return this;
  }

  leave(connection: Record<string, unknown>): this {
    for (const source of this.sources) source.leave(connection);
    return this;
  }

  filter(fn: (data: unknown, connection: Record<string, unknown>) => boolean): MantleChannel {
    return new FilteredChannel(this, fn);
  }
}

class ChannelRegistry {
  private readonly channels = new Map<string, Channel>();

  get(name: string | string[]): MantleChannel {
    if (Array.isArray(name)) {
      return new CombinedChannel(name.map((n) => this.getOrCreate(n)));
    }
    return this.getOrCreate(name);
  }

  private getOrCreate(name: string): Channel {
    if (!this.channels.has(name)) this.channels.set(name, new Channel());
    return this.channels.get(name)!;
  }

  removeConnection(connection: Record<string, unknown>): void {
    for (const channel of this.channels.values()) channel.leave(connection);
  }
}

// ─── Broadcasting ─────────────────────────────────────────────────────────────

function toChannelArray(
  value: MantleChannel | MantleChannel[] | null | undefined | void,
): MantleChannel[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function tryGetPublisher(app: MantleApplication, path: string): ChannelPublisher<unknown> | undefined {
  try {
    return app.service(path).publisher;
  } catch {
    return undefined;
  }
}

function broadcastToChannels(
  io: Server,
  channels: MantleChannel[],
  eventName: string,
  data: unknown,
): void {
  const seen = new Set<string>();
  for (const channel of channels) {
    for (const connection of channel.connections) {
      if (isFilterable(channel) && !channel.shouldSend(data, connection)) continue;
      const socketId = connection["__socketId"] as string | undefined;
      if (!socketId || seen.has(socketId)) continue;
      seen.add(socketId);
      (io.sockets.sockets.get(socketId) as { emit: (event: string, data: unknown) => void } | undefined)?.emit(
        eventName,
        data,
      );
    }
  }
}

// ─── Socket event parsing ─────────────────────────────────────────────────────

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof MantleError) return err.toJSON();
  return new GeneralError(String(err)).toJSON();
}

function parseArgs(
  method: string,
  args: unknown[],
): { id?: Id; data?: Partial<Record<string, unknown>>; params: ServiceParams } {
  switch (method) {
    case "find":
      return { params: (args[0] as ServiceParams) ?? {} };
    case "get":
    case "remove":
      return { id: args[0] as Id, params: (args[1] as ServiceParams) ?? {} };
    case "create":
      return { data: args[0] as Partial<Record<string, unknown>>, params: (args[1] as ServiceParams) ?? {} };
    case "update":
    case "patch":
      return {
        id: args[0] as Id,
        data: args[1] as Partial<Record<string, unknown>>,
        params: (args[2] as ServiceParams) ?? {},
      };
    default:
      return { data: args[0] as Partial<Record<string, unknown>>, params: (args[1] as ServiceParams) ?? {} };
  }
}

// ─── Core wiring ─────────────────────────────────────────────────────────────

function wireSocketEvents(app: MantleApplication, io: Server): void {
  const registry = new ChannelRegistry();

  app.set("__channelFactory", (name: string | string[]) => registry.get(name));

  // Cross-transport broadcast via channels (opt-in: no publisher = no event sent)
  app.on("service:event", (path: unknown, event: unknown, result: unknown, params: unknown) => {
    const publisher =
      tryGetPublisher(app, path as string) ??
      app.get<ChannelPublisher<unknown> | undefined>("__globalPublisher");

    if (!publisher) return;

    const ctx: PublishContext = { app, path: path as string, params: params as ServiceParams };
    const channels = toChannelArray(publisher(result, ctx));
    if (!channels.length) return;

    broadcastToChannels(io, channels, `${path as string} ${event as string}`, result);
  });

  const connections = new Map<string, Record<string, unknown>>();

  io.on("connection", (socket: Socket) => {
    const connection: Record<string, unknown> = { __socketId: socket.id };
    connections.set(socket.id, connection);
    app.emit("connection", connection);

    socket.on("disconnect", () => {
      connections.delete(socket.id);
      registry.removeConnection(connection);
      app.emit("disconnect", connection);
    });

    socket.onAny(async (method: string, ...rawArgs: unknown[]) => {
      if (typeof rawArgs[rawArgs.length - 1] !== "function") return;

      const args = [...rawArgs];
      const callback = args.pop() as (error: Record<string, unknown> | null, result: unknown) => void;
      const servicePath = args.shift() as string;

      const { id, data, params } = parseArgs(method, args);
      const conn = connections.get(socket.id) ?? {};
      const socketParams: ServiceParams = { ...params, provider: "socket.io", connection: conn };

      try {
        const svc = app.service(servicePath);
        let result: unknown;
        const isStandard = (STANDARD_METHODS as readonly string[]).includes(method);

        if (isStandard) {
          if (method === "find") {
            result = await svc.find(socketParams);
          } else if (method === "create") {
            result = await svc.create(data ?? {}, socketParams);
          } else if (id !== undefined) {
            if (method === "get") {
              result = await svc.get(id, socketParams);
            } else if (method === "update") {
              result = await svc.update(id, data ?? {}, socketParams);
            } else if (method === "patch") {
              result = await svc.patch(id, data ?? {}, socketParams);
            } else if (method === "remove") {
              result = await svc.remove(id, socketParams);
            }
          } else {
            throw new GeneralError(`'id' is required for ${method}`);
          }
        } else {
          if (!svc.methods.includes(method)) {
            throw new GeneralError(`Method '${method}' is not allowed on service '${servicePath}'`);
          }
          result = await svc.dispatch(method, data, undefined, socketParams);
        }

        callback(null, result);
      } catch (err) {
        callback(serializeError(err), null);
      }
    });
  });
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export function socketio(options?: SocketioOptions): MantlePlugin {
  return (app: MantleApplication): void => {
    const originalListen = (app as unknown as Record<string, unknown>)["listen"];
    if (typeof originalListen !== "function") {
      throw new GeneralError("@mantlejs/socketio requires @mantlejs/express to be configured first");
    }

    (app as unknown as Record<string, unknown>)["listen"] = (port: number, callback?: () => void): HttpServer => {
      const httpServer = (originalListen as ListenFn)(port, callback);

      const io = new Server(httpServer, {
        path: options?.path ?? "/socket.io",
        ...(options?.timeout !== undefined ? { pingTimeout: options.timeout } : {}),
        ...options?.serverOptions,
      });

      app.set("socketio", io);
      wireSocketEvents(app, io);

      return httpServer;
    };
  };
}
