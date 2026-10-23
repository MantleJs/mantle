import type { AddressInfo } from "node:net";
import {
  checkTransportConformance,
  CORS_DEFAULT_EXPOSED_HEADERS,
  getContext,
  mantle,
  registerTransportConformanceServices,
  TRANSPORT_CONFORMANCE_CASES,
} from "@mantlejs/mantle";
import type { TransportConformanceCase } from "@mantlejs/mantle";
import { BadRequest, NotFound } from "@mantlejs/mantle";
import type { HttpRouterLike, ServiceParams } from "@mantlejs/mantle";
import { http } from "./http.js";

function conformanceRequest(base: string, testCase: TransportConformanceCase): Request {
  const { method, path, headers, body } = testCase.request;
  return new Request(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function startApp(
  configure: (app: ReturnType<typeof mantle>) => void,
  options?: Parameters<typeof http>[0],
): Promise<{
  port: number;
  stop: () => Promise<void>;
}> {
  const app = mantle().configure(http(options));
  configure(app);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
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

describe("http adapter", () => {
  describe("plugin setup", () => {
    it("returns a MantlePlugin function", () => {
      expect(typeof http()).toBe("function");
    });

    it("stores httpHandler on the app", () => {
      const app = mantle().configure(http());
      expect(typeof app.get("httpHandler")).toBe("function");
    });

    it("stores fetchHandler on the app", () => {
      const app = mantle().configure(http());
      expect(typeof app.get("fetchHandler")).toBe("function");
    });

    it("registers the transport-neutral 'http:router'", () => {
      const app = mantle().configure(http());
      const router = app.get<HttpRouterLike>("http:router");
      expect(typeof router.get).toBe("function");
      expect(typeof router.post).toBe("function");
    });
  });

  describe("http:router raw routes", () => {
    it("serves an express-style handler mounted via 'http:router'", async () => {
      const { port, stop } = await startApp((app) => {
        const router = app.get<HttpRouterLike>("http:router");
        router.get("/raw", (req, res) => {
          res.json({ q: req.query["x"], proto: req.protocol });
        });
      });
      try {
        const res = await fetch(`http://localhost:${port}/raw?x=1`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ q: "1", proto: "http" });
      } finally {
        await stop();
      }
    });

    it("redirects via res.redirect from a raw handler", async () => {
      const { port, stop } = await startApp((app) => {
        const router = app.get<HttpRouterLike>("http:router");
        router.get("/go", (_req, res) => {
          res.redirect("https://example.com/target");
        });
      });
      try {
        const res = await fetch(`http://localhost:${port}/go`, { redirect: "manual" });
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("https://example.com/target");
      } finally {
        await stop();
      }
    });

    it("routes handler errors through next(err) to the error response", async () => {
      const { port, stop } = await startApp((app) => {
        const router = app.get<HttpRouterLike>("http:router");
        router.get("/boom", (_req, _res, next) => {
          next(new BadRequest("nope"));
        });
      });
      try {
        const res = await fetch(`http://localhost:${port}/boom`);
        expect(res.status).toBe(400);
      } finally {
        await stop();
      }
    });

    it("parses application/x-www-form-urlencoded bodies into req.body for POST routes", async () => {
      const { port, stop } = await startApp((app) => {
        const router = app.get<HttpRouterLike>("http:router");
        router.post("/form", (req, res) => {
          res.json(req.body);
        });
      });
      try {
        const res = await fetch(`http://localhost:${port}/form`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ code: "abc", state: "xyz" }).toString(),
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ code: "abc", state: "xyz" });
      } finally {
        await stop();
      }
    });
  });

  describe("standard REST routes via httpHandler (Node.js)", () => {
    let port: number;
    let stop: () => Promise<void>;

    beforeEach(async () => {
      ({ port, stop } = await startApp((app) => {
        app.use("users", new TestUserService());
      }));
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

    it("unknown route returns 404", async () => {
      const res = await fetch(`http://localhost:${port}/no-such-path`);
      expect(res.status).toBe(404);
    });
  });

  describe("fetchHandler (Fetch API)", () => {
    it("handles find via fetchHandler directly", async () => {
      const app = mantle().configure(http());
      app.use("users", new TestUserService());
      const fetchHandler = app.get("fetchHandler") as (req: Request) => Promise<Response>;
      const res = await fetchHandler(new Request("http://localhost/users"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as User[];
      expect(Array.isArray(body)).toBe(true);
    });

    it("handles create via fetchHandler", async () => {
      const app = mantle().configure(http());
      app.use("users", new TestUserService());
      const fetchHandler = app.get("fetchHandler") as (req: Request) => Promise<Response>;
      const res = await fetchHandler(
        new Request("http://localhost/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Carol", email: "carol@example.com" }),
        }),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as User;
      expect(body.name).toBe("Carol");
    });

    it("parses application/x-www-form-urlencoded bodies via fetchHandler", async () => {
      const app = mantle().configure(http());
      const router = app.get<HttpRouterLike>("http:router");
      router.post("/form", (req, res) => {
        res.json(req.body);
      });
      const fetchHandler = app.get("fetchHandler") as (req: Request) => Promise<Response>;
      const res = await fetchHandler(
        new Request("http://localhost/form", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ code: "abc", state: "xyz" }).toString(),
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ code: "abc", state: "xyz" });
    });

    // The Fetch API has no socket peer, so cases expecting the peer address don't apply here.
    const fetchCases = TRANSPORT_CONFORMANCE_CASES.filter(
      (c) => c.expect.body === "empty" || c.expect.body?.["ip"] !== "127.0.0.1",
    );

    it.each(fetchCases.map((c) => [c.name, c] as const))("conformance: %s", async (_name, testCase) => {
      const app = mantle().configure(http({ trustProxy: testCase.trustProxy, errors: testCase.errors }));
      registerTransportConformanceServices(app);
      const fetchHandler = app.get("fetchHandler") as (req: Request) => Promise<Response>;
      const res = await fetchHandler(conformanceRequest("http://localhost", testCase));
      const failures = checkTransportConformance(testCase, {
        status: res.status,
        headers: res.headers,
        body: await res.text(),
      });
      expect(failures).toEqual([]);
    });

    it("leaves params.ip undefined without trustProxy (no socket peer)", async () => {
      const app = mantle().configure(http());
      registerTransportConformanceServices(app);
      const fetchHandler = app.get("fetchHandler") as (req: Request) => Promise<Response>;
      const res = await fetchHandler(
        new Request("http://localhost/conformance-echo/1", { headers: { "X-Forwarded-For": "203.0.113.7" } }),
      );
      expect(((await res.json()) as { ip?: string }).ip).toBeUndefined();
    });

    it('answers an unknown route with Problem Details under errors: "problem+json"', async () => {
      const app = mantle().configure(http({ errors: "problem+json" }));
      const fetchHandler = app.get("fetchHandler") as (req: Request) => Promise<Response>;
      const res = await fetchHandler(new Request("http://localhost/nope?x=1"));
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toBe("application/problem+json");
      expect(await res.json()).toMatchObject({
        type: "https://mantlejs.com/errors/not-found",
        title: "Not Found",
        status: 404,
        instance: "/nope",
      });
    });

    it("puts the request ID on a 404 for an unknown route", async () => {
      const app = mantle().configure(http());
      const fetchHandler = app.get("fetchHandler") as (req: Request) => Promise<Response>;
      const res = await fetchHandler(new Request("http://localhost/nope", { headers: { "X-Request-Id": "r-404" } }));
      expect(res.headers.get("x-request-id")).toBe("r-404");
    });

    it("returns 404 for unknown route", async () => {
      const app = mantle().configure(http());
      const fetchHandler = app.get("fetchHandler") as (req: Request) => Promise<Response>;
      const res = await fetchHandler(new Request("http://localhost/no-such-path"));
      expect(res.status).toBe(404);
    });
  });

  describe("transport conformance (shared table)", () => {
    it.each(TRANSPORT_CONFORMANCE_CASES.map((c) => [c.name, c] as const))("%s", async (_name, testCase) => {
      const { port, stop } = await startApp(registerTransportConformanceServices, {
        trustProxy: testCase.trustProxy,
        errors: testCase.errors,
      });
      try {
        const res = await fetch(conformanceRequest(`http://127.0.0.1:${port}`, testCase));
        const failures = checkTransportConformance(testCase, {
          status: res.status,
          headers: res.headers,
          body: await res.text(),
        });
        expect(failures).toEqual([]);
      } finally {
        await stop();
      }
    });

    it("keeps getContext().correlationId as a deprecated alias of requestId", async () => {
      let captured: string | undefined;
      const { port, stop } = await startApp((app) => {
        app.use("users", new TestUserService());
        app.service("users").hooks({
          before: {
            find: [
              (ctx) => {
                captured = getContext()?.correlationId;
                return ctx;
              },
            ],
          },
        });
      });
      try {
        await fetch(`http://localhost:${port}/users`, { headers: { "X-Request-Id": "hook-req-id" } });
        expect(captured).toBe("hook-req-id");
      } finally {
        await stop();
      }
    });
  });

  describe("params population", () => {
    it("sets params.provider to 'http' for requests", async () => {
      let capturedProvider: string | undefined;

      const { port, stop } = await startApp((app) => {
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
      });

      try {
        await fetch(`http://localhost:${port}/users`);
        expect(capturedProvider).toBe("http");
      } finally {
        await stop();
      }
    });

    it("populates params.query from the request query string", async () => {
      let capturedQuery: Record<string, unknown> | undefined;

      const { port, stop } = await startApp((app) => {
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
      });

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

      const { port, stop } = await startApp((app) => {
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
      });

      try {
        await fetch(
          `http://localhost:${port}/users?age[$gt]=21&$or[0][role]=admin&$or[1][role]=editor&tags[]=a&tags[]=b`,
        );
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
    it("serializes NotFound (404) from a service to a 404 HTTP response", async () => {
      class NotFoundService {
        async find(_params?: ServiceParams): Promise<User[]> {
          throw new NotFound("User not found");
        }
      }

      const { port, stop } = await startApp((app) => {
        app.use("items", new NotFoundService());
      });

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

      const { port, stop } = await startApp((app) => {
        app.use("items", new BadService());
      });

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

      const { port, stop } = await startApp((app) => {
        app.use("items", new BrokenService());
      });

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

      const { port, stop } = await startApp((app) => {
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
      });

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

  describe("app.get('server')", () => {
    it("stores the http.Server after listen()", async () => {
      const innerApp = mantle().configure(http());
      innerApp.use("users", new TestUserService());
      const server = innerApp.listen(0);
      await new Promise<void>((resolve) => server.once("listening", resolve));
      expect(innerApp.get("server")).toBe(server);
      expect(innerApp.get("http:server")).toBe(server);
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    });
  });
});

describe("introspection endpoint", () => {
  async function startWith(options?: Parameters<typeof http>[0]): Promise<{ port: number; stop: () => Promise<void> }> {
    const app = mantle().configure(http(options));
    app.use("users", new TestUserService(), { methods: ["find", "get", "create"] });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    return {
      port,
      stop: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    };
  }

  it("GET /_services returns 404 by default", async () => {
    const { port, stop } = await startWith();
    try {
      const res = await fetch(`http://localhost:${port}/_services`);
      expect(res.status).toBe(404);
    } finally {
      await stop();
    }
  });

  it("GET /_services serves ServiceDescriptor JSON when enabled", async () => {
    const { port, stop } = await startWith({ introspection: true });
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
    const { port, stop } = await startWith({ introspection: { path: "/__meta" } });
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
  async function startWith(options?: Parameters<typeof http>[0]): Promise<{
    app: ReturnType<typeof mantle>;
    port: number;
    stop: () => Promise<void>;
  }> {
    const app = mantle().configure(http(options));
    app.use("users", new TestUserService());
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    return {
      app,
      port,
      stop: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    };
  }

  function postBatch(
    port: number,
    calls: unknown,
    path = "/batch",
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return fetch(`http://localhost:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(calls),
    });
  }

  it("dispatches calls and returns BatchResults in input order", async () => {
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

  it("works through the fetchHandler as well", async () => {
    const app = mantle().configure(http());
    app.use("users", new TestUserService());
    const fetchHandler = app.get("fetchHandler") as (req: Request) => Promise<Response>;
    const res = await fetchHandler(
      new Request("http://localhost/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ service: "users", method: "find" }]),
      }),
    );
    expect(res.status).toBe(200);
    const [entry] = (await res.json()) as Array<{ status: string }>;
    expect(entry.status).toBe("success");
  });
});

describe("CORS", () => {
  async function startWith(options?: Parameters<typeof http>[0]): Promise<{ port: number; stop: () => Promise<void> }> {
    const app = mantle().configure(http(options));
    app.use("users", new TestUserService());
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    return {
      port,
      stop: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    };
  }

  it("exposes Mantle's response headers by default", async () => {
    const { port, stop } = await startApp((app) => app.use("users", new TestUserService()), { cors: true });
    try {
      const res = await fetch(`http://localhost:${port}/users`, { headers: { Origin: "https://app.example.com" } });
      expect(res.headers.get("access-control-expose-headers")).toBe(CORS_DEFAULT_EXPOSED_HEADERS.join(","));
    } finally {
      await stop();
    }
  });

  it("replaces the default exposed headers when exposedHeaders is set", async () => {
    const { port, stop } = await startApp((app) => app.use("users", new TestUserService()), {
      cors: { exposedHeaders: ["X-Custom"] },
    });
    try {
      const res = await fetch(`http://localhost:${port}/users`, { headers: { Origin: "https://app.example.com" } });
      expect(res.headers.get("access-control-expose-headers")).toBe("X-Custom");
    } finally {
      await stop();
    }
  });

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

  it("also short-circuits OPTIONS preflights through the fetchHandler", async () => {
    const app = mantle().configure(http({ cors: true }));
    app.use("users", new TestUserService());
    const fetchHandler = app.get("fetchHandler") as (req: Request) => Promise<Response>;
    const res = await fetchHandler(
      new Request("http://localhost/users", {
        method: "OPTIONS",
        headers: {
          Origin: "https://app.example.com",
          "Access-Control-Request-Method": "POST",
        },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET,POST,PUT,PATCH,DELETE");
  });
});
