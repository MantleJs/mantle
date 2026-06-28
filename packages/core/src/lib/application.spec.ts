import { mantle } from "./mantle.js";
import { NotFound, MethodNotAllowed, BadRequest } from "./errors.js";
import type { HookContext, Logger, Service, ServiceParams } from "./types.js";

function makeLogger(): Logger & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = { debug: [], info: [], warn: [], error: [] };
  return {
    calls,
    debug: (msg, ctx) => calls["debug"].push([msg, ctx]),
    info: (msg, ctx) => calls["info"].push([msg, ctx]),
    warn: (msg, ctx) => calls["warn"].push([msg, ctx]),
    error: (msg, ctx) => calls["error"].push([msg, ctx]),
  };
}

interface User {
  id: number;
  name: string;
}

function makeUserService(overrides: Partial<Service<User>> = {}): Service<User> {
  return {
    async find() {
      return [{ id: 1, name: "Alice" }];
    },
    async get(id) {
      return { id: Number(id), name: "Alice" };
    },
    async create(data) {
      return { id: 1, name: data?.name ?? "Unknown" };
    },
    async update(id, data) {
      return { id: Number(id), name: data?.name ?? "Unknown" };
    },
    async patch(id, data) {
      return { id: Number(id), name: data?.name ?? "Alice" };
    },
    async remove(id) {
      return { id: Number(id), name: "Alice" };
    },
    ...overrides,
  };
}

describe("MantleApplication", () => {
  describe("settings", () => {
    it("stores and retrieves values", () => {
      const app = mantle();
      app.set("db", { url: "postgres://localhost" });
      expect(app.get("db")).toEqual({ url: "postgres://localhost" });
    });

    it("returns undefined for unset keys", () => {
      expect(mantle().get("missing")).toBeUndefined();
    });
  });

  describe("configure", () => {
    it("calls the plugin with the app", () => {
      const app = mantle();
      let received: unknown;
      app.configure((a) => {
        received = a;
      });
      expect(received).toBe(app);
    });

    it("is chainable", () => {
      const app = mantle();
      expect(app.configure(() => undefined)).toBe(app);
    });
  });

  describe("use / service", () => {
    it("registers a service and retrieves it by path", () => {
      const app = mantle();
      const svc = makeUserService();
      app.use("users", svc);
      expect(app.service("users")).toBeDefined();
    });

    it("normalises leading slash on use and service", () => {
      const app = mantle();
      app.use("/users", makeUserService());
      expect(app.service("users")).toBeDefined();
      expect(app.service("/users")).toBeDefined();
    });

    it("throws NotFound for unknown service", () => {
      expect(() => mantle().service("unknown")).toThrow(NotFound);
    });

    it("is chainable", () => {
      const app = mantle();
      expect(app.use("users", makeUserService())).toBe(app);
    });
  });

  describe("teardown", () => {
    it("resolves without error", async () => {
      await expect(mantle().teardown()).resolves.toBeUndefined();
    });

    it("logs info on teardown when a logger is configured", async () => {
      const app = mantle();
      const logger = makeLogger();
      app.set("logger", logger);
      await app.teardown();
      expect(logger.calls["info"]).toHaveLength(1);
      expect(logger.calls["info"][0][0]).toContain("teardown");
      expect(logger.calls["info"][0][1]).toMatchObject({ component: "mantle:core" });
    });
  });
});

describe("ServiceHandle — standard methods", () => {
  it("find delegates to service.find", async () => {
    const app = mantle();
    app.use("users", makeUserService());
    const result = await app.service<User>("users").find();
    expect(result).toEqual([{ id: 1, name: "Alice" }]);
  });

  it("get delegates to service.get", async () => {
    const app = mantle();
    app.use("users", makeUserService());
    const result = await app.service<User>("users").get(1);
    expect(result).toEqual({ id: 1, name: "Alice" });
  });

  it("create delegates to service.create", async () => {
    const app = mantle();
    app.use("users", makeUserService());
    const result = await app.service<User>("users").create({ name: "Bob" });
    expect(result).toEqual({ id: 1, name: "Bob" });
  });

  it("update delegates to service.update", async () => {
    const app = mantle();
    app.use("users", makeUserService());
    const result = await app.service<User>("users").update(2, { name: "Carol" });
    expect(result).toEqual({ id: 2, name: "Carol" });
  });

  it("patch delegates to service.patch", async () => {
    const app = mantle();
    app.use("users", makeUserService());
    const result = await app.service<User>("users").patch(3, { name: "Dave" });
    expect(result).toEqual({ id: 3, name: "Dave" });
  });

  it("remove delegates to service.remove", async () => {
    const app = mantle();
    app.use("users", makeUserService());
    const result = await app.service<User>("users").remove(4);
    expect(result).toEqual({ id: 4, name: "Alice" });
  });

  it("throws MethodNotAllowed when service does not implement the method", async () => {
    const app = mantle();
    app.use("users", {});
    await expect(app.service("users").find()).rejects.toThrow(MethodNotAllowed);
  });

  it("throws MethodNotAllowed when method is not in allowed methods list", async () => {
    const app = mantle();
    app.use("users", makeUserService(), { methods: ["find", "get"] });
    await expect(app.service("users").create({ name: "Bob" })).rejects.toThrow(MethodNotAllowed);
  });
});

describe("Hook pipeline — before hooks", () => {
  it("runs before.all hooks before the service method", async () => {
    const order: string[] = [];
    const app = mantle();
    app.use("users", makeUserService());
    app.service<User>("users").hooks({
      before: {
        all: [
          (ctx) => {
            order.push("before.all");
            return ctx;
          },
        ],
        create: [
          (ctx) => {
            order.push("before.create");
            return ctx;
          },
        ],
      },
    });

    await app.service<User>("users").create({ name: "Bob" });
    expect(order).toEqual(["before.all", "before.create"]);
  });

  it("before hook can modify context.data", async () => {
    const app = mantle();
    app.use("users", makeUserService());
    app.service<User>("users").hooks({
      before: {
        create: [
          (ctx) => {
            (ctx.data as Partial<User>).name = "Modified";
            return ctx;
          },
        ],
      },
    });

    const result = await app.service<User>("users").create({ name: "Original" });
    expect(result.name).toBe("Modified");
  });

  it("before hook that sets context.result short-circuits the service call", async () => {
    let serviceCalled = false;
    const app = mantle();
    app.use("users", {
      async find() {
        serviceCalled = true;
        return [];
      },
    });
    app.service<User>("users").hooks({
      before: {
        find: [
          (ctx) => {
            ctx.result = [{ id: 99, name: "Cached" }];
            return ctx;
          },
        ],
      },
    });

    const result = await app.service<User>("users").find();
    expect(serviceCalled).toBe(false);
    expect(result).toEqual([{ id: 99, name: "Cached" }]);
  });
});

describe("Hook pipeline — after hooks", () => {
  it("runs after.all then after.method hooks after the service method", async () => {
    const order: string[] = [];
    const app = mantle();
    app.use("users", makeUserService());
    app.service<User>("users").hooks({
      after: {
        all: [
          (ctx) => {
            order.push("after.all");
            return ctx;
          },
        ],
        find: [
          (ctx) => {
            order.push("after.find");
            return ctx;
          },
        ],
      },
    });

    await app.service<User>("users").find();
    expect(order).toEqual(["after.all", "after.find"]);
  });

  it("after hook can modify context.result", async () => {
    const app = mantle();
    app.use("users", makeUserService());
    app.service<User>("users").hooks({
      after: {
        find: [
          (ctx) => {
            ctx.result = [{ id: 42, name: "Sanitized" }];
            return ctx;
          },
        ],
      },
    });

    const result = await app.service<User>("users").find();
    expect(result).toEqual([{ id: 42, name: "Sanitized" }]);
  });
});

describe("Hook pipeline — error hooks", () => {
  it("routes to error hooks when service throws", async () => {
    let errorCaught: Error | undefined;
    const app = mantle();
    app.use("users", {
      async find(): Promise<User[]> {
        throw new BadRequest("Validation failed");
      },
    });
    app.service<User>("users").hooks({
      error: {
        all: [
          (ctx) => {
            errorCaught = ctx.error;
            return ctx;
          },
        ],
      },
    });

    await expect(app.service<User>("users").find()).rejects.toThrow(BadRequest);
    expect(errorCaught).toBeInstanceOf(BadRequest);
  });

  it("error hook can recover by clearing ctx.error and setting ctx.result", async () => {
    const app = mantle();
    app.use("users", {
      async find(): Promise<User[]> {
        throw new BadRequest("Nope");
      },
    });
    app.service<User>("users").hooks({
      error: {
        find: [
          (ctx: HookContext<User>) => {
            ctx.error = undefined;
            ctx.result = [{ id: 0, name: "Fallback" }];
            return ctx;
          },
        ],
      },
    });

    const result = await app.service<User>("users").find();
    expect(result).toEqual([{ id: 0, name: "Fallback" }]);
  });

  it("params.provider is set correctly by transport", async () => {
    const app = mantle();
    let capturedProvider: string | undefined;
    app.use("users", makeUserService());
    app.service<User>("users").hooks({
      before: {
        all: [
          (ctx) => {
            capturedProvider = ctx.params.provider;
            return ctx;
          },
        ],
      },
    });

    const params: ServiceParams = { provider: "rest" };
    await app.service<User>("users").find(params);
    expect(capturedProvider).toBe("rest");
  });
});

describe("Logger", () => {
  it("logs debug when a service is registered", () => {
    const app = mantle();
    const logger = makeLogger();
    app.set("logger", logger);
    app.use("users", makeUserService());
    expect(logger.calls["debug"]).toHaveLength(1);
    expect(logger.calls["debug"][0][0]).toContain("registered");
    expect(logger.calls["debug"][0][1]).toMatchObject({ component: "mantle:core", path: "users" });
  });

  it("strips leading slash from path in log record", () => {
    const app = mantle();
    const logger = makeLogger();
    app.set("logger", logger);
    app.use("/users", makeUserService());
    expect(logger.calls["debug"][0][1]).toMatchObject({ path: "users" });
  });

  it("does not throw when no logger is configured", () => {
    const app = mantle();
    expect(() => app.use("users", makeUserService())).not.toThrow();
  });
});

describe("ServiceOptions — schema", () => {
  it("stores and exposes schema on the service handle", () => {
    const app = mantle();
    const schema = { type: "object", properties: { name: { type: "string" } } };
    app.use("users", makeUserService(), { schema });
    expect(app.service("users").schema).toBe(schema);
  });

  it("schema is undefined when not provided", () => {
    const app = mantle();
    app.use("users", makeUserService());
    expect(app.service("users").schema).toBeUndefined();
  });
});

describe("ServiceHandle — methods", () => {
  it("exposes the default six methods", () => {
    const app = mantle();
    app.use("users", makeUserService());
    expect(app.service("users").methods).toEqual(["find", "get", "create", "update", "patch", "remove"]);
  });

  it("exposes custom methods when provided", () => {
    const app = mantle();
    app.use("users", makeUserService(), { methods: ["find", "charge"] });
    expect(app.service("users").methods).toEqual(["find", "charge"]);
  });
});

describe("MantleApplication — event bus", () => {
  it("on/emit allows plugins to subscribe and receive events", () => {
    const app = mantle();
    const received: unknown[] = [];
    app.on("my:event", (a, b) => received.push(a, b));
    app.emit("my:event", "hello", 42);
    expect(received).toEqual(["hello", 42]);
  });

  it("off removes a listener", () => {
    const app = mantle();
    const received: unknown[] = [];
    const listener = (v: unknown) => received.push(v);
    app.on("test", listener);
    app.emit("test", 1);
    app.off("test", listener);
    app.emit("test", 2);
    expect(received).toEqual([1]);
  });

  it("on returns the app for chaining", () => {
    const app = mantle();
    expect(app.on("x", () => undefined)).toBe(app);
  });
});

describe("MantleApplication — channels", () => {
  it("channel() throws GeneralError when socketio is not configured", () => {
    const app = mantle();
    expect(() => app.channel("test")).toThrow("Channels are not configured");
  });

  it("publish() stores the global publisher", () => {
    const app = mantle();
    const publisher = () => undefined;
    app.publish(publisher);
    expect(app.get("__globalPublisher")).toBe(publisher);
  });

  it("publish() is chainable", () => {
    const app = mantle();
    expect(app.publish(() => undefined)).toBe(app);
  });
});

describe("ServiceHandle — channels", () => {
  it("publisher is undefined by default", () => {
    const app = mantle();
    app.use("users", makeUserService());
    expect(app.service("users").publisher).toBeUndefined();
  });

  it("publish() stores the publisher on the service handle", () => {
    const app = mantle();
    app.use("users", makeUserService());
    const publisher = () => undefined;
    app.service("users").publish(publisher);
    expect(app.service("users").publisher).toBe(publisher);
  });

  it("publish() is chainable", () => {
    const app = mantle();
    app.use("users", makeUserService());
    const handle = app.service("users");
    expect(handle.publish(() => undefined)).toBe(handle);
  });
});

describe("Service events", () => {
  it("emits 'service:event' on the app after create", async () => {
    const app = mantle();
    app.use("users", makeUserService());
    const events: unknown[] = [];
    app.on("service:event", (...args) => events.push(args));
    await app.service<User>("users").create({ name: "Alice" });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual([
      "users",
      "created",
      expect.objectContaining({ name: "Alice" }),
      expect.any(Object),
    ]);
  });

  it("emits 'service:event' after update, patch, remove", async () => {
    const app = mantle();
    app.use("users", makeUserService());
    const eventNames: string[] = [];
    app.on("service:event", (_path, event) => eventNames.push(event as string));
    await app.service<User>("users").update(1, { name: "Bob" });
    await app.service<User>("users").patch(1, { name: "Carol" });
    await app.service<User>("users").remove(1);
    expect(eventNames).toEqual(["updated", "patched", "removed"]);
  });

  it("does NOT emit 'service:event' for find or get", async () => {
    const app = mantle();
    app.use("users", makeUserService());
    const events: unknown[] = [];
    app.on("service:event", (...args) => events.push(args));
    await app.service<User>("users").find();
    await app.service<User>("users").get(1);
    expect(events).toHaveLength(0);
  });

  it("does NOT emit 'service:event' when the service method throws", async () => {
    const app = mantle();
    app.use("users", {
      async create(): Promise<User> {
        throw new BadRequest("fail");
      },
    });
    const events: unknown[] = [];
    app.on("service:event", (...args) => events.push(args));
    await expect(app.service<User>("users").create({})).rejects.toThrow();
    expect(events).toHaveLength(0);
  });

  it("includes params in the 'service:event' payload", async () => {
    const app = mantle();
    app.use("users", makeUserService());
    let capturedParams: ServiceParams | undefined;
    app.on("service:event", (_path, _event, _result, params) => {
      capturedParams = params as ServiceParams;
    });
    await app.service<User>("users").create({ name: "Alice" }, { provider: "rest", rooms: ["admins"] });
    expect(capturedParams?.provider).toBe("rest");
    expect(capturedParams?.rooms).toEqual(["admins"]);
  });
});
