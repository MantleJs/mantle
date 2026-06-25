import type { Server as HttpServer } from "http";
import { Server, type ServerOptions, type Socket } from "socket.io";
import { GeneralError, MantleError } from "@mantlejs/core";
import type { Id, MantleApplication, MantlePlugin, ServiceParams } from "@mantlejs/core";

export interface SocketioOptions {
  serverOptions?: Partial<ServerOptions>;
  timeout?: number;
  path?: string;
}

type ListenFn = (port: number, callback?: () => void) => HttpServer;

const STANDARD_METHODS = ["find", "get", "create", "update", "patch", "remove"] as const;

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
      // Custom method: (data, params) — same shape as create
      return { data: args[0] as Partial<Record<string, unknown>>, params: (args[1] as ServiceParams) ?? {} };
  }
}

function subscribeToBroadcastEvents(app: MantleApplication, io: Server): void {
  app.on("service:event", (path: unknown, event: unknown, result: unknown, params: unknown) => {
    const rooms = (params as ServiceParams).rooms;
    const eventName = `${path as string} ${event as string}`;
    if (rooms !== undefined) {
      io.to(rooms as string | string[]).emit(eventName, result);
    } else {
      io.emit(eventName, result);
    }
  });
}

function wireSocketEvents(app: MantleApplication, io: Server): void {
  // Cross-transport: broadcast whenever any transport triggers a service mutation
  subscribeToBroadcastEvents(app, io);

  const connections = new Map<string, Record<string, unknown>>();

  io.on("connection", (socket: Socket) => {
    connections.set(socket.id, {});
    socket.on("disconnect", () => connections.delete(socket.id));

    socket.onAny(async (method: string, ...rawArgs: unknown[]) => {
      // Guard: Mantle calls always end with a callback
      if (typeof rawArgs[rawArgs.length - 1] !== "function") return;

      const args = [...rawArgs];
      const callback = args.pop() as (error: Record<string, unknown> | null, result: unknown) => void;
      const servicePath = args.shift() as string;

      const { id, data, params } = parseArgs(method, args);
      const connection = connections.get(socket.id) ?? {};
      const socketParams: ServiceParams = { ...params, provider: "socket.io", connection };

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
          // Custom method: route through dispatch
          if (!svc.methods.includes(method)) {
            throw new GeneralError(`Method '${method}' is not allowed on service '${servicePath}'`);
          }
          result = await svc.dispatch(method, data, undefined, socketParams);
        }

        callback(null, result);
        // Note: mutation broadcast is handled by subscribeToBroadcastEvents via app 'service:event'
      } catch (err) {
        callback(serializeError(err), null);
      }
    });
  });
}

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
