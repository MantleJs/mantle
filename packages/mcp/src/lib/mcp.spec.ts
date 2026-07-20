import type { HookContext, MantleApplication, Paginated, ServiceParams } from "@mantlejs/mantle";
import { BadRequest, Forbidden, RepositoryService, mantle } from "@mantlejs/mantle";
import { MEMORY_OPERATORS, MemoryRepository } from "@mantlejs/memory";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { McpServerFactory } from "./mcp.js";
import { mcp } from "./mcp.js";
import type { McpOptions } from "./types.js";

interface User extends Record<string, unknown> {
  id?: string;
  name: string;
  age: number;
}

const USER_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    age: { type: "number" },
  },
  required: ["name", "age"],
};

const NOTES_SERVICE = {
  find: async () => [{ id: "n1", text: "hello" }],
  summarize: async (data: Record<string, unknown>) => ({ summary: `${String(data["text"] ?? "")}!` }),
};

function buildApp(options: McpOptions, seed: User[] = []): { app: MantleApplication; repo: MemoryRepository<User> } {
  const app = mantle();
  app.configure(mcp(options));
  const repo = new MemoryRepository<User>().seed(seed);
  app.use("users", new RepositoryService<User>(repo), { schema: USER_SCHEMA });
  app.use("notes", NOTES_SERVICE, { methods: ["find", "summarize"] });
  return { app, repo };
}

async function connect(app: MantleApplication, sessionParams?: ServiceParams): Promise<Client> {
  const factory = app.get<McpServerFactory>("mcp:server");
  const server = factory(sessionParams);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "spec-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function toolError(result: { isError?: boolean; content?: unknown }): Record<string, unknown> {
  expect(result.isError).toBe(true);
  const [first] = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(first.text) as Record<string, unknown>;
}

function textResult<T>(result: { content?: unknown }): T {
  const [first] = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(first.text) as T;
}

const seedUsers = (count: number): User[] =>
  Array.from({ length: count }, (_, i) => ({ id: `u${i}`, name: `user-${i}`, age: 20 + i }));

describe("tool generation", () => {
  it("lists one tool per exposed method across services, with schema-derived input schemas", async () => {
    const { app } = buildApp({ services: { users: true, notes: true }, transport: "stdio" });
    const client = await connect(app);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual([
      "notes_find",
      "notes_summarize",
      "users_create",
      "users_find",
      "users_get",
      "users_patch",
      "users_remove",
      "users_update",
    ]);

    const create = tools.find((tool) => tool.name === "users_create");
    expect(create?.inputSchema["required"]).toEqual(["data"]);
    expect((create?.inputSchema["properties"] as Record<string, unknown>)["data"]).toEqual(USER_SCHEMA);
    expect(create?.outputSchema).toEqual(USER_SCHEMA);

    // patch offers the all-optional variant of the entity schema
    const patch = tools.find((tool) => tool.name === "users_patch");
    const patchData = (patch?.inputSchema["properties"] as Record<string, Record<string, unknown>>)["data"];
    expect(patchData["properties"]).toEqual(USER_SCHEMA.properties);
    expect(patchData["required"]).toBeUndefined();

    expect(tools.find((tool) => tool.name === "users_update")?.description).toContain("Replaces the entire record");
    expect(tools.find((tool) => tool.name === "users_remove")?.description).toContain("Permanently deletes");
  });

  it("constrains the find where-operators to the adapter's capabilities and advertises the limit clamp", async () => {
    const { app } = buildApp(
      { services: { users: ["find"] }, transport: "stdio", query: { defaultLimit: 2, maxLimit: 3 } },
    );
    const client = await connect(app);
    const { tools } = await client.listTools();
    const find = tools.find((tool) => tool.name === "users_find");

    const query = (find?.inputSchema["properties"] as Record<string, Record<string, unknown>>)["query"];
    const properties = query["properties"] as Record<string, Record<string, unknown>>;
    const where = properties["where"];
    const fieldSchema = where["additionalProperties"] as { anyOf: Array<Record<string, unknown>> };
    const operatorObject = fieldSchema.anyOf[1];
    expect(Object.keys(operatorObject["properties"] as object).sort()).toEqual(
      [...MEMORY_OPERATORS].filter((op) => op !== "$or" && op !== "$and").sort(),
    );
    expect((where["properties"] as Record<string, unknown>)["$or"]).toBeDefined();

    const limit = properties["limit"];
    expect(limit["maximum"]).toBe(3);
    expect(limit["description"]).toContain("Default 2");
  });

  it("generates a plain-object schema for services without an attached schema (never-skip rule)", async () => {
    const { app } = buildApp({ services: { notes: true }, transport: "stdio" });
    const client = await connect(app);
    const { tools } = await client.listTools();
    const summarize = tools.find((tool) => tool.name === "notes_summarize");
    expect(summarize).toBeDefined();
    expect(summarize?.description).toContain("summarize");
  });
});

describe("expose map", () => {
  it("is deny-by-default: only listed methods get tools", async () => {
    const { app } = buildApp({ services: { users: ["find", "get"] }, transport: "stdio" });
    const client = await connect(app);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["users_find", "users_get"]);
  });

  it("requires the services option", () => {
    expect(() => mcp({ transport: "stdio" } as unknown as McpOptions)).toThrow(BadRequest);
    expect(() => mcp({ services: {}, transport: "stdio" })).toThrow(BadRequest);
  });

  it("rejects an unknown service path when the server is built", () => {
    const { app } = buildApp({ services: { ghosts: true }, transport: "stdio" });
    const factory = app.get<McpServerFactory>("mcp:server");
    expect(() => factory()).toThrow(BadRequest);
    expect(() => factory()).toThrow(/ghosts/);
  });

  it("rejects a method the service does not register", () => {
    const { app } = buildApp({ services: { notes: ["find", "remove"] }, transport: "stdio" });
    const factory = app.get<McpServerFactory>("mcp:server");
    expect(() => factory()).toThrow(BadRequest);
    expect(() => factory()).toThrow(/remove/);
  });

  it('exposes every service registered after mcp() with services: "*"', async () => {
    const { app } = buildApp({ services: "*", transport: "stdio" });
    const client = await connect(app);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("users_find");
    expect(names).toContain("notes_summarize");
  });
});

describe("dispatch through the hook pipeline", () => {
  it("runs find with a structured query translated to the REST query convention", async () => {
    const { app } = buildApp({ services: { users: true }, transport: "stdio" }, seedUsers(5));
    const client = await connect(app);
    const result = await client.callTool({
      name: "users_find",
      arguments: { query: { where: { age: { $gt: 22 } }, sort: { age: "desc" } } },
    });
    const page = textResult<Paginated<User>>(result);
    expect(page.data.map((user) => user.age)).toEqual([24, 23]);
  });

  it("returns a tool error naming an operator the adapter does not support", async () => {
    const { app } = buildApp({ services: { users: true }, transport: "stdio" }, seedUsers(2));
    const client = await connect(app);
    const result = await client.callTool({
      name: "users_find",
      arguments: { query: { where: { name: { $regex: "^u" } } } },
    });
    const error = toolError(result);
    expect(error["name"]).toBe("BadRequest");
    expect(error["message"]).toContain("$regex");
  });

  it("sets provider 'mcp' and runs before hooks — a Forbidden hook becomes a 403 tool error with hint", async () => {
    const { app } = buildApp({ services: { users: true }, transport: "stdio" }, seedUsers(1));
    let seenProvider: string | undefined;
    app.service("users").hooks({
      before: {
        all: [
          (context: HookContext) => {
            seenProvider = context.provider ?? context.params.provider;
            throw new Forbidden("MCP callers may not touch users", undefined, undefined, "Use the reports service");
          },
        ],
      },
    });
    const client = await connect(app);
    const result = await client.callTool({ name: "users_find", arguments: {} });
    const error = toolError(result);
    expect(error["code"]).toBe(403);
    expect(error["hint"]).toBe("Use the reports service");
    expect(seenProvider).toBe("mcp");
  });

  it("emits the service event on successful create and returns structured content", async () => {
    const { app } = buildApp({ services: { users: true }, transport: "stdio" });
    const events: Array<[string, string]> = [];
    app.on("service:event", (...args: unknown[]) => {
      events.push([args[0] as string, args[1] as string]);
    });
    const client = await connect(app);
    const result = await client.callTool({
      name: "users_create",
      arguments: { data: { name: "Ada", age: 36 } },
    });
    expect(events).toContainEqual(["users", "created"]);
    const created = textResult<User>(result);
    expect(created.name).toBe("Ada");
    expect((result as { structuredContent?: Record<string, unknown> }).structuredContent?.["name"]).toBe("Ada");
  });

  it("requires id for get and rejects a missing one as a tool error", async () => {
    const { app } = buildApp({ services: { users: true }, transport: "stdio" }, seedUsers(1));
    const client = await connect(app);
    const error = toolError(await client.callTool({ name: "users_get", arguments: {} }));
    expect(error["name"]).toBe("BadRequest");
    expect(error["message"]).toContain("id");
  });
});

describe("find limits", () => {
  const options: McpOptions = { services: { users: true }, transport: "stdio", query: { defaultLimit: 2, maxLimit: 3 } };

  it("applies defaultLimit when the caller sends none, with a truncation note", async () => {
    const { app } = buildApp(options, seedUsers(5));
    const client = await connect(app);
    const result = await client.callTool({ name: "users_find", arguments: {} });
    const page = textResult<Paginated<User>>(result);
    expect(page.data).toHaveLength(2);
    expect(page.total).toBe(5);
    const note = (result.content as Array<{ text: string }>)[1]?.text;
    expect(note).toContain("Returned 2 of 5");
  });

  it("clamps a limit above maxLimit", async () => {
    const { app } = buildApp(options, seedUsers(5));
    const client = await connect(app);
    const result = await client.callTool({ name: "users_find", arguments: { query: { limit: 50 } } });
    const page = textResult<Paginated<User>>(result);
    expect(page.data).toHaveLength(3);
  });

  it("rejects a non-positive limit configuration", () => {
    expect(() => mcp({ services: "*", transport: "stdio", query: { defaultLimit: 0 } })).toThrow(BadRequest);
    expect(() => mcp({ services: "*", transport: "stdio", query: { defaultLimit: 9, maxLimit: 3 } })).toThrow(
      BadRequest,
    );
  });
});

describe("custom tools", () => {
  it("chains service calls through both hook pipelines with the session params", async () => {
    const pipelineCalls: string[] = [];
    const { app } = buildApp({
      services: { users: ["find"] },
      transport: "stdio",
      tools: [
        {
          name: "onboard_user",
          description: "Create a user, then report the new head-count.",
          inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
          handler: async (args, ctx) => {
            const { name } = args as { name: string };
            const created = await ctx.app.service("users").dispatch("create", { name, age: 0 }, undefined, ctx.params);
            const page = (await ctx.app.service("users").dispatch("find", undefined, undefined, ctx.params)) as Paginated<User>;
            return { created, count: page.total };
          },
        },
      ],
    });
    app.service("users").hooks({
      before: {
        all: [
          (context: HookContext) => {
            pipelineCalls.push(`${context.method}:${String(context.params.provider)}`);
            return context;
          },
        ],
      },
    });

    const client = await connect(app);
    const result = await client.callTool({ name: "onboard_user", arguments: { name: "Grace" } });
    const outcome = textResult<{ created: User; count: number }>(result);
    expect(outcome.created.name).toBe("Grace");
    expect(outcome.count).toBe(1);
    expect(pipelineCalls).toEqual(["create:mcp", "find:mcp"]);
  });

  it("maps handler MantleErrors to the tool-error shape", async () => {
    const { app } = buildApp({
      services: { users: ["find"] },
      transport: "stdio",
      tools: [
        {
          name: "always_forbidden",
          description: "Throws.",
          inputSchema: { type: "object" },
          handler: async () => {
            throw new Forbidden("Nope");
          },
        },
      ],
    });
    const client = await connect(app);
    const error = toolError(await client.callTool({ name: "always_forbidden", arguments: {} }));
    expect(error["code"]).toBe(403);
  });

  it("rejects a custom tool whose name collides with a generated tool", () => {
    const { app } = buildApp({
      services: { users: true },
      transport: "stdio",
      tools: [{ name: "users_find", description: "clash", inputSchema: { type: "object" }, handler: async () => null }],
    });
    const factory = app.get<McpServerFactory>("mcp:server");
    expect(() => factory()).toThrow(BadRequest);
    expect(() => factory()).toThrow(/users_find/);
  });
});

describe("events as resources", () => {
  it("lists and serves event resources for expose-map services only", async () => {
    const { app } = buildApp({ services: { users: true }, transport: "stdio", events: true });
    // A service outside the expose map — its change stream must not leak.
    app.use("secrets", new RepositoryService(new MemoryRepository()), {});

    const client = await connect(app);
    await client.callTool({ name: "users_create", arguments: { data: { name: "Eve", age: 1 } } });
    await app.service("secrets").create({ codename: "x" });

    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual(["mantle://events/users"]);

    const read = await client.readResource({ uri: "mantle://events/users" });
    const contents = read.contents as Array<{ text: string }>;
    const log = JSON.parse(contents[0].text) as Array<{ event: string; path: string }>;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ event: "created", path: "users" });

    await expect(client.readResource({ uri: "mantle://events/secrets" })).rejects.toThrow(/Unknown resource/);
  });

  it("does not advertise the resources capability when events are off", async () => {
    const { app } = buildApp({ services: { users: true }, transport: "stdio" });
    const client = await connect(app);
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
  });
});

describe("custom resources", () => {
  const docsResource = {
    uri: "mantle://docs/usage",
    name: "API usage guide",
    description: "How to query this API.",
    mimeType: "text/markdown",
    read: async () => "# Usage\nQuery users with users_find.",
  };

  it("lists and reads custom resources without events enabled", async () => {
    const { app } = buildApp({ services: { users: true }, transport: "stdio", resources: [docsResource] });
    const client = await connect(app);
    expect(client.getServerCapabilities()?.resources).toBeDefined();

    const { resources } = await client.listResources();
    expect(resources).toEqual([
      { uri: "mantle://docs/usage", name: "API usage guide", description: "How to query this API.", mimeType: "text/markdown" },
    ]);

    const read = await client.readResource({ uri: "mantle://docs/usage" });
    const contents = read.contents as Array<{ mimeType?: string; text?: string }>;
    expect(contents[0].mimeType).toBe("text/markdown");
    expect(contents[0].text).toContain("users_find");
  });

  it("lists custom resources alongside event resources and keeps event notifications working", async () => {
    const { app } = buildApp({
      services: { users: true },
      transport: "stdio",
      events: true,
      resources: [docsResource],
    });
    const client = await connect(app);
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual(["mantle://docs/usage", "mantle://events/users"]);
    // Subscribing to a custom resource is an accepted no-op; event resources stay subscribable.
    await expect(client.subscribeResource({ uri: "mantle://docs/usage" })).resolves.toBeDefined();
    await expect(client.subscribeResource({ uri: "mantle://events/users" })).resolves.toBeDefined();
  });

  it("runs read with the session params — dispatch hits the hook pipeline", async () => {
    let seenProvider: string | undefined;
    const { app } = buildApp(
      {
        services: { users: true },
        transport: "stdio",
        resources: [
          {
            uri: "mantle://reports/head-count",
            name: "Head count",
            read: async ({ app: innerApp, params }) => {
              const page = (await innerApp.service("users").dispatch("find", undefined, undefined, params)) as Paginated<User>;
              return String(page.total);
            },
          },
        ],
      },
      seedUsers(3),
    );
    app.service("users").hooks({
      before: {
        all: [
          (context: HookContext) => {
            seenProvider = context.params.provider;
            return context;
          },
        ],
      },
    });
    const client = await connect(app);
    const read = await client.readResource({ uri: "mantle://reports/head-count" });
    expect((read.contents as Array<{ text?: string }>)[0].text).toBe("3");
    expect(seenProvider).toBe("mcp");
  });

  it("surfaces a MantleError thrown by read as a protocol error carrying its message", async () => {
    const { app } = buildApp({
      services: { users: true },
      transport: "stdio",
      resources: [
        {
          uri: "mantle://broken",
          name: "Broken",
          read: async () => {
            throw new Forbidden("No reading for you");
          },
        },
      ],
    });
    const client = await connect(app);
    await expect(client.readResource({ uri: "mantle://broken" })).rejects.toThrow(/No reading for you/);
  });

  it("rejects reserved and duplicate URIs at configure time", () => {
    const reserved = { uri: "mantle://events/users", name: "sneaky", read: async () => "" };
    expect(() => mcp({ services: "*", transport: "stdio", resources: [reserved] })).toThrow(/reserved/);
    const duplicate = { uri: "mantle://docs/x", name: "x", read: async () => "" };
    expect(() => mcp({ services: "*", transport: "stdio", resources: [duplicate, { ...duplicate }] })).toThrow(
      /Duplicate/,
    );
  });
});

describe("prompts", () => {
  const options = (overrides: Partial<McpOptions> = {}): McpOptions => ({
    services: { users: true },
    transport: "stdio",
    prompts: [
      {
        name: "triage_users",
        description: "Review recently added users.",
        arguments: [{ name: "focus", description: "What to look for", required: false }],
        get: async (args) => `Review the newest users${args["focus"] ? ` with a focus on ${args["focus"]}` : ""}.`,
      },
      {
        name: "full_shape",
        get: async () => ({
          description: "resolved description",
          messages: [
            { role: "user" as const, content: { type: "text" as const, text: "one" } },
            { role: "assistant" as const, content: { type: "text" as const, text: "two" } },
          ],
        }),
      },
    ],
    ...overrides,
  });

  it("lists prompts with their arguments and declares the capability", async () => {
    const { app } = buildApp(options());
    const client = await connect(app);
    expect(client.getServerCapabilities()?.prompts).toBeDefined();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name).sort()).toEqual(["full_shape", "triage_users"]);
    expect(prompts.find((prompt) => prompt.name === "triage_users")?.arguments).toEqual([
      { name: "focus", description: "What to look for", required: false },
    ]);
  });

  it("wraps a string return as a single user message and passes arguments through", async () => {
    const { app } = buildApp(options());
    const client = await connect(app);
    const result = await client.getPrompt({ name: "triage_users", arguments: { focus: "spam accounts" } });
    expect(result.messages).toEqual([
      { role: "user", content: { type: "text", text: "Review the newest users with a focus on spam accounts." } },
    ]);
  });

  it("passes the full { description, messages } shape through", async () => {
    const { app } = buildApp(options());
    const client = await connect(app);
    const result = await client.getPrompt({ name: "full_shape" });
    expect(result.description).toBe("resolved description");
    expect(result.messages).toHaveLength(2);
  });

  it("rejects an unknown prompt", async () => {
    const { app } = buildApp(options());
    const client = await connect(app);
    await expect(client.getPrompt({ name: "ghost" })).rejects.toThrow(/Unknown prompt/);
  });

  it("gives handlers the session context for hook-pipeline dispatch", async () => {
    const { app } = buildApp(
      options({
        prompts: [
          {
            name: "head_count",
            get: async (_args, { app: innerApp, params }) => {
              const page = (await innerApp.service("users").dispatch("find", undefined, undefined, params)) as Paginated<User>;
              return `There are ${page.total} users.`;
            },
          },
        ],
      }),
      seedUsers(2),
    );
    const client = await connect(app);
    const result = await client.getPrompt({ name: "head_count" });
    expect(result.messages[0]?.content).toEqual({ type: "text", text: "There are 2 users." });
  });

  it("omits the prompts capability when none are defined and rejects duplicates at configure time", async () => {
    const { app } = buildApp({ services: { users: true }, transport: "stdio" });
    const client = await connect(app);
    expect(client.getServerCapabilities()?.prompts).toBeUndefined();

    const prompt = { name: "dup", get: async () => "x" };
    expect(() => mcp({ services: "*", transport: "stdio", prompts: [prompt, { ...prompt }] })).toThrow(/Duplicate/);
  });
});
