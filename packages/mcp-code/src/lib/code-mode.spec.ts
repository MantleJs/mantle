import type { HookContext, MantleApplication, ServiceParams } from "@mantlejs/mantle";
import { BadRequest, RepositoryService, mantle } from "@mantlejs/mantle";
import { MemoryRepository } from "@mantlejs/memory";
import type { McpOptions, McpServerFactory } from "@mantlejs/mcp";
import { mcp } from "@mantlejs/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { CodeExecutionReport, CodeModeOptions } from "./code-mode.js";
import { API_RESOURCE_URI, codeMode } from "./code-mode.js";
import { supportsTypeScript } from "./strip-types.js";

/**
 * Phase 7 PRD specs 3–4 / checklist item 5: the `codeMode()` provider end to end through a real
 * MCP client — `search_api`, `execute`, the declaration resource, the bridge into the hook
 * pipeline, error shapes, and output notes.
 */

interface Article extends Record<string, unknown> {
  id?: string;
  title: string;
  tags: string[];
  status: "draft" | "published";
}

const ARTICLE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    status: { enum: ["draft", "published"] },
  },
  required: ["title", "tags", "status"],
};

const ARTICLES: Article[] = [
  { id: "a1", title: "Intro", tags: ["guide", "start"], status: "published" },
  { id: "a2", title: "Deep dive", tags: ["guide"], status: "published" },
  { id: "a3", title: "Draft", tags: ["wip"], status: "draft" },
];

function buildApp(options: { mcp?: Partial<McpOptions>; codeMode?: CodeModeOptions; seen?: ServiceParams[] } = {}) {
  const app = mantle();
  app.configure(
    mcp({
      services: { articles: true, authors: ["find"] },
      transport: "stdio",
      codeMode: codeMode(options.codeMode),
      ...options.mcp,
    }),
  );
  app.use("articles", new RepositoryService<Article>(new MemoryRepository<Article>().seed(ARTICLES)), {
    schema: ARTICLE_SCHEMA,
  });
  app.use("authors", new RepositoryService(new MemoryRepository().seed([{ id: "u1", name: "Ada" }])), {});
  if (options.seen) {
    const seen = options.seen;
    app.service("articles").hooks({
      before: {
        all: [
          (context: HookContext) => {
            seen.push(context.params);
            return context;
          },
        ],
      },
    });
  }
  return app;
}

async function connect(app: MantleApplication, sessionParams?: ServiceParams): Promise<Client> {
  const server = app.get<McpServerFactory>("mcp:server")(sessionParams);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "spec-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

interface ToolResponse {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResponse> {
  return (await client.callTool({ name, arguments: args })) as unknown as ToolResponse;
}

async function execute(client: Client, code: string): Promise<CodeExecutionReport> {
  const response = await call(client, "execute", { code });
  expect(response.isError, response.content[0]?.text).toBeUndefined();
  return JSON.parse(response.content[0]?.text ?? "null") as CodeExecutionReport;
}

async function executeError(client: Client, code: string): Promise<Record<string, unknown>> {
  const response = await call(client, "execute", { code });
  expect(response.isError).toBe(true);
  return JSON.parse(response.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("codeMode() — tool surface", () => {
  it("lists exactly search_api and execute in code mode", async () => {
    const { tools } = await (await connect(buildApp())).listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["execute", "search_api"]);
  });

  it("serves the declaration module as a resource", async () => {
    const client = await connect(buildApp());
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toContain(API_RESOURCE_URI);
    const { contents } = await client.readResource({ uri: API_RESOURCE_URI });
    const text = (contents[0] as { text: string }).text;
    expect(text).toContain("declare const mantle: {");
    expect(text).toContain("  articles: {");
    expect(text).toContain("  authors: {");
  });

  it("rejects invalid limits at configure time", () => {
    expect(() => codeMode({ limits: { maxCalls: 0 } })).toThrow(BadRequest);
    expect(() => codeMode({ limits: { timeoutMs: 1.5 } })).toThrow(BadRequest);
  });
});

describe("codeMode() — search_api", () => {
  it("returns a one-line index with no arguments", async () => {
    const response = await call(await connect(buildApp()), "search_api", {});
    const text = JSON.parse(response.content[0]?.text ?? '""') as string;
    expect(text).toContain("articles — find, get, create, update, patch, remove");
    expect(text).toContain("authors — find");
    expect(text).not.toContain("declare const");
  });

  it("returns declarations filtered by keyword", async () => {
    const response = await call(await connect(buildApp()), "search_api", { query: "authors" });
    const text = JSON.parse(response.content[0]?.text ?? '""') as string;
    expect(text).toContain("  authors: {");
    expect(text).not.toContain("  articles: {");
  });

  it("returns declarations filtered by exact path", async () => {
    const response = await call(await connect(buildApp()), "search_api", { paths: ["articles"] });
    const text = JSON.parse(response.content[0]?.text ?? '""') as string;
    expect(text).toContain("type ArticlesRecord");
    expect(text).not.toContain("authors");
  });
});

describe("codeMode() — execute", () => {
  it("runs a multi-call script with in-script aggregation and returns only the answer", async () => {
    const client = await connect(buildApp());
    const report = await execute(
      client,
      `const { data } = await mantle.articles.find({ where: { status: "published" }, select: ["id", "tags"] });
       const authors = await mantle.authors.find();
       const counts = {};
       for (const a of data) for (const t of a.tags) counts[t] = (counts[t] ?? 0) + 1;
       console.log("articles", data.length);
       return { counts, authors: authors.data.length };`,
    );
    expect(report.result).toEqual({ counts: { guide: 2, start: 1 }, authors: 1 });
    expect(report.calls).toBe(2);
    expect(report.logs).toEqual(["[log] articles 2"]);
    expect(report.executionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("supports every CRUD method through the bridge", async () => {
    const client = await connect(buildApp());
    const report = await execute(
      client,
      `const created = await mantle.articles.create({ title: "New", tags: [], status: "draft" });
       await mantle.articles.patch(created.id, { status: "published" });
       const updated = await mantle.articles.update(created.id, { title: "Renamed", tags: ["x"], status: "published" });
       const fetched = await mantle.articles.get(created.id, { select: ["title"] });
       const removed = await mantle.articles.remove(created.id);
       return { title: updated.title, fetched: fetched.title, removed: removed.id === created.id };`,
    );
    expect(report.result).toEqual({ title: "Renamed", fetched: "Renamed", removed: true });
    expect(report.calls).toBe(5);
  });

  it("lets the script catch a service error and branch on its name", async () => {
    const report = await execute(
      await connect(buildApp()),
      `try { await mantle.articles.get("missing"); } catch (e) { return { name: e.name, code: e.code }; }`,
    );
    expect(report.result).toEqual({ name: "NotFound", code: 404 });
  });

  it("returns an uncaught service error as a tool error with the MantleError shape plus execution details", async () => {
    const error = await executeError(
      await connect(buildApp()),
      `console.log("before"); await mantle.articles.get("missing");`,
    );
    expect(error).toMatchObject({ name: "NotFound", code: 404, className: "not-found" });
    expect(error["data"]).toMatchObject({ execution: { calls: 1, logs: ["[log] before"] } });
  });

  it("returns a script bug as CodeScriptError", async () => {
    const error = await executeError(await connect(buildApp()), "return mantle.articles.nope();");
    expect(error).toMatchObject({ name: "CodeScriptError", code: 422 });
  });

  it("rejects an empty script", async () => {
    const error = await executeError(await connect(buildApp()), "   ");
    expect(error).toMatchObject({ name: "BadRequest" });
  });

  it("clamps find limits exactly like tool mode and reports the truncation note", async () => {
    const client = await connect(buildApp({ mcp: { query: { defaultLimit: 1, maxLimit: 2 } } }));
    const report = await execute(
      client,
      "const page = await mantle.articles.find({ limit: 50 }); return page.data.length;",
    );
    expect(report.result).toBe(2);
    expect(report.notes?.[0]).toContain("articles.find: Returned 2 of 3 records.");
  });

  it("puts code-mode metadata on params.mcp for every bridged call, fresh params per call", async () => {
    const seen: ServiceParams[] = [];
    const client = await connect(buildApp({ seen }));
    const code = "await mantle.articles.find(); await mantle.articles.get('a1'); return 1;";
    const report = await execute(client, code);
    expect(seen).toHaveLength(2);
    for (const params of seen) {
      expect(params["provider"]).toBe("mcp");
      expect(params["mcp"]).toEqual({
        mode: "code",
        executionId: report.executionId,
        scriptHash: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      });
    }
    expect(seen[0]).not.toBe(seen[1]);
    // A second execution gets its own id.
    const second = await execute(client, "return 2;");
    expect(second.executionId).not.toBe(report.executionId);
  });

  it("includes the full script in params.mcp only with auditScriptSource", async () => {
    const seen: ServiceParams[] = [];
    const client = await connect(buildApp({ seen, codeMode: { auditScriptSource: true } }));
    const code = "return (await mantle.articles.find()).total;";
    await execute(client, code);
    expect((seen[0]?.["mcp"] as { script?: string }).script).toBe(code);
  });

  it("passes the session's identity to every call", async () => {
    const seen: ServiceParams[] = [];
    const client = await connect(buildApp({ seen }), { user: { id: "u1" }, headers: { authorization: "Bearer t" } });
    await execute(client, "await mantle.articles.find(); return 1;");
    expect(seen[0]?.user).toEqual({ id: "u1" });
    expect(seen[0]?.headers).toEqual({ authorization: "Bearer t" });
  });

  it.runIf(supportsTypeScript())("accepts TypeScript annotations and rejects enum with a hint", async () => {
    const client = await connect(buildApp());
    const report = await execute(
      client,
      "interface Tally { [tag: string]: number }\nconst t: Tally = {};\nconst n: number = (await mantle.articles.find()).total;\nreturn n as number;",
    );
    expect(report.result).toBe(3);
    const error = await executeError(client, "enum Color { Red }\nreturn 1;");
    expect(error).toMatchObject({ name: "BadRequest" });
    expect(String(error["hint"])).toContain("enum");
  });

  it("enforces configured limits", async () => {
    const client = await connect(buildApp({ codeMode: { limits: { maxCalls: 1 } } }));
    const error = await executeError(client, "await mantle.authors.find(); await mantle.authors.find();");
    expect(error).toMatchObject({ name: "CodeLimitExceeded" });
  });
});
