import type { HookContext, MantleApplication } from "@mantlejs/mantle";
import { Forbidden, RepositoryService, mantle } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";
import { MemoryRepository } from "@mantlejs/memory";
import { authenticate } from "@mantlejs/auth";
import { describe, expect, it } from "vitest";
import { mcp } from "./mcp.js";

/**
 * PRD spec 3 / checklist item 2: does an MCP-originated call and an HTTP-originated call against
 * the same service run through *identical* `authenticate`/`authorize` hooks, differing only in
 * `HookContext.provider`? This registers one service with a real `authenticate("jwt")` hook (from
 * `@mantlejs/auth` — not a stand-in) plus a small authorization hook, and calls it once via REST
 * and once via MCP with equivalent credentials for three cases: no credentials, wrong role, and
 * the right role.
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

/** The duck-typed surface `authenticate("jwt")` and `mcp()` both read from `app.get("auth")`. */
const FAKE_ENGINE = {
  verifyJwt(token: string): Record<string, unknown> {
    if (token === "admin-token") return { sub: "1", role: "admin" };
    if (token === "member-token") return { sub: "2", role: "member" };
    throw new Error("invalid token");
  },
};

/** One entry per call reaching the hook chain — proves the two providers hit the same code path,
 * tagged with a different transport identifier, rather than two independent implementations. */
type Observation = { provider: string | undefined; paramsProvider: string | undefined };

function requireAdmin(observations: Observation[]) {
  return (context: HookContext): HookContext => {
    observations.push({ provider: context.provider, paramsProvider: context.params.provider });
    if ((context.params.user as { role?: string } | undefined)?.role !== "admin") {
      throw new Forbidden("Admin role required");
    }
    return context;
  };
}

function buildApp(observations: Observation[]): MantleApplication {
  const app = mantle();
  app.configure(http());
  app.configure(mcp({ services: { articles: true }, transport: "http" }));
  app.set("auth", FAKE_ENGINE);
  app.use(
    "articles",
    new RepositoryService<Article>(new MemoryRepository<Article>().seed([{ id: "a1", title: "Hello" }])),
    {},
  );
  app.service("articles").hooks({
    before: { all: [authenticate("jwt"), requireAdmin(observations)] },
  });
  return app;
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

describe("MCP vs HTTP hook-pipeline equivalence", () => {
  it("rejects with 401 (no credentials) identically on both transports", async () => {
    const observations: Observation[] = [];
    const app = buildApp(observations);

    const restRes = await getRest(app);
    expect(restRes.status).toBe(401);

    const mcpRes = await callMcpTool(app);
    expect(mcpRes.status).toBe(200); // tool errors are in-band, not a transport error
    const mcpError = mcpToolError((await mcpRes.json()) as JsonRpcResponse);
    expect(mcpError["code"]).toBe(401);

    // Neither call reached requireAdmin — authenticate("jwt") rejected both before it ran.
    expect(observations).toEqual([]);
  });

  it("rejects with 403 (wrong role) identically on both transports", async () => {
    const observations: Observation[] = [];
    const app = buildApp(observations);

    const restRes = await getRest(app, { authorization: "Bearer member-token" });
    expect(restRes.status).toBe(403);

    const mcpRes = await callMcpTool(app, { authorization: "Bearer member-token" });
    const mcpError = mcpToolError((await mcpRes.json()) as JsonRpcResponse);
    expect(mcpError["code"]).toBe(403);

    // Both calls reached the same authorization hook and were rejected there — same decision,
    // only the provider tag differs.
    expect(observations).toHaveLength(2);
    expect(observations[0]?.provider).toBe(observations[0]?.paramsProvider);
    expect(observations[1]?.provider).toBe(observations[1]?.paramsProvider);
    expect(observations[0]?.provider).not.toBe(observations[1]?.provider);
  });

  it("accepts (admin role) identically on both transports, with the same data", async () => {
    const observations: Observation[] = [];
    const app = buildApp(observations);

    const restRes = await getRest(app, { authorization: "Bearer admin-token" });
    expect(restRes.status).toBe(200);
    const restBody = (await restRes.json()) as { data: Article[] };
    expect(restBody.data).toMatchObject([{ title: "Hello" }]);

    const mcpRes = await callMcpTool(app, { authorization: "Bearer admin-token" });
    const mcpBody = (await mcpRes.json()) as JsonRpcResponse;
    expect(mcpBody.result?.isError).toBeUndefined();
    const mcpData = JSON.parse(mcpBody.result?.content?.[0]?.text ?? "{}") as { data: Article[] };
    expect(mcpData.data).toMatchObject([{ title: "Hello" }]);

    // Same accept decision on both calls — the only recorded difference is the provider tag.
    expect(observations).toHaveLength(2);
    const [restObservation, mcpObservation] = observations;
    expect(restObservation?.provider).toBe(restObservation?.paramsProvider);
    expect(mcpObservation?.provider).toBe(mcpObservation?.paramsProvider);
    expect(restObservation?.provider).not.toBe(mcpObservation?.provider);
    expect(mcpObservation?.provider).toBe("mcp");
  });
});
