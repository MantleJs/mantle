import { describe, expect, it } from "vitest";
import { GeneralError, mantle } from "@mantlejs/mantle";
import type {
  HookContext,
  HttpRequestLike,
  HttpResponseLike,
  HttpRouteHandler,
  HttpRouterLike,
  RepositoryCapabilities,
  ServiceDescriptor,
} from "@mantlejs/mantle";
import { openapi } from "./openapi.js";
import { buildOpenApiDocument } from "./document.js";

// ─── Stub transport router ────────────────────────────────────────────────────

interface StubRouter extends HttpRouterLike {
  routes: Map<string, HttpRouteHandler>;
  /** Invoke a mounted GET handler and capture what it wrote to the response. */
  invoke(path: string, withSend?: boolean): Promise<{ status: number; json?: unknown; sent?: string }>;
}

function makeRouter(): StubRouter {
  const routes = new Map<string, HttpRouteHandler>();
  return {
    routes,
    get(path, handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    },
    async invoke(path, withSend = true) {
      const handler = routes.get(`GET ${path}`);
      if (!handler) throw new Error(`No GET handler mounted at ${path}`);
      const captured: { status: number; json?: unknown; sent?: string } = { status: 200 };
      const req: HttpRequestLike = { protocol: "http", query: {}, headers: {}, get: () => undefined };
      const res: HttpResponseLike = {
        status(code) {
          captured.status = code;
          return this;
        },
        json(body) {
          captured.json = body;
        },
        redirect() {
          /* not used */
        },
        ...(withSend
          ? {
              send(body: string) {
                captured.sent = body;
              },
            }
          : {}),
      };
      await handler(req, res, (err) => {
        if (err) throw err;
      });
      return captured;
    },
  };
}

function makeApp(options?: Parameters<typeof openapi>[0]): { app: ReturnType<typeof mantle>; router: StubRouter } {
  const app = mantle();
  const router = makeRouter();
  app.set("http:router", router);
  app.configure(openapi(options));
  return { app, router };
}

const userSchema = {
  type: "object",
  properties: { id: { type: "string" }, name: { type: "string" } },
};

// ─── Plugin ───────────────────────────────────────────────────────────────────

describe("openapi() plugin", () => {
  it("throws GeneralError when no HTTP transport is configured", () => {
    expect(() => mantle().configure(openapi())).toThrow(GeneralError);
  });

  it("serves the document at /openapi.json by default", async () => {
    const { app, router } = makeApp();
    app.use("users", {}, { schema: userSchema });
    const { json } = await router.invoke("/openapi.json");
    const doc = json as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/users", "/users/{id}"]));
    expect(doc.components.schemas["Users"]).toBe(userSchema);
  });

  it("honors a custom specPath and strips leading slashes from service paths", async () => {
    const { app, router } = makeApp({ specPath: "/spec.json" });
    app.use("/users", {});
    expect(router.routes.has("GET /openapi.json")).toBe(false);
    const { json } = await router.invoke("/spec.json");
    expect(Object.keys((json as { paths: Record<string, unknown> }).paths)).toContain("/users");
  });

  it("rebuilds per request — hooks registered after use() are reflected", async () => {
    const { app, router } = makeApp();
    app.use("users", {});
    const before = (await router.invoke("/openapi.json")).json as { components: Record<string, unknown> };
    expect(before.components["securitySchemes"]).toBeUndefined();

    const authHook = Object.assign(async (ctx: HookContext) => ctx, { authStrategy: "jwt" });
    app.service("users").hooks({ before: { all: [authHook] } });

    const after = (await router.invoke("/openapi.json")).json as {
      components: { securitySchemes?: Record<string, unknown> };
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    };
    expect(after.components.securitySchemes?.["bearerAuth"]).toMatchObject({ type: "http", scheme: "bearer" });
    expect(after.paths["/users"]["get"].security).toEqual([{ bearerAuth: [] }]);
  });

  it("does not mount a docs route by default", () => {
    const { router } = makeApp();
    expect(router.routes.size).toBe(1);
  });

  it("serves Swagger UI HTML at docsPath pointing at the spec", async () => {
    const { router } = makeApp({ docsPath: "/docs", info: { title: "Demo <API>" } });
    const { sent } = await router.invoke("/docs");
    expect(sent).toContain("SwaggerUIBundle");
    expect(sent).toContain('"/openapi.json"');
    expect(sent).toContain("Demo &lt;API&gt;"); // title is HTML-escaped
  });

  it("falls back to a JSON pointer when the transport lacks res.send", async () => {
    const { router } = makeApp({ docsPath: "/docs" });
    const { json } = await router.invoke("/docs", false);
    expect(json).toEqual({ openapi: "/openapi.json" });
  });
});

// ─── Document builder ─────────────────────────────────────────────────────────

function descriptor(overrides: Partial<ServiceDescriptor> = {}): ServiceDescriptor {
  return {
    path: "users",
    methods: ["find", "get", "create", "update", "patch", "remove"],
    events: ["created", "updated", "patched", "removed"],
    ...overrides,
  };
}

describe("buildOpenApiDocument", () => {
  it("maps the six standard methods to REST operations", () => {
    const doc = buildOpenApiDocument([descriptor()]) as {
      paths: Record<string, Record<string, { operationId: string; responses: Record<string, unknown> }>>;
    };
    expect(Object.keys(doc.paths["/users"])).toEqual(["get", "post"]);
    expect(Object.keys(doc.paths["/users/{id}"]).sort()).toEqual(["delete", "get", "patch", "put"]);
    expect(doc.paths["/users"]["post"].operationId).toBe("users.create");
    expect(doc.paths["/users"]["post"].responses["201"]).toBeDefined();
    expect(doc.paths["/users"]["post"].responses["default"]).toBeDefined();
  });

  it("only emits operations for registered methods", () => {
    const doc = buildOpenApiDocument([descriptor({ methods: ["find"] })]) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(["/users"]);
    expect(Object.keys(doc.paths["/users"] as Record<string, unknown>)).toEqual(["get"]);
  });

  it("mounts custom methods as POST /path/method", () => {
    const doc = buildOpenApiDocument([descriptor({ methods: ["find", "promote"] })]) as {
      paths: Record<string, Record<string, { operationId: string }>>;
    };
    expect(doc.paths["/users/promote"]["post"].operationId).toBe("users.promote");
  });

  it("uses a generic object schema when the service has none — never skips", () => {
    const doc = buildOpenApiDocument([descriptor()]) as { components: { schemas: Record<string, unknown> } };
    expect(doc.components.schemas["Users"]).toEqual({ type: "object" });
  });

  it("derives Pascal-case schema names from nested paths", () => {
    const doc = buildOpenApiDocument([descriptor({ path: "admin/blog-posts" })]) as {
      components: { schemas: Record<string, unknown> };
      paths: Record<string, unknown>;
    };
    expect(doc.components.schemas["AdminBlogPosts"]).toBeDefined();
    expect(doc.paths["/admin/blog-posts"]).toBeDefined();
  });

  it("find returns the Paginated envelope when capabilities are present, a bare array otherwise", () => {
    const capabilities: RepositoryCapabilities = {
      adapter: "@mantlejs/memory",
      operators: ["$in", "$or"],
      pagination: "offset",
      fullTextSearch: false,
    };
    const withCaps = buildOpenApiDocument([descriptor({ capabilities })]) as {
      paths: Record<
        string,
        Record<
          string,
          {
            description?: string;
            responses: Record<string, { content: Record<string, { schema: Record<string, unknown> }> }>;
          }
        >
      >;
    };
    const paginated = withCaps.paths["/users"]["get"].responses["200"].content["application/json"].schema;
    expect(paginated["required"]).toEqual(["total", "limit", "skip", "data"]);
    expect(withCaps.paths["/users"]["get"].description).toContain("$in, $or");

    const without = buildOpenApiDocument([descriptor()]) as typeof withCaps;
    const array = without.paths["/users"]["get"].responses["200"].content["application/json"].schema;
    expect(array["type"]).toBe("array");
  });

  it("omits securitySchemes when no service requires auth", () => {
    const doc = buildOpenApiDocument([descriptor()]) as { components: Record<string, unknown> };
    expect(doc.components["securitySchemes"]).toBeUndefined();
  });

  it("applies info defaults and overrides", () => {
    const defaults = buildOpenApiDocument([]) as { info: Record<string, unknown> };
    expect(defaults.info).toEqual({ title: "Mantle API", version: "0.0.0" });

    const custom = buildOpenApiDocument([], { title: "Shop", version: "1.2.3", description: "d" }) as {
      info: Record<string, unknown>;
    };
    expect(custom.info).toEqual({ title: "Shop", version: "1.2.3", description: "d" });
  });

  it("always includes the MantleError schema", () => {
    const doc = buildOpenApiDocument([]) as { components: { schemas: Record<string, unknown> } };
    expect(doc.components.schemas["MantleError"]).toMatchObject({ type: "object" });
  });
});
