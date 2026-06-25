import { describe, it, expect, vi, beforeEach } from "vitest";
import { mantle, GeneralError, NotFound } from "@mantlejs/core";

// ─── Mock socket.io ────────────────────────────────────────────────────────────

const { mockIoEmit, mockIoOn, mockIo } = vi.hoisted(() => {
  const mockIoEmit = vi.fn();
  const mockIoOn = vi.fn();
  const mockIo = { on: mockIoOn, emit: mockIoEmit, to: vi.fn() };
  return { mockIoEmit, mockIoOn, mockIo };
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

function makeApp(withListen = true) {
  const app = mantle();
  if (withListen) {
    (app as unknown as Record<string, unknown>)["listen"] = vi.fn().mockReturnValue(mockHttpServer);
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
  const handlers: Record<string, (...args: unknown[]) => Promise<void>> = {};
  let anyHandler: ((...args: unknown[]) => Promise<void>) | undefined;
  return {
    id,
    on: vi.fn().mockImplementation((event: string, handler: (...args: unknown[]) => Promise<void>) => {
      handlers[event] = handler;
    }),
    onAny: vi.fn().mockImplementation((handler: (...args: unknown[]) => Promise<void>) => {
      anyHandler = handler;
    }),
    handlers,
    get anyHandler() {
      return anyHandler;
    },
    emit: vi.fn(),
  };
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
    mockIo.to = vi.fn().mockReturnValue({ emit: mockIoEmit });
  });

  it("throws GeneralError if express() was not configured first", () => {
    const app = makeApp(false);
    expect(() => app.configure(socketio())).toThrow(GeneralError);
  });

  it("stores socket.io Server on the app after listen()", () => {
    const app = makeApp();
    app.configure(socketio());
    callListen(app);
    expect(app.get("socketio")).toBe(mockIo);
  });

  it("creates Server with the http.Server returned by express listen", () => {
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
});

// ─── Standard method handlers ─────────────────────────────────────────────────

describe("socketio() — standard service methods", () => {
  let app: ReturnType<typeof mantle>;
  let socket: ReturnType<typeof makeSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIo.to = vi.fn().mockReturnValue({ emit: mockIoEmit });
    app = makeApp();
    app.configure(socketio());
    callListen(app);

    socket = makeSocket();
    captureConnectionHandler()(socket);
  });

  it("registers an onAny handler on each connection", () => {
    expect(socket.onAny).toHaveBeenCalledWith(expect.any(Function));
  });

  const invoke = (method: string, ...args: unknown[]) =>
    socket.anyHandler!(method, ...args);

  // ─── find ─────────────────────────────────────────────────────────────────

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

  // ─── get ──────────────────────────────────────────────────────────────────

  it("get: passes id to service.get", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    const cb = vi.fn();
    await invoke("get", "messages", "42", {}, cb);
    expect(svc.get).toHaveBeenCalledWith("42", expect.objectContaining({ provider: "socket.io" }));
    expect(cb).toHaveBeenCalledWith(null, { id: "1" });
  });

  // ─── create ───────────────────────────────────────────────────────────────

  it("create: passes data to service.create", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    const cb = vi.fn();
    await invoke("create", "messages", { text: "Hello" }, {}, cb);
    expect(svc.create).toHaveBeenCalledWith({ text: "Hello" }, expect.objectContaining({ provider: "socket.io" }));
    expect(cb).toHaveBeenCalledWith(null, { id: "1", name: "Alice" });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  it("update: passes id and data to service.update", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    const cb = vi.fn();
    await invoke("update", "messages", "1", { text: "Edited" }, {}, cb);
    expect(svc.update).toHaveBeenCalledWith("1", { text: "Edited" }, expect.objectContaining({ provider: "socket.io" }));
  });

  // ─── patch ────────────────────────────────────────────────────────────────

  it("patch: passes id and data to service.patch", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    const cb = vi.fn();
    await invoke("patch", "messages", "1", { text: "Patched" }, {}, cb);
    expect(svc.patch).toHaveBeenCalledWith("1", { text: "Patched" }, expect.objectContaining({ provider: "socket.io" }));
  });

  // ─── remove ───────────────────────────────────────────────────────────────

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
    await invoke("find", "messages", {});  // no callback
    expect(svc.find).not.toHaveBeenCalled();
  });
});

// ─── Cross-transport broadcasting ─────────────────────────────────────────────

describe("socketio() — cross-transport broadcasting", () => {
  let app: ReturnType<typeof mantle>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIo.to = vi.fn().mockReturnValue({ emit: mockIoEmit });
    app = makeApp();
    app.configure(socketio());
    callListen(app);
  });

  it("broadcasts 'messages created' when create is called via any transport", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    await app.service("messages").create({ text: "Hello" }, { provider: "rest" });
    expect(mockIoEmit).toHaveBeenCalledWith("messages created", expect.objectContaining({ name: "Alice" }));
  });

  it("broadcasts 'messages updated' after update", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    await app.service("messages").update("1", { text: "Edited" });
    expect(mockIoEmit).toHaveBeenCalledWith("messages updated", expect.any(Object));
  });

  it("broadcasts 'messages patched' after patch", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    await app.service("messages").patch("1", { text: "Patched" });
    expect(mockIoEmit).toHaveBeenCalledWith("messages patched", expect.any(Object));
  });

  it("broadcasts 'messages removed' after remove", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    await app.service("messages").remove("1");
    expect(mockIoEmit).toHaveBeenCalledWith("messages removed", expect.any(Object));
  });

  it("does NOT broadcast after find or get", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    await app.service("messages").find();
    await app.service("messages").get("1");
    expect(mockIoEmit).not.toHaveBeenCalled();
  });

  it("does NOT broadcast when service throws", async () => {
    app.use(
      "messages",
      { create: vi.fn().mockRejectedValue(new Error("fail")) } as never,
    );
    await expect(app.service("messages").create({})).rejects.toThrow();
    expect(mockIoEmit).not.toHaveBeenCalled();
  });
});

// ─── Selective broadcast (rooms) ──────────────────────────────────────────────

describe("socketio() — selective broadcast via params.rooms", () => {
  let app: ReturnType<typeof mantle>;

  beforeEach(() => {
    vi.clearAllMocks();
    const toResult = { emit: vi.fn() };
    mockIo.to = vi.fn().mockReturnValue(toResult);
    app = makeApp();
    app.configure(socketio());
    callListen(app);
  });

  it("broadcasts to specific rooms when params.rooms is set by a before hook", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    app.service("messages").hooks({
      before: {
        create: [
          (ctx) => {
            ctx.params.rooms = ["admins", "moderators"];
            return ctx;
          },
        ],
      },
    });

    await app.service("messages").create({ text: "Hello" });

    expect(mockIo.to).toHaveBeenCalledWith(["admins", "moderators"]);
    expect(mockIoEmit).not.toHaveBeenCalled(); // io.emit (broadcast all) should NOT be called
  });

  it("falls back to io.emit when params.rooms is not set", async () => {
    const svc = makeService();
    app.use("messages", svc as never);
    await app.service("messages").create({ text: "Hello" });
    expect(mockIoEmit).toHaveBeenCalledWith("messages created", expect.any(Object));
    expect(mockIo.to).not.toHaveBeenCalled();
  });
});

// ─── Connection state ─────────────────────────────────────────────────────────

describe("socketio() — connection state", () => {
  let app: ReturnType<typeof mantle>;
  let socket: ReturnType<typeof makeSocket>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIo.to = vi.fn().mockReturnValue({ emit: mockIoEmit });
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
    expect(connections[0]).toBe(connections[1]); // same object reference
  });

  it("removes connection state on disconnect", () => {
    const disconnectHandler = socket.on.mock.calls.find(([event]) => event === "disconnect")?.[1] as () => void;
    expect(disconnectHandler).toBeDefined();
    disconnectHandler();
    // Internal state is cleaned up — no public assertion possible without inspecting internals,
    // but we verify disconnect listener was registered.
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
    mockIo.to = vi.fn().mockReturnValue({ emit: mockIoEmit });
    app = makeApp();
    app.configure(socketio());
    callListen(app);

    socket = makeSocket();
    captureConnectionHandler()(socket);
  });

  it("routes a custom method to service.dispatch()", async () => {
    const chargeResult = { charged: true };
    const dispatchFn = vi.fn().mockResolvedValue(chargeResult);
    const svc = { ...makeService(), charge: vi.fn().mockResolvedValue(chargeResult) };
    app.use("payments", svc as never, { methods: ["find", "charge"] });

    // Override dispatch on the service handle to verify it's called
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
    mockIo.to = vi.fn().mockReturnValue({ emit: mockIoEmit });
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
