import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

/**
 * Pins the @modelcontextprotocol/sdk behavior Phase 8 specs 9–11 rely on (spike 3), against the
 * low-level `Server` that `createMcpServer()` uses. If an SDK upgrade changes any of this, these fail
 * before the features built on them do.
 */
async function connect(server: Server): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "spike-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function makeServer(onCall: (meta: Record<string, unknown> | undefined) => void): Server {
  const server = new Server({ name: "spike", version: "0.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "users_create",
        inputSchema: { type: "object" as const },
        annotations: {
          title: "Create a user",
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    onCall(request.params._meta as Record<string, unknown> | undefined);
    return { content: [{ type: "text" as const, text: "ok" }] };
  });
  return server;
}

describe("MCP SDK mechanics (spike 3)", () => {
  it("passes tool annotations from a low-level tools/list handler through to the client", async () => {
    const client = await connect(makeServer(() => undefined));
    const { tools } = await client.listTools();
    expect(tools[0]?.annotations).toEqual({
      title: "Create a user",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("delivers a custom _meta key on tools/call to the server handler unchanged", async () => {
    let seen: Record<string, unknown> | undefined;
    const client = await connect(makeServer((meta) => (seen = meta)));
    await client.callTool({ name: "users_create", arguments: {}, _meta: { "com.mantlejs/idempotencyKey": "key-1" } });
    expect(seen).toEqual({ "com.mantlejs/idempotencyKey": "key-1" });
  });

  it("leaves _meta undefined when the client sends none", async () => {
    let seen: Record<string, unknown> | undefined = {};
    const client = await connect(makeServer((meta) => (seen = meta)));
    await client.callTool({ name: "users_create", arguments: {} });
    expect(seen).toBeUndefined();
  });

  it("runs independent client/server pairs over separate in-memory transports", async () => {
    const calls: string[] = [];
    const [a, b] = await Promise.all([
      connect(makeServer(() => calls.push("a"))),
      connect(makeServer(() => calls.push("b"))),
    ]);
    await a.callTool({ name: "users_create", arguments: {} });
    await b.callTool({ name: "users_create", arguments: {} });
    expect(calls).toEqual(["a", "b"]);
    await Promise.all([a.close(), b.close()]);
  });
});
