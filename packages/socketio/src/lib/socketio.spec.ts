import { describe, it, expect, vi, beforeEach } from "vitest";
import { mantle, GeneralError, NotFound } from "@mantlejs/mantle";
import type { MantleChannel } from "@mantlejs/mantle";

// ─── Mock socket.io ────────────────────────────────────────────────────────────

const { mockIoOn, mockIo, mockSocketsMap } = vi.hoisted(() => {
  const mockIoOn = vi.fn();
  const mockSocketsMap = new Map<string, { emit: ReturnType<typeof vi.fn>; id: string }>();
  const mockIo = {
    on: mockIoOn,
    sockets: { sockets: mockSocketsMap },
  };
  return { mockIoOn, mockIo, mockSocketsMap };
});

vi.mock("socket.io", () => ({
  Server: vi.fn(function MockServer() {
    return mockIo;
  }),
}));

const { socketio } = await import("./socketio.js");
const { Server } = await import("socket.io");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockHttpServer = {};

// Mimics an HTTP transport: listen() sets and emits "http:server" per the transport contract.
function makeApp(withListen = true) {
  const app = mantle();
  if (withListen) {
    (app as unknown as Record<string, unknown>)["listen"] = vi.fn().mockImplementation(() => {
      app.set("http:server", mockHttpServer);
      app.emit("http:server", mockHttpServer);
      return mockHttpServer;
    });
  }
  return app;
}

function callListen(app: ReturnType<typeof mantle>, port = 3000) {
  return ((app as unknown as Record<string, unknown>)["listen"] as (port: number) => unknown)(port);
}

function captureConnectionHandler(): (socket: ReturnType<typeof makeSocket>) => void {
  const call = mockIoOn.mock.calls.find(([event]) => event === "connection");
  return call?.[1] as (socket: ReturnType<typeof makeSocket>) => void;
}

function makeSocket(id = "socket-1") {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  let anyHandler: ((...args: unknown[]) => Promise<void>) | undefined;
  const socket = {
    id,
    on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers[event] = handler;
    }),
    onAny: vi.fn().mockImplementation((handler: (...args: unknown[]) => Promise<void>) => {
      anyHandler = handler;
    }),
    emit: vi.fn(),
    handlers,
    get anyHandler() {
      return anyHandler;
    },
  };
  mockSocketsMap.set(id, socket);
  return socket;
}

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    find: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ id: "1" }),
    create: vi.fn().mockResolvedValue({ id: "1", name: "Alice" }),
    update: vi.fn().mockResolvedValue({ id: "1", name: "Updated" }),
    patch: vi.fn().mockResolvedValue({ id: "1", name: "Patched" }),
    remove: vi.fn().mockResolvedValue({ id: "1" }),
    ...overrides,
  };
}

// ─── Plugin setup ─────────────────────────────────────────────────────────────

describe("socketio() — plugin setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketsMap.clear();
  });

  it("throws GeneralError if no HTTP transport was configured first", () => {
    const app = makeApp(false);
    expect(() => app.configure(socketio())).toThrow(GeneralError);
  });

  it("stores socket.io Server on the app after listen()", () => {
    const app = makeApp();
    app.configure(socketio());
    callListen(app);
    expect(app.get("socketio")).toBe(mockIo);
  });

  it("creates Server with the http.Server emitted by the transport", () => {
    const app = makeApp();
    app.configure(socketio());
    callListen(app);
    expect(vi.mocked(Server)).toHaveBeenCalledWith(mockHttpServer, expect.any(Object));
  });

  it("uses default path /socket.io", () => {
    const app = makeApp();
    app.configure(socketio());
    callListen(app);
    expect(vi.mocked(Server)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ path: "/socket.io" }));
  });

  it("uses custom path when provided", () => {
    const app = makeApp();
    app.configure(socketio({ path: "/ws" }));
    callListen(app);
    expect(vi.mocked(Server)).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ path: "/ws" }));
  });

  it("passes serverOptions to the socket.io Server", () => {
    const app = makeApp();
    app.configure(socketio({ serverOptions: { cors: { origin: "*" } } }));
    callListen(app);
    expect(vi.mocked(Server)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cors: { origin: "*" } }),
    );
  });

  it("sets pingTimeout when timeout is provided", () => {
    const app = makeApp();
    app.configure(socketio({ timeout: 5000 }));
    callListen(app);
    expect(vi.mocked(Server)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pingTimeout: 5000 }),
    );
  });

  it("registers a connection listener on the socket.io Server", () => {
    const app = makeApp();
    app.configure(socketio());
    callListen(app);
    expect(mockIoOn).toHaveBeenCalledWith("connection", expect.any(Function));
  });

  it("returns the http.Server from listen()", () => {
    const app = makeApp();
    app.configure(socketio());
    const result = callListen(app);
    expect(result).toBe(mockHttpServer);
  });

  it("installs channel factory so app.channel() works after configure", () => {
    const app = makeApp();
    app.configure(socketio());
    callListen(app);
    expect(() => app.channel("test")).not.toThrow();
  });
});

// ─── Standard method handlers ─────────────────────────────────────────────────

describe("socketio() — standard service methods", () => {
  let app: ReturnType<typeof mantle>;
  let socket: ReturnType<typeof makeSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketsMap.clear();
    app = makeApp();
    app.configure(socketio());
    callListen(app);

    socket = makeSocket();
    captureConnectionHandler()(socket);
  });

  it("registers an onAny handler on each connection", () => {
    expect(socket.onAny).toHaveBeenCalledWith(expect.any(Function));
  });

  const invoke = (method: string, ...args: unknown[]) => socket.anyHandler!(method, ...args);

  it("find: calls service.find with provider=socket.io", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    const cb = vi.fn();
    await invoke("find", "messages", {}, cb);
    expect(svc.find).toHaveBeenCalledWith(expect.objectContaining({ provider: "socket.io" }));
    expect(cb).toHaveBeenCalledWith(null, expect.any(Array));
  });

  it("find: merges caller params", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    const cb = vi.fn();
    await invoke("find", "messages", { query: { active: true } }, cb);
    expect(svc.find).toHaveBeenCalledWith(
      expect.objectContaining({ query: { active: true }, provider: "socket.io" }),
    );
  });

  it("get: passes id to service.get", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    const cb = vi.fn();
    await invoke("get", "messages", "42", {}, cb);
    expect(svc.get).toHaveBeenCalledWith("42", expect.objectContaining({ provider: "socket.io" }));
    expect(cb).toHaveBeenCalledWith(null, { id: "1" });
  });

  it("create: passes data to service.create", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    const cb = vi.fn();
    await invoke("create", "messages", { text: "Hello" }, {}, cb);
    expect(svc.create).toHaveBeenCalledWith({ text: "Hello" }, expect.objectContaining({ provider: "socket.io" }));
    expect(cb).toHaveBeenCalledWith(null, { id: "1", name: "Alice" });
  });

  it("update: passes id and data to service.update", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    const cb = vi.fn();
    await invoke("update", "messages", "1", { text: "Edited" }, {}, cb);
    expect(svc.update).toHaveBeenCalledWith("1", { text: "Edited" }, expect.objectContaining({ provider: "socket.io" }));
  });

  it("patch: passes id and data to service.patch", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    const cb = vi.fn();
    await invoke("patch", "messages", "1", { text: "Patched" }, {}, cb);
    expect(svc.patch).toHaveBeenCalledWith("1", { text: "Patched" }, expect.objectContaining({ provider: "socket.io" }));
  });

  it("remove: passes id to service.remove", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    const cb = vi.fn();
    await invoke("remove", "messages", "1", {}, cb);
    expect(svc.remove).toHaveBeenCalledWith("1", expect.objectContaining({ provider: "socket.io" }));
  });

  it("ignores events that have no callback as last arg", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    await invoke("find", "messages", {});
    expect(svc.find).not.toHaveBeenCalled();
  });
});

// ─── Channel API ──────────────────────────────────────────────────────────────

describe("socketio() — Channel", () => {
  let app: ReturnType<typeof mantle>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketsMap.clear();
    app = makeApp();
    app.configure(socketio());
    callListen(app);
  });

  it("join adds a connection to the channel", () => {
    const conn = { userId: "1" };
    app.channel("authenticated").join(conn);
    expect(app.channel("authenticated").connections).toContain(conn);
  });

  it("join deduplicates — same connection is not added twice", () => {
    const conn = { userId: "1" };
    app.channel("authenticated").join(conn).join(conn);
    expect(app.channel("authenticated").connections).toHaveLength(1);
  });

  it("leave removes a connection from the channel", () => {
    const conn = { userId: "1" };
    app.channel("authenticated").join(conn);
    app.channel("authenticated").leave(conn);
    expect(app.channel("authenticated").connections).toHaveLength(0);
  });

  it("leave on an absent connection is a no-op", () => {
    expect(() => app.channel("authenticated").leave({ userId: "ghost" })).not.toThrow();
  });

  it("filter returns a channel whose shouldSend applies the predicate", () => {
    const conn = { role: "admin" };
    const ch = app.channel("all").join(conn);
    const filtered = ch.filter((_, c) => (c as { role?: string }).role === "admin") as MantleChannel & {
      shouldSend: (d: unknown, c: Record<string, unknown>) => boolean;
    };
    expect(filtered.shouldSend(null, conn)).toBe(true);
    expect(filtered.shouldSend(null, { role: "user" })).toBe(false);
  });

  it("chained filter composes predicates (both must pass)", () => {
    const ch = app
      .channel("all")
      .filter((_, c) => (c as Record<string, unknown>)["a"] === true)
      .filter((_, c) => (c as Record<string, unknown>)["b"] === true) as MantleChannel & {
      shouldSend: (d: unknown, c: Record<string, unknown>) => boolean;
    };
    expect(ch.shouldSend(null, { a: true, b: true })).toBe(true);
    expect(ch.shouldSend(null, { a: true, b: false })).toBe(false);
    expect(ch.shouldSend(null, { a: false, b: true })).toBe(false);
  });

  it("channel(array) returns a combined channel with the union of connections", () => {
    const connA = { id: "a" };
    const connB = { id: "b" };
    app.channel("admins").join(connA);
    app.channel("moderators").join(connB);
    const combined = app.channel(["admins", "moderators"]);
    expect(combined.connections).toHaveLength(2);
    expect(combined.connections).toContain(connA);
    expect(combined.connections).toContain(connB);
  });

  it("channel(array) deduplicates connections present in multiple channels", () => {
    const conn = { id: "shared" };
    app.channel("a").join(conn);
    app.channel("b").join(conn);
    const combined = app.channel(["a", "b"]);
    expect(combined.connections).toHaveLength(1);
  });
});

// ─── App connection/disconnect events ────────────────────────────────────────

describe("socketio() — app connection events", () => {
  let app: ReturnType<typeof mantle>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketsMap.clear();
    app = makeApp();
    app.configure(socketio());
    callListen(app);
  });

  it("emits 'connection' on app when a socket connects", () => {
    const received: unknown[] = [];
    app.on("connection", (conn) => received.push(conn));
    const socket = makeSocket();
    captureConnectionHandler()(socket);
    expect(received).toHaveLength(1);
    expect(typeof received[0]).toBe("object");
  });

  it("emits 'disconnect' on app when a socket disconnects", () => {
    const received: unknown[] = [];
    app.on("disconnect", (conn) => received.push(conn));
    const socket = makeSocket();
    captureConnectionHandler()(socket);
    const disconnectHandler = socket.on.mock.calls.find(([event]) => event === "disconnect")?.[1] as () => void;
    disconnectHandler();
    expect(received).toHaveLength(1);
  });

  it("removes connection from all channels on disconnect", () => {
    const socket = makeSocket();
    captureConnectionHandler()(socket);

    let captured: Record<string, unknown> | undefined;
    app.on("connection", (conn) => {
      captured = conn as Record<string, unknown>;
      app.channel("authenticated").join(conn as Record<string, unknown>);
    });

    const socket2 = makeSocket("socket-2");
    captureConnectionHandler()(socket2);

    expect(captured).toBeDefined();
    expect(app.channel("authenticated").connections).toContain(captured);

    const disconnectHandler = socket2.on.mock.calls.find(([event]) => event === "disconnect")?.[1] as () => void;
    disconnectHandler();

    expect(app.channel("authenticated").connections).not.toContain(captured);
  });

  it("connection object includes __socketId for internal socket lookup", () => {
    let captured: Record<string, unknown> | undefined;
    app.on("connection", (conn) => {
      captured = conn as Record<string, unknown>;
    });
    const socket = makeSocket("my-socket-id");
    captureConnectionHandler()(socket);
    expect(captured?.["__socketId"]).toBe("my-socket-id");
  });
});

// ─── Channel-based broadcasting ───────────────────────────────────────────────

describe("socketio() — channel broadcasting (opt-in)", () => {
  let app: ReturnType<typeof mantle>;
  let socket: ReturnType<typeof makeSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketsMap.clear();
    app = makeApp();
    // Join all connections to 'everyone' channel at connect time
    app.on("connection", (conn) => {
      app.channel("everyone").join(conn as Record<string, unknown>);
    });
    app.configure(socketio());
    callListen(app);
    socket = makeSocket();
    captureConnectionHandler()(socket);
  });

  it("does NOT broadcast when no publisher is configured (opt-in security)", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    await app.service("messages").create({ text: "Hello" }, { provider: "rest" });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("broadcasts to channel connections when a global publisher is configured", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    app.publish(() => app.channel("everyone"));
    await app.service("messages").create({ text: "Hello" }, { provider: "rest" });
    expect(socket.emit).toHaveBeenCalledWith("messages created", expect.objectContaining({ name: "Alice" }));
  });

  it("broadcasts 'messages updated' after update (global publisher)", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    app.publish(() => app.channel("everyone"));
    await app.service("messages").update("1", { text: "Edited" });
    expect(socket.emit).toHaveBeenCalledWith("messages updated", expect.any(Object));
  });

  it("broadcasts 'messages patched' after patch (global publisher)", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    app.publish(() => app.channel("everyone"));
    await app.service("messages").patch("1", { text: "P" });
    expect(socket.emit).toHaveBeenCalledWith("messages patched", expect.any(Object));
  });

  it("broadcasts 'messages removed' after remove (global publisher)", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    app.publish(() => app.channel("everyone"));
    await app.service("messages").remove("1");
    expect(socket.emit).toHaveBeenCalledWith("messages removed", expect.any(Object));
  });

  it("does NOT broadcast after find or get (no service:event emitted)", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    app.publish(() => app.channel("everyone"));
    await app.service("messages").find();
    await app.service("messages").get("1");
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("does NOT broadcast when service throws", async () => {
    app.use("messages", { create: vi.fn().mockRejectedValue(new Error("fail")) } as never);
    app.publish(() => app.channel("everyone"));
    await expect(app.service("messages").create({})).rejects.toThrow();
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("uses per-service publisher over global publisher", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    app.publish(() => app.channel("everyone"));          // global
    app.service("messages").publish(() => app.channel("nobody")); // per-service: empty channel

    await app.service("messages").create({ text: "Hello" });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("falls back to global publisher when no per-service publisher is set", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    app.publish(() => app.channel("everyone")); // global only

    await app.service("messages").create({ text: "Hello" });
    expect(socket.emit).toHaveBeenCalledWith("messages created", expect.any(Object));
  });

  it("params.rooms broadcasts only to the named channels, even without a publisher", async () => {
    const inRoom = makeSocket("in-room");
    captureConnectionHandler()(inRoom);
    const roomConn = app
      .channel("everyone")
      .connections.find((c) => c["__socketId"] === "in-room") as Record<string, unknown>;
    app.channel("admins").join(roomConn);

    const svc = makeService();
    app.use("messages", svc as never);
    await app.service("messages").create({ text: "Hello" }, { provider: "rest", rooms: ["admins"] });

    expect(inRoom.emit).toHaveBeenCalledWith("messages created", expect.any(Object));
    expect(socket.emit).not.toHaveBeenCalled(); // not in "admins"
  });

  it("params.rooms overrides the configured publisher", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    app.publish(() => app.channel("everyone")); // would reach `socket`

    await app.service("messages").create({ text: "Hello" }, { provider: "rest", rooms: "empty-room" });
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("cross-transport: REST mutation triggers socket broadcast", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    app.publish(() => app.channel("everyone"));
    await app.service("messages").create({ text: "Hello" }, { provider: "rest" });
    expect(socket.emit).toHaveBeenCalledWith("messages created", expect.objectContaining({ name: "Alice" }));
  });
});

// ─── Channel filtering in publisher ──────────────────────────────────────────

describe("socketio() — publisher filter", () => {
  let app: ReturnType<typeof mantle>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketsMap.clear();
    app = makeApp();
    app.configure(socketio());
    callListen(app);
  });

  it("applies filter predicate — matching connection receives event", async () => {
    // Register handler BEFORE connecting sockets so connections land in the channel
    app.on("connection", (conn) => {
      app.channel("all").join(conn as Record<string, unknown>);
    });

    const adminSocket = makeSocket("admin");
    const userSocket = makeSocket("user");
    captureConnectionHandler()(adminSocket);
    captureConnectionHandler()(userSocket);

    // Mark admin connection after it has been added to the channel
    const adminConn = app.channel("all").connections.find((c) => c["__socketId"] === "admin")!;
    adminConn["role"] = "admin";

    app.use("secret", makeService() as never);
    app.service("secret").publish(() =>
      app.channel("all").filter((_, conn) => (conn as Record<string, unknown>)["role"] === "admin"),
    );

    await app.service("secret").create({});
    expect(adminSocket.emit).toHaveBeenCalledWith("secret created", expect.any(Object));
    expect(userSocket.emit).not.toHaveBeenCalled();
  });

  it("deduplicates across multiple channels returned by publisher", async () => {
    const sock = makeSocket("sock");
    captureConnectionHandler()(sock);
    const conn = app.channel("all").connections.find((c) => c["__socketId"] === "sock")!;

    // Wait — the app.on('connection') wasn't set before captureConnectionHandler... let me add the conn manually
    app.on("connection", (c) => {
      app.channel("ch-a").join(c as Record<string, unknown>);
      app.channel("ch-b").join(c as Record<string, unknown>);
    });

    const sock2 = makeSocket("sock2");
    captureConnectionHandler()(sock2);

    app.use("items", makeService() as never);
    app.service("items").publish(() => [app.channel("ch-a"), app.channel("ch-b")]);

    await app.service("items").create({});
    expect(sock2.emit).toHaveBeenCalledTimes(1); // not twice despite being in both channels
    void conn; // suppress unused warning
  });
});

// ─── Connection state ─────────────────────────────────────────────────────────

describe("socketio() — connection state", () => {
  let app: ReturnType<typeof mantle>;
  let socket: ReturnType<typeof makeSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketsMap.clear();
    app = makeApp();
    app.configure(socketio());
    callListen(app);

    socket = makeSocket();
    captureConnectionHandler()(socket);
  });

  it("includes a connection object in params for each socket call", async () => {
    let capturedConnection: Record<string, unknown> | undefined;
    app.use("messages", {
      async find(params) {
        capturedConnection = params?.connection;
        return [];
      },
    } as never);

    const cb = vi.fn();
    await socket.anyHandler!("find", "messages", {}, cb);
    expect(capturedConnection).toBeDefined();
    expect(typeof capturedConnection).toBe("object");
  });

  it("connection state persists across calls from the same socket", async () => {
    const connections: Array<Record<string, unknown>> = [];
    app.use("messages", {
      async find(params) {
        if (params?.connection) connections.push(params.connection);
        return [];
      },
    } as never);

    const cb = vi.fn();
    await socket.anyHandler!("find", "messages", {}, cb);
    await socket.anyHandler!("find", "messages", {}, cb);

    expect(connections).toHaveLength(2);
    expect(connections[0]).toBe(connections[1]);
  });

  it("disconnect handler is registered on the socket", () => {
    const disconnectCall = socket.on.mock.calls.find(([event]) => event === "disconnect");
    expect(disconnectCall).toBeDefined();
  });

  it("different sockets get independent connection objects", async () => {
    const socketA = makeSocket("a");
    const socketB = makeSocket("b");
    captureConnectionHandler()(socketA);
    captureConnectionHandler()(socketB);

    const connectionsA: Array<Record<string, unknown>> = [];
    const connectionsB: Array<Record<string, unknown>> = [];
    app.use("messages", {
      async find(params) {
        if (params?.connection) {
          if (params.headers?.["x-socket"] === "a") connectionsA.push(params.connection);
          else connectionsB.push(params.connection);
        }
        return [];
      },
    } as never);

    const cb = vi.fn();
    await socketA.anyHandler!("find", "messages", { headers: { "x-socket": "a" } }, cb);
    await socketB.anyHandler!("find", "messages", { headers: { "x-socket": "b" } }, cb);

    expect(connectionsA[0]).not.toBe(connectionsB[0]);
  });
});

// ─── Custom methods ───────────────────────────────────────────────────────────

describe("socketio() — custom methods", () => {
  let app: ReturnType<typeof mantle>;
  let socket: ReturnType<typeof makeSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketsMap.clear();
    app = makeApp();
    app.configure(socketio());
    callListen(app);

    socket = makeSocket();
    captureConnectionHandler()(socket);
  });

  it("routes a custom method to service.dispatch()", async () => {
    const chargeResult = { charged: true };
    const svc = { ...makeService(), charge: vi.fn().mockResolvedValue(chargeResult) };
    app.use("payments", svc as never, { methods: ["find", "charge"] });

    const handle = app.service("payments");
    const originalDispatch = handle.dispatch.bind(handle);
    const dispatchSpy = vi.fn().mockImplementation(originalDispatch);
    (handle as unknown as Record<string, unknown>)["dispatch"] = dispatchSpy;

    const cb = vi.fn();
    await socket.anyHandler!("charge", "payments", { amount: 100 }, {}, cb);

    expect(dispatchSpy).toHaveBeenCalledWith(
      "charge",
      { amount: 100 },
      undefined,
      expect.objectContaining({ provider: "socket.io" }),
    );
    expect(cb).toHaveBeenCalledWith(null, expect.any(Object));
  });

  it("returns error when custom method is not in service's allowed methods", async () => {
    app.use("payments", makeService() as never, { methods: ["find"] });
    const cb = vi.fn();
    await socket.anyHandler!("charge", "payments", {}, {}, cb);
    const [error] = cb.mock.calls[0] as [Record<string, unknown>, null];
    expect(error).toMatchObject({ name: "GeneralError", code: 500 });
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe("socketio() — error handling", () => {
  let app: ReturnType<typeof mantle>;
  let socket: ReturnType<typeof makeSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketsMap.clear();
    app = makeApp();
    app.configure(socketio());
    callListen(app);

    socket = makeSocket();
    captureConnectionHandler()(socket);
  });

  it("serializes MantleError via toJSON()", async () => {
    app.use("items", { find: vi.fn().mockRejectedValue(new NotFound("Not found")) } as never);
    const cb = vi.fn();
    await socket.anyHandler!("find", "items", {}, cb);
    const [error, result] = cb.mock.calls[0] as [Record<string, unknown>, null];
    expect(error).toMatchObject({ name: "NotFound", code: 404, message: "Not found" });
    expect(result).toBeNull();
  });

  it("wraps plain Error in GeneralError before serializing", async () => {
    app.use("items", { find: vi.fn().mockRejectedValue(new Error("boom")) } as never);
    const cb = vi.fn();
    await socket.anyHandler!("find", "items", {}, cb);
    const [error] = cb.mock.calls[0] as [Record<string, unknown>, null];
    expect(error).toMatchObject({ name: "GeneralError", code: 500 });
  });

  it("returns NotFound when service path is not registered", async () => {
    const cb = vi.fn();
    await socket.anyHandler!("find", "nonexistent", {}, cb);
    const [error] = cb.mock.calls[0] as [Record<string, unknown>, null];
    expect(error).toMatchObject({ name: "NotFound", code: 404 });
  });
});
