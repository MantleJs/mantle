import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { mantle, getContext } from "@mantlejs/mantle";
import { BadRequest, NotFound } from "@mantlejs/mantle";
import type { ServiceParams } from "@mantlejs/mantle";
import { http } from "./http.js";

async function startApp(configure: (app: ReturnType<typeof mantle>) => void): Promise<{
  port: number;
  stop: () => Promise<void>;
}> {
  const app = mantle().configure(http());
  configure(app);
  const server = app.listen(0) as Server;
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

    it("returns x-correlation-id in response headers", async () => {
      const app = mantle().configure(http());
      app.use("users", new TestUserService());
      const fetchHandler = app.get("fetchHandler") as (req: Request) => Promise<Response>;
      const res = await fetchHandler(new Request("http://localhost/users"));
      expect(res.headers.get("x-correlation-id")).toBeTruthy();
    });

    it("echoes x-correlation-id from request", async () => {
      const app = mantle().configure(http());
      app.use("users", new TestUserService());
      const fetchHandler = app.get("fetchHandler") as (req: Request) => Promise<Response>;
      const res = await fetchHandler(
        new Request("http://localhost/users", {
          headers: { "x-correlation-id": "edge-trace-id" },
        }),
      );
      expect(res.headers.get("x-correlation-id")).toBe("edge-trace-id");
    });

    it("returns 404 for unknown route", async () => {
      const app = mantle().configure(http());
      const fetchHandler = app.get("fetchHandler") as (req: Request) => Promise<Response>;
      const res = await fetchHandler(new Request("http://localhost/no-such-path"));
      expect(res.status).toBe(404);
    });
  });

  describe("correlation ID", () => {
    it("sets x-correlation-id response header on every request", async () => {
      const { port, stop } = await startApp((app) => {
        app.use("users", new TestUserService());
      });
      try {
        const res = await fetch(`http://localhost:${port}/users`);
        expect(res.headers.get("x-correlation-id")).toBeTruthy();
      } finally {
        await stop();
      }
    });

    it("echoes a client-supplied x-correlation-id header", async () => {
      const { port, stop } = await startApp((app) => {
        app.use("users", new TestUserService());
      });
      try {
        const res = await fetch(`http://localhost:${port}/users`, {
          headers: { "x-correlation-id": "my-trace-id" },
        });
        expect(res.headers.get("x-correlation-id")).toBe("my-trace-id");
      } finally {
        await stop();
      }
    });

    it("makes correlationId available via getContext() inside hooks", async () => {
      let capturedCorrelationId: string | undefined;

      const { port, stop } = await startApp((app) => {
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
      });

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
      const server = innerApp.listen(0) as Server;
      await new Promise<void>((resolve) => server.once("listening", resolve));
      expect(innerApp.get("server")).toBe(server);
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    });
  });
});
