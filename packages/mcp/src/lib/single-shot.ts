import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, RequestId } from "@modelcontextprotocol/sdk/types.js";
import {
  LATEST_PROTOCOL_VERSION,
  isJSONRPCError,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResponse,
} from "@modelcontextprotocol/sdk/types.js";

/** Reserved id for the synthetic handshake — never surfaces to the HTTP caller. */
const INIT_ID = "__mantle_mcp_init__";

/**
 * Server-side transport for stateless single-shot exchanges: one incoming JSON-RPC
 * message, one collected response. Powers the HTTP endpoint, where each POST builds a
 * fresh server (the transport-neutral `http:router` contract has no raw socket access,
 * so responses are plain JSON — no SSE streaming; spec-compliant for streamable HTTP).
 */
class SingleShotTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private readonly waiters = new Map<RequestId, (message: JSONRPCMessage) => void>();

  async start(): Promise<void> {
    // No connection to open — messages are delivered explicitly via deliver().
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (isJSONRPCResponse(message) || isJSONRPCError(message)) {
      const id = message.id as RequestId | undefined;
      if (id !== undefined) {
        this.waiters.get(id)?.(message);
        this.waiters.delete(id);
      }
    }
    // Server-initiated requests/notifications have no return channel in a single-shot
    // exchange — dropped by design (subscriptions are only live on stdio).
  }

  async close(): Promise<void> {
    this.onclose?.();
  }

  deliver(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }

  awaitResponse(id: RequestId): Promise<JSONRPCMessage> {
    return new Promise((resolve) => this.waiters.set(id, resolve));
  }
}

function invalidRequest(message: string): unknown {
  return { jsonrpc: "2.0", id: null, error: { code: -32600, message } };
}

/**
 * Handle one HTTP-delivered JSON-RPC message against a freshly built server.
 * Returns the response message to serialize, or `null` for notifications (→ 202).
 *
 * Statelessness detail: the SDK server tracks the MCP initialize handshake per
 * connection, but each POST is a new connection — so for any non-initialize request a
 * synthetic handshake is run first, keeping the protocol state machine satisfied.
 */
export async function handleSingleShot(makeServer: () => Server, message: unknown): Promise<unknown | null> {
  if (Array.isArray(message)) {
    return invalidRequest("JSON-RPC batching is not supported");
  }
  const request = isJSONRPCRequest(message) ? message : undefined;
  const notification = !request && isJSONRPCNotification(message) ? message : undefined;
  if (!request && !notification) {
    return invalidRequest("Expected a JSON-RPC request or notification");
  }

  const server = makeServer();
  const transport = new SingleShotTransport();
  await server.connect(transport);

  try {
    if (!request || request.method !== "initialize") {
      const handshake = transport.awaitResponse(INIT_ID);
      transport.deliver({
        jsonrpc: "2.0",
        id: INIT_ID,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "mantle-http", version: "0.0.0" },
        },
      });
      await handshake;
      transport.deliver({ jsonrpc: "2.0", method: "notifications/initialized" });
    }

    if (!request) {
      transport.deliver(notification as JSONRPCMessage);
      // Give the notification handler a tick before tearing the server down.
      await new Promise((resolve) => setImmediate(resolve));
      return null;
    }

    const pending = transport.awaitResponse(request.id);
    transport.deliver(request);
    return await pending;
  } finally {
    await server.close();
  }
}
