import type { HookContext, MantleApplication, ServiceParams } from "@mantlejs/mantle";
import { BadRequest, RepositoryService, mantle } from "@mantlejs/mantle";
import { MEMORY_OPERATORS, MemoryRepository } from "@mantlejs/memory";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { McpServerFactory } from "./mcp.js";
import { mcp } from "./mcp.js";
import { describeServiceMethod } from "./tools.js";
import type { McpCodeModeInput, McpCodeModeProvider, McpCodeModeSurface, McpOptions } from "./types.js";

/**
 * Phase 7 PRD spec 1 / checklist item 3: the `mode` option and the `McpCodeModeProvider`
 * extension point. The provider here is a stand-in for `@mantlejs/mcp-code` — it records its
 * input and contributes one tool + one resource, so the specs exercise only the wiring.
 */

interface User extends Record<string, unknown> {
  id?: string;
  name: string;
}

const USER_SCHEMA = {
  type: "object",
  properties: { id: { type: "string" }, name: { type: "string" } },
  required: ["name"],
};

const NOTES_SERVICE = {
  find: async () => [{ id: "n1", text: "hello" }],
  summarize: async (data: Record<string, unknown>) => ({ summary: `${String(data["text"] ?? "")}!` }),
};

interface RecordingProvider extends McpCodeModeProvider {
  inputs: McpCodeModeInput[];
}

function recordingProvider(surface?: Partial<McpCodeModeSurface>): RecordingProvider {
  const inputs: McpCodeModeInput[] = [];
  return {
    inputs,
    build(input) {
      inputs.push(input);
      return {
        tools: surface?.tools ?? [
          {
            name: "execute",
            description: "Run a script against the typed API.",
            inputSchema: { type: "object", properties: { code: { type: "string" } } },
            handler: async (args, { app, params }) => {
              const { path } = args as { path: string };
              return app.service(path).dispatch("find", undefined, undefined, params);
            },
          },
        ],
        resources: surface?.resources ?? [
          { uri: "mantle://code/api.d.ts", name: "Typed API", read: async () => "declare const mantle: {};" },
        ],
      };
    },
  };
}

function buildApp(options: McpOptions): MantleApplication {
  const app = mantle();
  app.configure(mcp(options));
  app.use("users", new RepositoryService<User>(new MemoryRepository<User>().seed([{ id: "u1", name: "Ada" }])), {
    schema: USER_SCHEMA,
  });
  app.use("notes", NOTES_SERVICE, { methods: ["find", "summarize"] });
  return app;
}

async function connect(app: MantleApplication, sessionParams?: ServiceParams): Promise<Client> {
  const factory = app.get<McpServerFactory>("mcp:server");
  const server = factory(sessionParams);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "spec-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function toolNames(app: MantleApplication): Promise<string[]> {
  const { tools } = await (await connect(app)).listTools();
  return tools.map((tool) => tool.name).sort();
}

const CUSTOM_TOOL = {
  name: "ping",
  description: "App-authored tool.",
  inputSchema: { type: "object" },
  handler: async () => "pong",
};

describe("mode resolution", () => {
  it('defaults to "tools" without a provider — today\'s behavior, unchanged', async () => {
    const app = buildApp({ services: { users: ["find", "get"] }, transport: "stdio" });
    expect(await toolNames(app)).toEqual(["users_find", "users_get"]);
  });

  it('defaults to "code" with a provider: generated tools suppressed, provider tools listed', async () => {
    const app = buildApp({ services: { users: ["find", "get"] }, transport: "stdio", codeMode: recordingProvider() });
    expect(await toolNames(app)).toEqual(["execute"]);
  });

  it('"both" lists the generated tools and the provider tools', async () => {
    const app = buildApp({
      services: { users: ["find", "get"] },
      transport: "stdio",
      mode: "both",
      codeMode: recordingProvider(),
    });
    expect(await toolNames(app)).toEqual(["execute", "users_find", "users_get"]);
  });

  it('explicit "tools" with a provider never calls the provider', async () => {
    const provider = recordingProvider();
    const app = buildApp({ services: { users: ["find"] }, transport: "stdio", mode: "tools", codeMode: provider });
    expect(await toolNames(app)).toEqual(["users_find"]);
    expect(provider.inputs).toHaveLength(0);
  });

  it("keeps app-authored tools, resources, and event resources in code mode", async () => {
    const app = buildApp({
      services: { users: true },
      transport: "stdio",
      events: true,
      tools: [CUSTOM_TOOL],
      resources: [{ uri: "mantle://docs/guide", name: "Guide", read: async () => "guide" }],
      codeMode: recordingProvider(),
    });
    const client = await connect(app);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["execute", "ping"]);
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri).sort()).toEqual([
      "mantle://code/api.d.ts",
      "mantle://docs/guide",
      "mantle://events/users",
    ]);
  });
});

describe("provider wiring", () => {
  it("serves provider tools through the session params — inner dispatch runs the hook pipeline", async () => {
    const seen: Array<string | undefined> = [];
    const app = buildApp({ services: { users: ["find"] }, transport: "stdio", codeMode: recordingProvider() });
    app.service("users").hooks({
      before: {
        find: [
          (ctx: HookContext): HookContext => {
            seen.push(ctx.provider);
            return ctx;
          },
        ],
      },
    });
    const client = await connect(app);
    const result = await client.callTool({ name: "execute", arguments: { path: "users" } });
    const [first] = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(first.text)).toMatchObject({ data: [{ id: "u1", name: "Ada" }], total: 1 });
    expect(seen).toEqual(["mcp"]);
  });

  it("serves provider resources", async () => {
    const app = buildApp({ services: { users: ["find"] }, transport: "stdio", codeMode: recordingProvider() });
    const client = await connect(app);
    const { contents } = await client.readResource({ uri: "mantle://code/api.d.ts" });
    expect(contents[0]).toMatchObject({ text: "declare const mantle: {};", mimeType: "text/plain" });
  });

  it("hands the provider the resolved expose map, descriptors, and effective query limits", async () => {
    const provider = recordingProvider();
    const app = buildApp({
      services: { "/users": true, notes: ["summarize"] },
      transport: "stdio",
      query: { maxLimit: 40 },
      codeMode: provider,
    });
    await connect(app);

    expect(provider.inputs).toHaveLength(1);
    const [input] = provider.inputs;
    expect(input.app).toBe(app);
    expect(input.query).toEqual({ defaultLimit: 25, maxLimit: 40 });
    expect(input.services.map((service) => [service.path, service.methods])).toEqual([
      ["users", ["find", "get", "create", "update", "patch", "remove"]],
      ["notes", ["summarize"]],
    ]);
    const users = input.services[0];
    expect(users.descriptor.schema).toEqual(USER_SCHEMA);
    expect(users.descriptor.capabilities?.operators).toEqual([...MEMORY_OPERATORS]);
  });

  it('expands services: "*" before the provider sees it', async () => {
    const provider = recordingProvider();
    const app = buildApp({ services: "*", transport: "stdio", codeMode: provider });
    await connect(app);
    const [input] = provider.inputs;
    expect(input.services.map((service) => service.path)).toEqual(["users", "notes"]);
    expect(input.services[1].methods).toEqual(["find", "summarize"]);
  });

  it("builds the surface once, shared by every session", async () => {
    const provider = recordingProvider();
    const app = buildApp({ services: { users: ["find"] }, transport: "stdio", codeMode: provider });
    await connect(app);
    await connect(app, { provider: "mcp", headers: { authorization: "Bearer other" } });
    expect(provider.inputs).toHaveLength(1);
  });

  it("exposes describeServiceMethod — the same schema the generated tool lists", async () => {
    const provider = recordingProvider();
    const app = buildApp({
      services: { users: ["find", "patch"] },
      transport: "stdio",
      mode: "both",
      codeMode: provider,
    });
    const client = await connect(app);
    const { tools } = await client.listTools();
    const [input] = provider.inputs;
    for (const method of ["find", "patch"]) {
      const schema = describeServiceMethod(input.services[0].descriptor, method, input.query);
      const listed = tools.find((tool) => tool.name === schema.name);
      expect(listed?.description).toBe(schema.description);
      expect(listed?.inputSchema).toEqual(schema.inputSchema);
    }
  });
});

describe("boot validation", () => {
  it.each(["code", "both"] as const)('rejects mode "%s" without a provider at configure time', (mode) => {
    expect(() => mcp({ services: { users: true }, transport: "stdio", mode })).toThrow(BadRequest);
    expect(() => mcp({ services: { users: true }, transport: "stdio", mode })).toThrow(/requires a codeMode provider/);
  });

  it("rejects an unknown mode and a provider without build()", () => {
    expect(() => mcp({ services: { users: true }, transport: "stdio", mode: "sandbox" as never })).toThrow(BadRequest);
    expect(() =>
      mcp({ services: { users: true }, transport: "stdio", codeMode: {} as unknown as McpCodeModeProvider }),
    ).toThrow(BadRequest);
  });

  it("still rejects an unknown expose-map path in code mode, before the provider runs", () => {
    const provider = recordingProvider();
    const app = buildApp({ services: { ghosts: true }, transport: "stdio", codeMode: provider });
    expect(() => app.get<McpServerFactory>("mcp:server")()).toThrow(/ghosts/);
    expect(provider.inputs).toHaveLength(0);
  });

  it('rejects a provider tool colliding with a generated tool in "both" mode', () => {
    const provider = recordingProvider({ tools: [{ ...CUSTOM_TOOL, name: "users_find" }] });
    const app = buildApp({ services: { users: ["find"] }, transport: "stdio", mode: "both", codeMode: provider });
    const factory = app.get<McpServerFactory>("mcp:server");
    expect(() => factory()).toThrow(BadRequest);
    expect(() => factory()).toThrow(/Code-mode provider tool 'users_find' collides/);
  });

  it("rejects a provider tool colliding with an app-authored tool", () => {
    const provider = recordingProvider({ tools: [CUSTOM_TOOL] });
    const app = buildApp({
      services: { users: ["find"] },
      transport: "stdio",
      tools: [CUSTOM_TOOL],
      codeMode: provider,
    });
    expect(() => app.get<McpServerFactory>("mcp:server")()).toThrow(/'ping' collides/);
  });

  it("allows a provider tool named like a suppressed generated tool in code mode", async () => {
    const provider = recordingProvider({ tools: [{ ...CUSTOM_TOOL, name: "users_find" }] });
    const app = buildApp({ services: { users: ["find"] }, transport: "stdio", codeMode: provider });
    expect(await toolNames(app)).toEqual(["users_find"]);
  });

  it("rejects provider resources that duplicate an app resource or use the events namespace", () => {
    const duplicate = recordingProvider({
      resources: [{ uri: "mantle://docs/guide", name: "Dup", read: async () => "" }],
    });
    const dupApp = buildApp({
      services: { users: ["find"] },
      transport: "stdio",
      resources: [{ uri: "mantle://docs/guide", name: "Guide", read: async () => "guide" }],
      codeMode: duplicate,
    });
    expect(() => dupApp.get<McpServerFactory>("mcp:server")()).toThrow(/Duplicate code-mode provider resource URI/);

    const reserved = recordingProvider({
      resources: [{ uri: "mantle://events/users", name: "Ev", read: async () => "" }],
    });
    const reservedApp = buildApp({ services: { users: ["find"] }, transport: "stdio", codeMode: reserved });
    expect(() => reservedApp.get<McpServerFactory>("mcp:server")()).toThrow(/reserved mantle:\/\/events\//);
  });

  it("rejects a malformed provider tool", () => {
    const provider = recordingProvider({ tools: [{ ...CUSTOM_TOOL, name: "" }] });
    const app = buildApp({ services: { users: ["find"] }, transport: "stdio", codeMode: provider });
    expect(() => app.get<McpServerFactory>("mcp:server")()).toThrow(/code-mode provider tool needs a non-empty 'name'/);
  });
});
