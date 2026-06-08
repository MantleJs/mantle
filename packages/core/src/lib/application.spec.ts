import { mantle } from "./mantle.js";
import { NotFound, MethodNotAllowed, BadRequest } from "./errors.js";
import type { HookContext, Service, ServiceParams } from "./types.js";

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
