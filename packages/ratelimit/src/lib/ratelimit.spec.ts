import type { HookContext, HttpResponseMeta, MantleApplication, ServiceParams } from "@mantlejs/mantle";
import { BadRequest, mantle, TooManyRequests } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";
import type { McpServerFactory } from "@mantlejs/mcp";
import { mcp } from "@mantlejs/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { byAgent, byIp, byPrincipal, byTenant, byUser } from "./keys.js";
import { rateLimit } from "./ratelimit.js";
import { memoryStore } from "./stores.js";

const notes = {
  find: async () => [{ id: "n1" }],
  create: async (data: unknown) => data,
};

/** Dispatch like an HTTP transport would: an external provider and a response sink for context.http. */
async function call(app: MantleApplication, method: string, params: ServiceParams = {}, data?: unknown) {
  const response: HttpResponseMeta = {};
  try {
    const result = await app
      .service("notes")
      .dispatch(method, data as never, undefined, { provider: "rest", ip: "10.0.0.1", ...params }, { response });
    return { result, response, error: undefined };
  } catch (error) {
    return { result: undefined, response, error: error as TooManyRequests };
  }
}

function appWith(...hooks: Array<{ method?: "all" | "create"; hook: ReturnType<typeof rateLimit> }>) {
  const app = mantle();
  app.use("notes", notes, { methods: ["find", "create"] });
  const before: Record<string, Array<ReturnType<typeof rateLimit>>> = {};
  for (const { method = "all", hook } of hooks) (before[method] ??= []).push(hook);
  app.service("notes").hooks({ before });
  return app;
}

describe("rateLimit()", () => {
  it("lets calls within the limit through with RateLimit-Policy and RateLimit headers", async () => {
    const app = appWith({ hook: rateLimit({ limit: 3, windowSeconds: 60 }) });
    const { response, error } = await call(app, "find");
    expect(error).toBeUndefined();
    expect(response.headers).toEqual({
      "RateLimit-Policy": '"default";q=3;w=60',
      RateLimit: '"default";r=2;t=60',
    });
    expect((await call(app, "find")).response.headers?.["RateLimit"]).toMatch(/^"default";r=1;t=(59|60)$/);
  });

  it("throws TooManyRequests with Retry-After once the limit is exceeded", async () => {
    const app = appWith({ hook: rateLimit({ limit: 2, windowSeconds: 30 }) });
    await call(app, "find");
    await call(app, "find");
    const { error, response } = await call(app, "find");
    expect(error).toBeInstanceOf(TooManyRequests);
    expect(error?.message).toMatch(/Retry after (29|30)s/);
    expect(error?.hint).toMatch(/Retry-After/);
    expect(error?.data).toMatchObject({ policy: "default", limit: 2, windowSeconds: 30 });
    expect(error?.headers).toMatchObject({ "Retry-After": expect.stringMatching(/^(29|30)$/) });
    expect(error?.headers?.["RateLimit"]).toMatch(/^"default";r=0;t=/);
    // Also on context.http, so a later error path keeps them.
    expect(response.headers?.["RateLimit"]).toMatch(/^"default";r=0;t=/);
  });

  it("puts every policy that applies to a call into one header each", async () => {
    const app = appWith(
      { hook: rateLimit({ limit: 100, windowSeconds: 60 }) },
      { method: "create", hook: rateLimit({ policy: "writes", limit: 10, windowSeconds: 60 }) },
    );
    const { response } = await call(app, "create", {}, { text: "hi" });
    expect(response.headers?.["RateLimit-Policy"]).toBe('"default";q=100;w=60, "writes";q=10;w=60');
    expect(response.headers?.["RateLimit"]).toBe('"default";r=99;t=60, "writes";r=9;t=60');
  });

  it("stops at the strictest policy", async () => {
    const app = appWith(
      { hook: rateLimit({ limit: 100, windowSeconds: 60 }) },
      { method: "create", hook: rateLimit({ policy: "writes", limit: 1, windowSeconds: 60 }) },
    );
    await call(app, "create", {}, {});
    const { error } = await call(app, "create", {}, {});
    expect(error?.data).toMatchObject({ policy: "writes" });
    expect((await call(app, "find")).error).toBeUndefined();
  });

  it("counts each caller separately", async () => {
    const app = appWith({ hook: rateLimit({ limit: 1, windowSeconds: 60 }) });
    expect((await call(app, "find", { ip: "10.0.0.1" })).error).toBeUndefined();
    expect((await call(app, "find", { ip: "10.0.0.2" })).error).toBeUndefined();
    expect((await call(app, "find", { ip: "10.0.0.1" })).error).toBeInstanceOf(TooManyRequests);
  });

  it("shares one budget across services that use the same policy and store", async () => {
    const store = memoryStore();
    const app = mantle();
    app.use("notes", notes, { methods: ["find"] });
    app.use("tags", notes, { methods: ["find"] });
    const shared = () => rateLimit({ policy: "global", limit: 1, windowSeconds: 60, store });
    app.service("notes").hooks({ before: { all: [shared()] } });
    app.service("tags").hooks({ before: { all: [shared()] } });
    await app.service("notes").find({ provider: "rest", ip: "10.0.0.1" });
    await expect(app.service("tags").find({ provider: "rest", ip: "10.0.0.1" })).rejects.toBeInstanceOf(
      TooManyRequests,
    );
  });

  it("skips internal calls unless includeInternal is set", async () => {
    const skipped = appWith({ hook: rateLimit({ limit: 1, windowSeconds: 60, key: () => "same" }) });
    await skipped.service("notes").find();
    await expect(skipped.service("notes").find()).resolves.toBeDefined();

    const counted = appWith({
      hook: rateLimit({ limit: 1, windowSeconds: 60, key: () => "same", includeInternal: true }),
    });
    await counted.service("notes").find();
    await expect(counted.service("notes").find()).rejects.toBeInstanceOf(TooManyRequests);
  });

  it("skips the limit when the key function returns undefined", async () => {
    const app = appWith({ hook: rateLimit({ limit: 1, windowSeconds: 60, key: byUser() }) });
    await call(app, "find");
    const { error, response } = await call(app, "find");
    expect(error).toBeUndefined();
    expect(response.headers).toBeUndefined();
  });

  it("charges a cost per call", async () => {
    const app = appWith({
      hook: rateLimit({
        limit: 10,
        windowSeconds: 60,
        cost: (context: HookContext) => (context.method === "create" ? 6 : 1),
      }),
    });
    await call(app, "create", {}, {});
    expect((await call(app, "find")).response.headers?.["RateLimit"]).toMatch(/r=3;/);
    expect((await call(app, "create", {}, {})).error).toBeInstanceOf(TooManyRequests);
  });

  it.each([
    [{ limit: 0, windowSeconds: 60 }],
    [{ limit: 1.5, windowSeconds: 60 }],
    [{ limit: 10, windowSeconds: 0 }],
    [{ limit: 10, windowSeconds: 60, policy: "bad name" }],
  ])("rejects invalid options %j with BadRequest", (options) => {
    expect(() => rateLimit(options)).toThrow(BadRequest);
  });
});

describe("key functions", () => {
  const context = (params: ServiceParams, agent?: HookContext["agent"]) => ({ params, agent }) as HookContext;
  const agent = { id: "agent-1", scope: {}, delegatingUserId: "u1" };

  it("byUser reads the user record's id, else the JWT payload's sub", () => {
    expect(byUser()(context({ user: { id: 7 } }))).toBe("user:7");
    expect(byUser()(context({ user: { sub: "u1" } }))).toBe("user:u1");
    expect(byUser()(context({}))).toBeUndefined();
  });

  it("byAgent, byIp, and byTenant read their identity or skip", () => {
    expect(byAgent()(context({}, agent))).toBe("agent:agent-1");
    expect(byAgent()(context({}))).toBeUndefined();
    expect(byIp()(context({ ip: "1.2.3.4" }))).toBe("ip:1.2.3.4");
    expect(byTenant()(context({ tenant: { id: "acme" } }))).toBe("tenant:acme");
    expect(byTenant()(context({}))).toBeUndefined();
  });

  it("byPrincipal prefers the agent, then the user, then the IP", () => {
    const params = { user: { id: "u1" }, ip: "1.2.3.4" };
    expect(byPrincipal()(context(params, agent))).toBe("agent:agent-1");
    expect(byPrincipal()(context(params))).toBe("user:u1");
    expect(byPrincipal()(context({ ip: "1.2.3.4" }))).toBe("ip:1.2.3.4");
  });
});

describe("over HTTP (@mantlejs/http)", () => {
  it("sends the headers on success and a 429 Problem Details with Retry-After when exceeded", async () => {
    const app = mantle().configure(http());
    app.use("notes", notes, { methods: ["find"] });
    app.service("notes").hooks({ before: { all: [rateLimit({ limit: 1, windowSeconds: 60, key: () => "client" })] } });
    const fetchHandler = app.get<(request: Request) => Promise<Response>>("fetchHandler");

    const ok = await fetchHandler(new Request("http://localhost/notes"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("ratelimit-policy")).toBe('"default";q=1;w=60');
    expect(ok.headers.get("ratelimit")).toBe('"default";r=0;t=60');

    const limited = await fetchHandler(new Request("http://localhost/notes"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^(59|60)$/);
    expect(limited.headers.get("ratelimit")).toMatch(/^"default";r=0;t=/);
    expect(limited.headers.get("content-type")).toBe("application/problem+json");
    const body = (await limited.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ type: "https://mantlejs.com/errors/too-many-requests", status: 429 });
    expect(body).not.toHaveProperty("headers");
  });
});

describe("through MCP (@mantlejs/mcp): agent-keyed limits", () => {
  async function connect(app: MantleApplication, sessionParams: ServiceParams): Promise<Client> {
    const server = app.get<McpServerFactory>("mcp:server")(sessionParams);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "ratelimit-spec", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    return client;
  }

  it("gives each agent its own budget and tells an over-limit agent how long to wait", async () => {
    const app = mantle();
    app.configure(mcp({ services: { notes: ["find"] }, transport: "stdio" }));
    app.use("notes", notes, { methods: ["find"] });
    // Stand-in for authorizeAgent(): the session's agent id becomes context.agent.
    const asAgent = (context: HookContext) => {
      const id = context.params["agentId"] as string;
      return { ...context, agent: { id, scope: { notes: true as const }, delegatingUserId: "u1" } };
    };
    app.service("notes").hooks({ before: { all: [asAgent, rateLimit({ limit: 1, windowSeconds: 60 })] } });

    const agentA = await connect(app, { agentId: "a" });
    const agentB = await connect(app, { agentId: "b" });
    expect((await agentA.callTool({ name: "notes_find", arguments: {} })).isError).toBeFalsy();
    expect((await agentB.callTool({ name: "notes_find", arguments: {} })).isError).toBeFalsy();

    const limited = await agentA.callTool({ name: "notes_find", arguments: {} });
    expect(limited.isError).toBe(true);
    const [first] = limited.content as Array<{ text: string }>;
    const error = JSON.parse(first.text) as Record<string, unknown>;
    expect(error["code"]).toBe(429);
    expect(error["message"]).toMatch(/Retry after \d+s/);
    expect(error["data"]).toMatchObject({ retryAfter: expect.any(Number) });
  });
});
