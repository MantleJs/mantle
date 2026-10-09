import { createHash } from "node:crypto";
import type { AuditRecord } from "@mantlejs/audit";
import { auditLog } from "@mantlejs/audit";
import type { AuthEngine } from "@mantlejs/auth";
import { auth, authenticate, authorizeAgent } from "@mantlejs/auth";
import { http } from "@mantlejs/http";
import type { HookContext, MantleApplication } from "@mantlejs/mantle";
import { Forbidden, RepositoryService, mantle } from "@mantlejs/mantle";
import { MemoryRepository } from "@mantlejs/memory";
import { mcp } from "@mantlejs/mcp";
import { describe, expect, it } from "vitest";
import type { CodeExecutionReport } from "./code-mode.js";
import { codeMode } from "./code-mode.js";

/**
 * Phase 7 PRD spec 5 / checklist item 6: code mode keeps @mantlejs/mcp's no-bypass guarantee.
 * Every case runs through real transports — HTTP REST, MCP tool mode, and MCP code mode on one
 * app (`mode: "both"`) — with real `authenticate("jwt")`, `authorizeAgent()`, and `auditLog()`
 * hooks. Sandbox escape and limit behavior is covered by the executor conformance suite
 * (quickjs-executor.spec.ts); here the boundary is checked end to end through `execute`.
 */

interface Article extends Record<string, unknown> {
  id?: string;
  title: string;
}

type FetchHandler = (request: Request) => Promise<Response>;

interface JsonRpcResponse {
  result?: { content?: Array<{ type: string; text: string }>; isError?: boolean };
}

const SEED: Article[] = [
  { id: "a1", title: "Hello" },
  { id: "a2", title: "World" },
];

async function rest(app: MantleApplication, path: string, headers: Record<string, string> = {}): Promise<Response> {
  return app.get<FetchHandler>("fetchHandler")(new Request(`http://localhost${path}`, { headers }));
}

async function tool(
  app: MantleApplication,
  name: string,
  args: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ isError: boolean; body: unknown }> {
  const response = await app.get<FetchHandler>("fetchHandler")(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }),
  );
  const json = (await response.json()) as JsonRpcResponse;
  return { isError: json.result?.isError === true, body: JSON.parse(json.result?.content?.[0]?.text ?? "null") };
}

async function execute(
  app: MantleApplication,
  code: string,
  headers: Record<string, string> = {},
): Promise<{ isError: boolean; body: unknown }> {
  return tool(app, "execute", { code }, headers);
}

describe("hook-pipeline equivalence: HTTP vs MCP tool mode vs MCP code mode", () => {
  const FAKE_ENGINE = {
    verifyJwt(token: string): Record<string, unknown> {
      if (token === "admin-token") return { sub: "1", role: "admin" };
      if (token === "member-token") return { sub: "2", role: "member" };
      throw new Error("invalid token");
    },
  };

  type Observation = { provider: string | undefined; mode: unknown };

  function buildApp(observations: Observation[]): MantleApplication {
    const app = mantle();
    app.configure(http());
    app.configure(mcp({ services: { articles: true }, transport: "http", mode: "both", codeMode: codeMode() }));
    app.set("auth", FAKE_ENGINE);
    app.use("articles", new RepositoryService<Article>(new MemoryRepository<Article>().seed(SEED)), {});
    app.service("articles").hooks({
      before: {
        all: [
          authenticate("jwt"),
          (context: HookContext) => {
            observations.push({
              provider: context.provider,
              mode: (context.params["mcp"] as { mode?: string } | undefined)?.mode,
            });
            if ((context.params.user as { role?: string } | undefined)?.role !== "admin") {
              throw new Forbidden("Admin role required");
            }
            return context;
          },
        ],
      },
    });
    return app;
  }

  const SCRIPT = "return await mantle.articles.find();";

  it("rejects with 401 (no credentials) identically on all three channels", async () => {
    const observations: Observation[] = [];
    const app = buildApp(observations);

    expect((await rest(app, "/articles")).status).toBe(401);
    const viaTool = await tool(app, "articles_find", {});
    const viaCode = await execute(app, SCRIPT);

    expect(viaTool).toMatchObject({ isError: true, body: { name: "NotAuthenticated", code: 401 } });
    expect(viaCode).toMatchObject({ isError: true, body: { name: "NotAuthenticated", code: 401 } });
    expect(observations).toEqual([]); // authenticate("jwt") rejected all three before the next hook
  });

  it("rejects with 403 (wrong role) identically on all three channels, at the same hook", async () => {
    const observations: Observation[] = [];
    const app = buildApp(observations);
    const headers = { authorization: "Bearer member-token" };

    expect((await rest(app, "/articles", headers)).status).toBe(403);
    expect(await tool(app, "articles_find", {}, headers)).toMatchObject({
      isError: true,
      body: { name: "Forbidden", code: 403, message: "Admin role required" },
    });
    expect(await execute(app, SCRIPT, headers)).toMatchObject({
      isError: true,
      body: { name: "Forbidden", code: 403, message: "Admin role required" },
    });
    // The same rejection is catchable inside a script.
    expect(
      await execute(
        app,
        "try { await mantle.articles.find(); } catch (e) { return [e.name, e.code, e.message]; }",
        headers,
      ),
    ).toMatchObject({ isError: false, body: { result: ["Forbidden", 403, "Admin role required"] } });

    expect(observations.map((o) => [o.provider, o.mode])).toEqual([
      ["http", undefined],
      ["mcp", undefined],
      ["mcp", "code"],
      ["mcp", "code"],
    ]);
  });

  it("accepts (admin role) identically on all three channels, returning the same data", async () => {
    const observations: Observation[] = [];
    const app = buildApp(observations);
    const headers = { authorization: "Bearer admin-token" };

    const viaRest = (await (await rest(app, "/articles", headers)).json()) as { data: Article[] };
    const viaTool = await tool(app, "articles_find", {}, headers);
    const viaCode = await execute(app, SCRIPT, headers);

    expect(viaTool.isError).toBe(false);
    expect(viaCode.isError).toBe(false);
    expect((viaTool.body as { data: Article[] }).data).toEqual(viaRest.data);
    expect(((viaCode.body as CodeExecutionReport).result as { data: Article[] }).data).toEqual(viaRest.data);
    expect(observations.map((o) => o.provider)).toEqual(["http", "mcp", "mcp"]);
  });
});

describe("agent capability scopes", () => {
  async function buildApp(): Promise<{ app: MantleApplication; engine: AuthEngine }> {
    const app = mantle();
    app.configure(http());
    app.configure(auth({ secret: "test-secret" }));
    app.configure(
      mcp({ services: { articles: true, authors: ["find"] }, transport: "http", mode: "both", codeMode: codeMode() }),
    );
    app.use("articles", new RepositoryService<Article>(new MemoryRepository<Article>().seed(SEED)), {});
    app.use("authors", new RepositoryService(new MemoryRepository().seed([{ id: "u1" }])), {});
    app.service("articles").hooks({ before: { all: [authorizeAgent()] } });
    app.service("authors").hooks({ before: { all: [authorizeAgent()] } });
    return { app, engine: app.get<AuthEngine>("auth") };
  }

  it("lets an in-scope call through and throws a catchable Forbidden matching authorizeAgent()'s denial", async () => {
    const { app, engine } = await buildApp();
    const token = await engine.issueAgentToken({ articles: ["find"] }, "user-1");
    const headers = { authorization: `Bearer ${token.accessToken}` };

    const outcome = await execute(
      app,
      `const page = await mantle.articles.find();
       try { await mantle.articles.remove("a1"); } catch (e) { return { found: page.total, denied: [e.name, e.code, e.message] }; }`,
      headers,
    );
    const expectedMessage = `Agent '${token.id}' is not authorized to call 'remove' on 'articles'`;
    expect(outcome).toMatchObject({
      isError: false,
      body: { result: { found: 2, denied: ["Forbidden", 403, expectedMessage] } },
    });

    // Identical to tool mode's denial for the same token and method.
    expect(await tool(app, "articles_remove", { id: "a1" }, headers)).toMatchObject({
      isError: true,
      body: { name: "Forbidden", code: 403, message: expectedMessage },
    });
    // And the record really was not removed.
    expect(await app.service("articles").get("a1")).toMatchObject({ id: "a1" });
  });

  it("narrows the declarations an agent session sees to its scope (display only)", async () => {
    const { app, engine } = await buildApp();
    const token = await engine.issueAgentToken({ articles: ["find", "get"] }, "user-1");
    const headers = { authorization: `Bearer ${token.accessToken}` };

    const index = (await tool(app, "search_api", {}, headers)).body as string;
    expect(index).toContain("articles — find, get");
    expect(index).not.toContain("authors");

    const declarations = (await tool(app, "search_api", { paths: ["articles", "authors"] }, headers)).body as string;
    expect(declarations).toContain("    find(");
    expect(declarations).not.toContain("    remove(");
    expect(declarations).not.toContain("  authors:");
  });

  it("shows the full exposed API to a non-agent session, and to a revoked agent token", async () => {
    const { app, engine } = await buildApp();
    expect((await tool(app, "search_api", {})).body as string).toContain(
      "articles — find, get, create, update, patch, remove",
    );

    const token = await engine.issueAgentToken({ articles: ["find"] }, "user-1");
    await engine.revokeAgentToken(token.id);
    const headers = { authorization: `Bearer ${token.accessToken}` };
    expect((await tool(app, "search_api", {}, headers)).body as string).toContain("authors — find");
    // Display widens, enforcement doesn't: the revoked token is still rejected by the hook.
    expect(await execute(app, "return await mantle.articles.find();", headers)).toMatchObject({
      isError: true,
      body: { name: "NotAuthenticated", code: 401 },
    });
  });
});

describe("audit", () => {
  function buildApp(sink: MemoryRepository<AuditRecord>, auditScriptSource = false): MantleApplication {
    const app = mantle();
    app.configure(http());
    app.configure(auth({ secret: "test-secret" }));
    app.configure(mcp({ services: { articles: true }, transport: "http", codeMode: codeMode({ auditScriptSource }) }));
    app.use("articles", new RepositoryService<Article>(new MemoryRepository<Article>().seed(SEED)), {});
    const audit = auditLog({ sink });
    app.service("articles").hooks({
      before: { all: [authorizeAgent()] },
      after: { all: [audit] },
      error: { all: [audit] },
    });
    return app;
  }

  it("records exactly one entry per bridged call, all sharing the execution id and script hash", async () => {
    const sink = new MemoryRepository<AuditRecord>();
    const app = buildApp(sink);
    const engine = app.get<AuthEngine>("auth");
    const token = await engine.issueAgentToken({ articles: ["find", "get", "remove"] }, "user-1");
    const code = `await mantle.articles.find();
await mantle.articles.get("a2");
try { await mantle.articles.get("missing"); } catch {}
return "done";`;

    const outcome = await execute(app, code, { authorization: `Bearer ${token.accessToken}` });
    expect(outcome.isError).toBe(false);
    const report = outcome.body as CodeExecutionReport;

    const records = await sink.findAll();
    expect(records).toHaveLength(3);
    expect(records.map((r) => [r.method, r.status])).toEqual([
      ["find", "success"],
      ["get", "success"],
      ["get", "error"],
    ]);
    const scriptHash = createHash("sha256").update(code).digest("hex");
    for (const record of records) {
      expect(record.mcp).toEqual({ mode: "code", executionId: report.executionId, scriptHash });
      expect(record).toMatchObject({ agentId: token.id, delegatingUserId: "user-1" });
    }
    // "What did this script do" is one query against the sink.
    expect(await sink.findAll({ where: { "mcp.executionId": report.executionId } })).toHaveLength(3);
  });

  it("records the full script only when auditScriptSource is enabled", async () => {
    const sink = new MemoryRepository<AuditRecord>();
    const app = buildApp(sink, true);
    const token = await app.get<AuthEngine>("auth").issueAgentToken({ articles: ["find"] }, "user-1");
    const code = "return (await mantle.articles.find()).total;";
    await execute(app, code, { authorization: `Bearer ${token.accessToken}` });
    const [record] = await sink.findAll();
    expect((record?.mcp as { script?: string } | undefined)?.script).toBe(code);
  });
});

describe("expose map is the hard boundary", () => {
  it("never reaches an unexposed method or service, even one that is registered", async () => {
    const app = mantle();
    app.configure(http());
    app.configure(mcp({ services: { articles: ["find"] }, transport: "http", codeMode: codeMode() }));
    app.use("articles", new RepositoryService<Article>(new MemoryRepository<Article>().seed(SEED)), {});
    app.use("secrets", new RepositoryService(new MemoryRepository().seed([{ id: "s1", value: "hunter2" }])), {});

    const probe = await execute(
      app,
      "return [typeof mantle.articles.remove, typeof mantle.secrets, Object.keys(mantle), typeof app, typeof globalThis.app];",
    );
    expect(probe).toMatchObject({
      isError: false,
      body: { result: ["undefined", "undefined", ["articles"], "undefined", "undefined"] },
    });
    expect(await execute(app, "await mantle.articles.remove('a1');")).toMatchObject({
      isError: true,
      body: { name: "CodeScriptError" },
    });
    expect(await app.service("articles").get("a1")).toMatchObject({ id: "a1" });
  });
});
