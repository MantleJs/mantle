import type { HookContext, MantleApplication } from "@mantlejs/mantle";
import { RepositoryService, mantle } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";
import { MemoryRepository } from "@mantlejs/memory";
import { auth, authorizeAgent } from "@mantlejs/auth";
import type { AuthEngine } from "@mantlejs/auth";
import { describe, expect, it } from "vitest";
import { mcp } from "./mcp.js";

/**
 * PRD spec 10 / checklist item 5: `HookContext.agent` must populate correctly end-to-end through
 * `@mantlejs/mcp`'s existing dispatch path — an agent-token call reaching a service through the
 * MCP transport must run through the exact same `authorizeAgent()` hook, and hit the exact same
 * accept/deny decision, as the same call made over REST. No MCP-specific code exists for this: the
 * transport just forwards `Authorization` through `params.headers`, same as any other provider.
 */

interface Article extends Record<string, unknown> {
  id?: string;
  title: string;
}

type FetchHandler = (request: Request) => Promise<Response>;

interface JsonRpcResponse {
  jsonrpc: string;
  id?: unknown;
  result?: { content?: Array<{ type: string; text: string }>; isError?: boolean };
}

function buildApp(observed: HookContext[] = []): { app: MantleApplication; engine: AuthEngine } {
  const app = mantle();
  app.configure(http());
  app.configure(auth({ secret: "test-secret" }));
  app.configure(mcp({ services: { articles: true }, transport: "http" }));
  app.use(
    "articles",
    new RepositoryService<Article>(new MemoryRepository<Article>().seed([{ id: "a1", title: "Hello" }])),
    {},
  );
  app.service("articles").hooks({
    before: {
      all: [authorizeAgent()],
      find: [
        (ctx: HookContext): HookContext => {
          observed.push(ctx);
          return ctx;
        },
      ],
    },
  });
  const engine = app.get<AuthEngine>("auth");
  return { app, engine };
}

async function getRest(app: MantleApplication, headers: Record<string, string> = {}): Promise<Response> {
  const fetchHandler = app.get<FetchHandler>("fetchHandler");
  return fetchHandler(new Request("http://localhost/articles", { headers }));
}

async function callMcpTool(app: MantleApplication, headers: Record<string, string> = {}): Promise<Response> {
  const fetchHandler = app.get<FetchHandler>("fetchHandler");
  return fetchHandler(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "articles_find", arguments: {} } }),
    }),
  );
}

function mcpToolError(body: JsonRpcResponse): Record<string, unknown> {
  expect(body.result?.isError).toBe(true);
  return JSON.parse(body.result?.content?.[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("authorizeAgent() through @mantlejs/mcp's dispatch path", () => {
  it("rejects with 403 (out-of-scope) identically on both transports", async () => {
    const { app, engine } = buildApp();
    const issued = await engine.issueAgentToken({ articles: ["get"] }, "user-1");
    const headers = { authorization: `Bearer ${issued.accessToken}` };

    const restRes = await getRest(app, headers);
    expect(restRes.status).toBe(403);

    const mcpRes = await callMcpTool(app, headers);
    const mcpError = mcpToolError((await mcpRes.json()) as JsonRpcResponse);
    expect(mcpError["code"]).toBe(403);
  });

  it("accepts (in-scope) identically on both transports and populates HookContext.agent", async () => {
    const observed: HookContext[] = [];
    const { app, engine } = buildApp(observed);
    const issued = await engine.issueAgentToken({ articles: ["find"] }, "user-42");
    const headers = { authorization: `Bearer ${issued.accessToken}` };

    const restRes = await getRest(app, headers);
    expect(restRes.status).toBe(200);
    const restBody = (await restRes.json()) as { data: Article[] };
    expect(restBody.data).toMatchObject([{ title: "Hello" }]);

    const mcpRes = await callMcpTool(app, headers);
    const mcpBody = (await mcpRes.json()) as JsonRpcResponse;
    expect(mcpBody.result?.isError).toBeUndefined();
    const mcpData = JSON.parse(mcpBody.result?.content?.[0]?.text ?? "{}") as { data: Article[] };
    expect(mcpData.data).toMatchObject([{ title: "Hello" }]);

    // Same accept decision on both calls; both populated HookContext.agent identically, with the
    // provider tag the only recorded difference.
    expect(observed).toHaveLength(2);
    for (const ctx of observed) {
      expect(ctx.agent).toEqual({ id: issued.id, scope: { articles: ["find"] }, delegatingUserId: "user-42" });
    }
    expect(observed[0]?.provider).not.toBe(observed[1]?.provider);
    expect(observed[1]?.provider).toBe("mcp");
  });
});
