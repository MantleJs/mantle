import type { HookContext, MantleApplication } from "@mantlejs/mantle";
import { NotAuthenticated, RepositoryService, mantle } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";
import { MemoryRepository } from "@mantlejs/memory";
import { describe, expect, it } from "vitest";
import { mcp } from "./mcp.js";

interface User extends Record<string, unknown> {
  id?: string;
  name: string;
}

type FetchHandler = (request: Request) => Promise<Response>;

interface JsonRpcResponse {
  jsonrpc: string;
  id?: unknown;
  result?: { content?: Array<{ type: string; text: string }>; isError?: boolean; tools?: Array<{ name: string }> };
  error?: { code: number; message: string };
}

/** The duck-typed surface `mcp()` reads from `app.get("auth")` — mirrors @mantlejs/auth's engine. */
const FAKE_ENGINE = {
  verifyJwt(token: string): Record<string, unknown> {
    if (token !== "good-token") throw new Error("invalid token");
    return { sub: "user-1", name: "Agent Smith" };
  },
};

function buildHttpApp(withAuthHook: boolean): { app: MantleApplication; seenUser: () => unknown } {
  const app = mantle();
  app.configure(http());
  app.configure(mcp({ services: { users: true }, transport: "http" }));
  app.set("auth", FAKE_ENGINE);

  let user: unknown;
  app.use("users", new RepositoryService<User>(new MemoryRepository<User>().seed([{ id: "u1", name: "Neo" }])), {});
  app.service("users").hooks({
    before: {
      all: [
        (context: HookContext) => {
          if (withAuthHook && context.params.provider && context.params.user === undefined) {
            throw new NotAuthenticated("Login required", undefined, undefined, "Pass Authorization: Bearer <token>");
          }
          user = context.params.user;
          return context;
        },
      ],
    },
  });
  return { app, seenUser: () => user };
}

async function post(app: MantleApplication, message: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const fetchHandler = app.get<FetchHandler>("fetchHandler");
  return fetchHandler(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(message),
    }),
  );
}

const callToolMessage = (id: number, name: string, args: Record<string, unknown> = {}): unknown => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

describe("mcp over the http:router contract", () => {
  it("serves tools/list to a stateless POST without a prior initialize", async () => {
    const { app } = buildHttpApp(false);
    const response = await post(app, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as JsonRpcResponse;
    expect(body.id).toBe(1);
    expect(body.result?.tools?.map((tool) => tool.name)).toContain("users_find");
  });

  it("resolves a valid bearer token into params.user for the tool call", async () => {
    const { app, seenUser } = buildHttpApp(true);
    const response = await post(app, callToolMessage(2, "users_find"), { authorization: "Bearer good-token" });
    const body = (await response.json()) as JsonRpcResponse;
    expect(body.result?.isError).toBeUndefined();
    expect(seenUser()).toMatchObject({ sub: "user-1" });
  });

  it("returns a 401-shaped tool error when the auth hook rejects an anonymous session", async () => {
    const { app } = buildHttpApp(true);
    const response = await post(app, callToolMessage(3, "users_find"));
    expect(response.status).toBe(200); // tool errors are in-band, not transport errors
    const body = (await response.json()) as JsonRpcResponse;
    expect(body.result?.isError).toBe(true);
    const error = JSON.parse(body.result?.content?.[0]?.text ?? "{}") as Record<string, unknown>;
    expect(error["code"]).toBe(401);
    expect(error["hint"]).toContain("Bearer");
  });

  it("treats an invalid bearer token as anonymous — per-service hooks decide", async () => {
    const { app } = buildHttpApp(true);
    const response = await post(app, callToolMessage(4, "users_find"), { authorization: "Bearer forged" });
    const body = (await response.json()) as JsonRpcResponse;
    expect(body.result?.isError).toBe(true);
    const error = JSON.parse(body.result?.content?.[0]?.text ?? "{}") as Record<string, unknown>;
    expect(error["code"]).toBe(401);
  });

  it("answers initialize directly (no synthetic handshake needed)", async () => {
    const { app } = buildHttpApp(false);
    const response = await post(app, {
      jsonrpc: "2.0",
      id: 5,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "0" } },
    });
    const body = (await response.json()) as JsonRpcResponse;
    expect(body.result).toMatchObject({ serverInfo: { name: "mantle" } });
  });

  it("accepts notifications with a 202 and no JSON-RPC response", async () => {
    const { app } = buildHttpApp(false);
    const response = await post(app, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(response.status).toBe(202);
  });

  it("rejects a GET (no SSE stream) with 405", async () => {
    const { app } = buildHttpApp(false);
    const fetchHandler = app.get<FetchHandler>("fetchHandler");
    const response = await fetchHandler(new Request("http://localhost/mcp", { method: "GET" }));
    expect(response.status).toBe(405);
  });

  it("rejects JSON-RPC batches and malformed bodies", async () => {
    const { app } = buildHttpApp(false);
    const batch = (await (await post(app, [callToolMessage(6, "users_find")])).json()) as JsonRpcResponse;
    expect(batch.error?.code).toBe(-32600);
    const malformed = (await (await post(app, { hello: "world" })).json()) as JsonRpcResponse;
    expect(malformed.error?.code).toBe(-32600);
  });

  it("fails listen() when the expose map names an unknown service", () => {
    const app = mantle();
    app.configure(http());
    app.configure(mcp({ services: { ghosts: true }, transport: "http" }));
    expect(() => app.emit("http:server", {})).toThrow(/ghosts/);
  });

  it("requires an HTTP transport to be configured first", () => {
    const app = mantle();
    expect(() => app.configure(mcp({ services: "*", transport: "http" }))).toThrow(/HTTP transport/);
  });
});
