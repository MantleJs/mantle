import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Application } from "express";
import { mantle, getContext, RepositoryService, VectorRepositoryService } from "@mantlejs/mantle";
import { BadRequest, NotFound } from "@mantlejs/mantle";
import type { HookContext, Id, Paginated, QueryParams, Repository, ServiceParams, VectorRepository } from "@mantlejs/mantle";
import { express } from "./express.js";

async function startServer(expressApp: Application): Promise<{ port: number; stop: () => Promise<void> }> {
  const server = createServer(expressApp as Parameters<typeof createServer>[0]);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    stop: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

interface User {
  id: string;
  name: string;
  email: string;
}

class TestUserService {
  async find(_params?: ServiceParams): Promise<User[]> {
    return [{ id: "1", name: "Alice", email: "alice@example.com" }];
  }

  async get(id: string | number, _params?: ServiceParams): Promise<User> {
    return { id: String(id), name: "Alice", email: "alice@example.com" };
  }

  async create(data: Partial<User>, _params?: ServiceParams): Promise<User> {
    return { id: "99", name: data.name ?? "", email: data.email ?? "" };
  }

  async update(id: string | number, data: Partial<User>, _params?: ServiceParams): Promise<User> {
    return { id: String(id), name: data.name ?? "", email: data.email ?? "" };
  }

  async patch(id: string | number, data: Partial<User>, _params?: ServiceParams): Promise<User> {
    return { id: String(id), name: data.name ?? "Alice", email: data.email ?? "alice@example.com" };
  }

  async remove(id: string | number, _params?: ServiceParams): Promise<User> {
    return { id: String(id), name: "Alice", email: "alice@example.com" };
  }
}

describe("express adapter", () => {
  describe("plugin setup", () => {
    it("stores an express application on app.get('express')", () => {
      const app = mantle().configure(express());
      expect(app.get("express")).toBeDefined();
    });

    it("registers the transport-neutral 'http:router' (the express app itself)", () => {
      const app = mantle().configure(express());
      expect(app.get("http:router")).toBe(app.get("express"));
    });

    it("sets and emits 'http:server' when listen() is called", async () => {
      const app = mantle().configure(express());
      const emitted: unknown[] = [];
      app.on("http:server", (server) => emitted.push(server));
      const server = (app as unknown as { listen: (port: number) => Server }).listen(0);
      await new Promise<void>((resolve) => server.once("listening", resolve));
      try {
        expect(app.get("http:server")).toBe(server);
        expect(emitted).toEqual([server]);
      } finally {
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      }
    });
  });

  describe("standard REST routes", () => {
    let port: number;
    let stop: () => Promise<void>;

    beforeEach(async () => {
      const app = mantle().configure(express());
      app.use("users", new TestUserService());
      const expressApp = app.get<Application>("express");
      const server = await startServer(expressApp);
      port = server.port;
      stop = server.stop;
    });

    afterEach(async () => {
      await stop();
    });

    it("find — GET /users returns 200 with array", async () => {
      const res = await fetch(`http://localhost:${port}/users`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as User[];
      expect(Array.isArray(body)).toBe(true);
      expect(body[0]).toMatchObject({ id: "1", name: "Alice" });
    });

    it("get — GET /users/:id returns 200 with single resource", async () => {
      const res = await fetch(`http://localhost:${port}/users/42`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as User;
      expect(body.id).toBe("42");
    });

    it("create — POST /users returns 201 with created resource", async () => {
      const res = await fetch(`http://localhost:${port}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bob", email: "bob@example.com" }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as User;
      expect(body.name).toBe("Bob");
    });

    it("update — PUT /users/:id returns 200", async () => {
      const res = await fetch(`http://localhost:${port}/users/42`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated", email: "updated@example.com" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as User;
      expect(body.id).toBe("42");
      expect(body.name).toBe("Updated");
    });

    it("patch — PATCH /users/:id returns 200", async () => {
      const res = await fetch(`http://localhost:${port}/users/42`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Patched" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as User;
      expect(body.id).toBe("42");
    });

    it("remove — DELETE /users/:id returns 200 with removed resource", async () => {
      const res = await fetch(`http://localhost:${port}/users/42`, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as User;
      expect(body.id).toBe("42");
    });
  });

  describe("correlation ID", () => {
    it("sets x-correlation-id response header on every request", async () => {
      const app = mantle().configure(express());
      app.use("users", new TestUserService());
      const expressApp = app.get<Application>("express");
      const { port, stop } = await startServer(expressApp);
      try {
        const res = await fetch(`http://localhost:${port}/users`);
        expect(res.headers.get("x-correlation-id")).toBeTruthy();
      } finally {
        await stop();
      }
    });

    it("echoes a client-supplied x-correlation-id header", async () => {
      const app = mantle().configure(express());
      app.use("users", new TestUserService());
      const expressApp = app.get<Application>("express");
      const { port, stop } = await startServer(expressApp);
      try {
        const res = await fetch(`http://localhost:${port}/users`, {
          headers: { "x-correlation-id": "my-trace-id" },
        });
        expect(res.headers.get("x-correlation-id")).toBe("my-trace-id");
      } finally {
        await stop();
      }
    });

    it("makes the correlationId available via getContext() inside hooks", async () => {
      let capturedCorrelationId: string | undefined;

      const app = mantle().configure(express());
      app.use("users", new TestUserService());
      app.service("users").hooks({
        before: {
          find: [
            (ctx) => {
              capturedCorrelationId = getContext()?.correlationId;
              return ctx;
            },
          ],
        },
      });

      const expressApp = app.get<Application>("express");
      const { port, stop } = await startServer(expressApp);
      try {
        await fetch(`http://localhost:${port}/users`, {
          headers: { "x-correlation-id": "hook-trace-id" },
        });
        expect(capturedCorrelationId).toBe("hook-trace-id");
      } finally {
        await stop();
      }
    });
  });

  describe("params population", () => {
    it("sets params.provider to 'rest' for HTTP requests", async () => {
      let capturedProvider: string | undefined;

      const app = mantle().configure(express());
      app.use("users", new TestUserService());
      app.service("users").hooks({
        before: {
          find: [
            (ctx) => {
              capturedProvider = ctx.params.provider;
              return ctx;
            },
          ],
        },
      });

      const expressApp = app.get<Application>("express");
      const { port, stop } = await startServer(expressApp);
      try {
        await fetch(`http://localhost:${port}/users`);
        expect(capturedProvider).toBe("rest");
      } finally {
        await stop();
      }
    });

    it("populates params.query from the request query string", async () => {
      let capturedQuery: Record<string, unknown> | undefined;

      const app = mantle().configure(express());
      app.use("users", new TestUserService());
      app.service("users").hooks({
        before: {
          find: [
            (ctx) => {
              capturedQuery = ctx.params.query;
              return ctx;
            },
          ],
        },
      });

      const expressApp = app.get<Application>("express");
      const { port, stop } = await startServer(expressApp);
      try {
        await fetch(`http://localhost:${port}/users?page=2&limit=10`);
        expect(capturedQuery).toMatchObject({ page: "2", limit: "10" });
      } finally {
        await stop();
      }
    });

    // Canonical cross-transport fixture (A-6): express, koa, and http must produce
    // the identical nested params.query for this query string.
    it("parses operator bracket notation into the canonical nested query", async () => {
      let capturedQuery: Record<string, unknown> | undefined;

      const app = mantle().configure(express());
      app.use("users", new TestUserService());
      app.service("users").hooks({
        before: {
          find: [
            (ctx) => {
              capturedQuery = ctx.params.query;
              return ctx;
            },
          ],
        },
      });

      const expressApp = app.get<Application>("express");
      const { port, stop } = await startServer(expressApp);
      try {
        await fetch(`http://localhost:${port}/users?age[$gt]=21&$or[0][role]=admin&$or[1][role]=editor&tags[]=a&tags[]=b`);
        expect(capturedQuery).toEqual({
          age: { $gt: "21" },
          $or: [{ role: "admin" }, { role: "editor" }],
          tags: ["a", "b"],
        });
      } finally {
        await stop();
      }
    });
  });

  describe("error handling", () => {
    it("serialises NotFound (404) from a service to a 404 HTTP response with correct JSON", async () => {
      class NotFoundService {
        async find(_params?: ServiceParams): Promise<User[]> {
          throw new NotFound("User not found");
        }
      }

      const app = mantle().configure(express());
      app.use("items", new NotFoundService());

      const expressApp = app.get<Application>("express");
      expressApp.use(
        (
          _err: unknown,
          _req: unknown,
          res: { status: (n: number) => { json: (b: unknown) => void } },
          _next: unknown,
        ) => {
          if (_err instanceof NotFound) {
            res.status((_err as NotFound).code).json((_err as NotFound).toJSON());
          }
        },
      );

      const { port, stop } = await startServer(expressApp);
      try {
        const res = await fetch(`http://localhost:${port}/items`);
        expect(res.status).toBe(404);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body["code"]).toBe(404);
        expect(body["className"]).toBe("not-found");
      } finally {
        await stop();
      }
    });

    it("serializes BadRequest (400) to a 400 HTTP response", async () => {
      class BadService {
        async find(_params?: ServiceParams): Promise<User[]> {
          throw new BadRequest("Invalid input");
        }
      }

      const app = mantle().configure(express());
      app.use("items", new BadService());

      const expressApp = app.get<Application>("express");
      const { port, stop } = await startServer(expressApp);
      try {
        const res = await fetch(`http://localhost:${port}/items`);
        expect(res.status).toBe(400);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body["code"]).toBe(400);
        expect(body["className"]).toBe("bad-request");
      } finally {
        await stop();
      }
    });

    it("maps an unknown error to 500", async () => {
      class BrokenService {
        async find(_params?: ServiceParams): Promise<User[]> {
          throw new Error("Something broke");
        }
      }

      const app = mantle().configure(express());
      app.use("items", new BrokenService());

      const expressApp = app.get<Application>("express");
      const { port, stop } = await startServer(expressApp);
      try {
        const res = await fetch(`http://localhost:${port}/items`);
        expect(res.status).toBe(500);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body["code"]).toBe(500);
      } finally {
        await stop();
      }
    });
  });

  describe("method restriction", () => {
    it("returns 404 when a non-registered method route is not mounted", async () => {
      const app = mantle().configure(express());
      app.use("users", new TestUserService(), { methods: ["find"] });

      const expressApp = app.get<Application>("express");
      const { port, stop } = await startServer(expressApp);
      try {
        const res = await fetch(`http://localhost:${port}/users`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Bob" }),
        });
        // Express v5 returns 404 when no route matches (POST /users not mounted)
        expect(res.status).toBe(404);
      } finally {
        await stop();
      }
    });
  });

  describe("custom methods", () => {
    it("dispatches POST /path/methodName and runs hooks", async () => {
      let hookRan = false;

      class EmailService {
        async find(_params?: ServiceParams): Promise<User[]> {
          return [];
        }

        async verifyEmail(data: unknown, _params?: ServiceParams): Promise<{ verified: boolean; data: unknown }> {
          return { verified: true, data };
        }
      }

      const app = mantle().configure(express());
      app.use("emails", new EmailService(), { methods: ["find", "verifyEmail"] });
      const emailsService: any = app.service("emails");
      emailsService.hooks({
        before: {
          verifyEmail: [
            (ctx: any) => {
              hookRan = true;
              return ctx;
            },
          ],
        },
      });

      const expressApp = app.get<Application>("express");
      const { port, stop } = await startServer(expressApp);
      try {
        const res = await fetch(`http://localhost:${port}/emails/verifyEmail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: "abc123" }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { verified: boolean };
        expect(body.verified).toBe(true);
        expect(hookRan).toBe(true);
      } finally {
        await stop();
      }
    });
  });

  // B-2 acceptance: full HTTP round-trip through a RepositoryService — the raw
  // query string comes back as a Paginated envelope with coerced, filtered,
  // sorted results.
  describe("RepositoryService round-trip", () => {
    interface Person extends Record<string, unknown> {
      id: string;
      name: string;
      age: number;
    }

    class ArrayRepository implements Repository<Person> {
      constructor(private rows: Person[]) {}

      async findAll(params?: QueryParams): Promise<Person[]> {
        let rows = this.rows.filter((r) => {
          const ageFilter = params?.where?.["age"] as { $gt?: number } | undefined;
          return ageFilter?.$gt === undefined || r.age > ageFilter.$gt;
        });
        for (const [field, dir] of Object.entries(params?.sort ?? {})) {
          rows = [...rows].sort((a, b) => {
            const cmp = a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0;
            return dir === "asc" ? cmp : -cmp;
          });
        }
        const skip = params?.skip ?? 0;
        const limit = params?.limit ?? rows.length;
        return rows.slice(skip, skip + limit);
      }

      async count(params?: QueryParams): Promise<number> {
        return (await this.findAll(params)).length;
      }

      async findById(id: Id): Promise<Person | null> {
        return this.rows.find((r) => r.id === id) ?? null;
      }

      async save(data: Partial<Person>): Promise<Person> {
        return data as Person;
      }

      async saveAll(data: Partial<Person>[]): Promise<Person[]> {
        return data as Person[];
      }

      async updateById(id: Id, data: Partial<Person>): Promise<Person> {
        return { id: String(id), ...data } as Person;
      }

      async patchById(id: Id, data: Partial<Person>): Promise<Person> {
        return { id: String(id), ...data } as Person;
      }

      async deleteById(id: Id): Promise<Person> {
        return { id: String(id) } as Person;
      }
    }

    it("?age[$gt]=21&$limit=10&$sort[name]=asc returns a coerced Paginated envelope", async () => {
      const repo = new ArrayRepository([
        { id: "1", name: "Carol", age: 35 },
        { id: "2", name: "Alice", age: 30 },
        { id: "3", name: "Dave", age: 19 },
        { id: "4", name: "Bob", age: 25 },
      ]);
      const schema = { properties: { name: { type: "string" }, age: { type: "number" } } };

      const app = mantle().configure(express());
      app.use("people", new RepositoryService<Person>(repo, { schema }));

      const expressApp = app.get<Application>("express");
      const { port, stop } = await startServer(expressApp);
      try {
        const res = await fetch(`http://localhost:${port}/people?age[$gt]=21&$limit=10&$sort[name]=asc`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as Paginated<Person>;
        expect(body).toMatchObject({ total: 3, limit: 10, skip: 0 });
        expect(body.data.map((p) => p.name)).toEqual(["Alice", "Bob", "Carol"]);
      } finally {
        await stop();
      }
    });
  });

  // D-4 acceptance: the `similar` custom-method convention — a VectorRepositoryService
  // over a stubbed vector repository, reached via POST /<path>/similar through the full
  // hook pipeline, returning _score-bearing results.
  describe("VectorRepositoryService similar() round-trip", () => {
    interface Doc extends Record<string, unknown> {
      id: string;
      title: string;
    }

    function makeVectorRepo(): VectorRepository<Doc> {
      const notInSpec = () => Promise.reject(new Error("not exercised in this spec"));
      return {
        findSimilar: async (vector: number[], topK: number) =>
          [{ id: "1", title: `top-${topK} for [${vector.join(",")}]`, _score: 0.91 }],
        upsertVector: notInSpec,
        deleteVector: notInSpec,
        findAll: async () => [],
        findById: async () => null,
        save: notInSpec,
        saveAll: notInSpec,
        updateById: notInSpec,
        patchById: notInSpec,
        deleteById: notInSpec,
        count: async () => 0,
      };
    }

    it("POST /docs/similar returns _score-bearing results through the hook pipeline", async () => {
      const app = mantle().configure(express());
      app.use("docs", new VectorRepositoryService<Doc>(makeVectorRepo()), {
        methods: ["find", "get", "similar"],
      });

      let hookSawMethod: string | undefined;
      app.service("docs").hooks({
        before: {
          all: [
            (ctx: HookContext<Doc>) => {
              hookSawMethod = ctx.method;
              return ctx;
            },
          ],
        },
      });

      const { port, stop } = await startServer(app.get<Application>("express"));
      try {
        const res = await fetch(`http://localhost:${port}/docs/similar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vector: [0.1, 0.2, 0.3], topK: 5 }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as Array<Doc & { _score: number }>;
        expect(body).toEqual([{ id: "1", title: "top-5 for [0.1,0.2,0.3]", _score: 0.91 }]);
        expect(hookSawMethod).toBe("similar");
      } finally {
        await stop();
      }
    });

    it("POST /docs/similar with a malformed body returns the typed 400", async () => {
      const app = mantle().configure(express());
      app.use("docs", new VectorRepositoryService<Doc>(makeVectorRepo()), {
        methods: ["find", "similar"],
      });

      const { port, stop } = await startServer(app.get<Application>("express"));
      try {
        const res = await fetch(`http://localhost:${port}/docs/similar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vector: "not-an-array" }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as { className: string; hint?: string };
        expect(body.className).toBe("bad-request");
        expect(body.hint).toBeDefined();
      } finally {
        await stop();
      }
    });
  });
});

describe("introspection endpoint", () => {
  it("GET /_services returns 404 by default", async () => {
    const app = mantle().configure(express());
    app.use("users", new TestUserService());
    const { port, stop } = await startServer(app.get<Application>("express"));
    try {
      const res = await fetch(`http://localhost:${port}/_services`);
      expect(res.status).toBe(404);
    } finally {
      await stop();
    }
  });

  it("GET /_services serves ServiceDescriptor JSON when enabled", async () => {
    const app = mantle().configure(express(undefined, { introspection: true }));
    app.use("users", new TestUserService(), { methods: ["find", "get", "create"] });
    const { port, stop } = await startServer(app.get<Application>("express"));
    try {
      const res = await fetch(`http://localhost:${port}/_services`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ path: string; methods: string[]; events: string[] }>;
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        path: "users",
        methods: ["find", "get", "create"],
        events: ["created"],
        authRequired: false,
      });
    } finally {
      await stop();
    }
  });

  it("honors a custom introspection path", async () => {
    const app = mantle().configure(express(undefined, { introspection: { path: "/__meta" } }));
    app.use("users", new TestUserService());
    const { port, stop } = await startServer(app.get<Application>("express"));
    try {
      expect((await fetch(`http://localhost:${port}/_services`)).status).toBe(404);
      const res = await fetch(`http://localhost:${port}/__meta`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as Array<{ path: string }>)[0].path).toBe("users");
    } finally {
      await stop();
    }
  });
});

describe("POST /batch", () => {
  async function startWith(options?: Parameters<typeof express>[1]): Promise<{
    app: ReturnType<typeof mantle>;
    port: number;
    stop: () => Promise<void>;
  }> {
    const app = mantle().configure(express(undefined, options));
    app.use("users", new TestUserService());
    const { port, stop } = await startServer(app.get<Application>("express"));
    return { app, port, stop };
  }

  function postBatch(port: number, calls: unknown, path = "/batch", headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`http://localhost:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(calls),
    });
  }

  it("dispatches calls concurrently and returns BatchResults in input order", async () => {
    const { port, stop } = await startWith();
    try {
      const res = await postBatch(port, [
        { service: "users", method: "get", id: "7" },
        { service: "users", method: "create", data: { name: "Bob", email: "bob@example.com" } },
      ]);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([
        { status: "success", result: { id: "7", name: "Alice", email: "alice@example.com" } },
        { status: "success", result: { id: "99", name: "Bob", email: "bob@example.com" } },
      ]);
    } finally {
      await stop();
    }
  });

  it("reports a per-call error entry without failing sibling calls", async () => {
    const { port, stop } = await startWith();
    try {
      const res = await postBatch(port, [
        { service: "ghosts", method: "find" },
        { service: "users", method: "find" },
      ]);
      expect(res.status).toBe(200);
      const [missing, ok] = (await res.json()) as Array<{ status: string; error?: { name: string; code: number } }>;
      expect(missing.status).toBe("error");
      expect(missing.error).toMatchObject({ name: "NotFound", code: 404 });
      expect(ok.status).toBe("success");
    } finally {
      await stop();
    }
  });

  it("runs each call through the hook pipeline with the request's headers", async () => {
    const { app, port, stop } = await startWith();
    try {
      app.service("users").hooks({
        before: {
          all: [
            async (ctx) => {
              if (ctx.params.headers?.["x-api-key"] !== "secret") throw new BadRequest("Missing API key");
              return ctx;
            },
          ],
        },
      });
      const calls = [{ service: "users", method: "find" }];
      const denied = (await (await postBatch(port, calls)).json()) as Array<{ status: string }>;
      expect(denied[0].status).toBe("error");
      const allowed = (await (await postBatch(port, calls, "/batch", { "x-api-key": "secret" })).json()) as Array<{
        status: string;
      }>;
      expect(allowed[0].status).toBe("success");
    } finally {
      await stop();
    }
  });

  it("rejects a batch over the max size with 400 BadRequest", async () => {
    const { port, stop } = await startWith();
    try {
      const res = await postBatch(
        port,
        Array.from({ length: 26 }, () => ({ service: "users", method: "find" })),
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { name: string }).name).toBe("BadRequest");
    } finally {
      await stop();
    }
  });

  it("is disabled with batch: false", async () => {
    const { port, stop } = await startWith({ batch: false });
    try {
      const res = await postBatch(port, [{ service: "users", method: "find" }]);
      expect(res.status).toBe(404);
    } finally {
      await stop();
    }
  });

  it("honors a custom path and maxSize", async () => {
    const { port, stop } = await startWith({ batch: { path: "/_batch", maxSize: 1 } });
    try {
      expect((await postBatch(port, [{ service: "users", method: "find" }])).status).toBe(404);
      expect((await postBatch(port, [{ service: "users", method: "find" }], "/_batch")).status).toBe(200);
      const oversized = await postBatch(
        port,
        [
          { service: "users", method: "find" },
          { service: "users", method: "find" },
        ],
        "/_batch",
      );
      expect(oversized.status).toBe(400);
    } finally {
      await stop();
    }
  });
});

describe("CORS", () => {
  async function startWith(options?: Parameters<typeof express>[1]): Promise<{ port: number; stop: () => Promise<void> }> {
    const app = mantle().configure(express(undefined, options));
    app.use("users", new TestUserService());
    return startServer(app.get<Application>("express"));
  }

  it("sends no CORS headers by default", async () => {
    const { port, stop } = await startWith();
    try {
      const res = await fetch(`http://localhost:${port}/users`, { headers: { Origin: "https://app.example.com" } });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      await stop();
    }
  });

  it("reflects Origin and omits credentials with cors: true", async () => {
    const { port, stop } = await startWith({ cors: true });
    try {
      const res = await fetch(`http://localhost:${port}/users`, { headers: { Origin: "https://app.example.com" } });
      expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    } finally {
      await stop();
    }
  });

  it("answers an OPTIONS preflight with the default methods and reflected headers, without dispatching", async () => {
    const { port, stop } = await startWith({ cors: true });
    try {
      const res = await fetch(`http://localhost:${port}/users`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-methods")).toBe("GET,POST,PUT,PATCH,DELETE");
      expect(res.headers.get("access-control-allow-headers")).toBe("content-type");
    } finally {
      await stop();
    }
  });

  it("only allows origins present in an allow-list", async () => {
    const { port, stop } = await startWith({ cors: { origin: ["https://allowed.example.com"] } });
    try {
      const allowed = await fetch(`http://localhost:${port}/users`, {
        headers: { Origin: "https://allowed.example.com" },
      });
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://allowed.example.com");

      const denied = await fetch(`http://localhost:${port}/users`, {
        headers: { Origin: "https://evil.example.com" },
      });
      expect(denied.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      await stop();
    }
  });

  it("sets Access-Control-Allow-Credentials when credentials: true", async () => {
    const { port, stop } = await startWith({ cors: { credentials: true } });
    try {
      const res = await fetch(`http://localhost:${port}/users`, { headers: { Origin: "https://app.example.com" } });
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    } finally {
      await stop();
    }
  });
});
