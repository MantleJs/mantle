import type { MantleApplication, ServiceParams } from "@mantlejs/mantle";
import { MantleError } from "@mantlejs/mantle";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { EventLog } from "./events.js";
import type { ToolTable } from "./tools.js";
import type { McpOptions, McpToolContext } from "./types.js";

const EVENTS_URI_PREFIX = "mantle://events/";

export interface McpServerContext {
  app: MantleApplication;
  options: McpOptions;
  table: ToolTable;
  eventLog?: EventLog;
}

/** `MantleError.toJSON()` shape for any thrown value; plain errors map to the GeneralError shape. */
export function toErrorJson(error: unknown): Record<string, unknown> {
  if (error instanceof MantleError) return error.toJSON();
  const message = error instanceof Error ? error.message : String(error);
  return { name: "GeneralError", message, code: 500, className: "general-error" };
}

/**
 * Build one SDK `Server` bound to a session's params. Cheap to construct — the HTTP
 * transport builds one per request (stateless), stdio builds one for the process.
 */
export function createMcpServer(context: McpServerContext, sessionParams: ServiceParams): Server {
  const { app, options, table, eventLog } = context;
  const events = options.events === true && eventLog !== undefined;
  const customResources = new Map((options.resources ?? []).map((resource) => [resource.uri, resource]));
  const prompts = new Map((options.prompts ?? []).map((prompt) => [prompt.name, prompt]));
  const hasResources = events || customResources.size > 0;

  // Fresh params per call — hooks may mutate them, and calls must not bleed into each other.
  const freshContext = (): McpToolContext => ({
    app,
    params: { ...sessionParams, headers: { ...sessionParams.headers } },
  });

  const server = new Server(
    {
      name: options.serverInfo?.name ?? "mantle",
      version: options.serverInfo?.version ?? "0.0.0",
    },
    {
      capabilities: {
        tools: {},
        ...(hasResources ? { resources: { subscribe: events } } : {}),
        ...(prompts.size > 0 ? { prompts: {} } : {}),
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...table.tools.values()].map((entry) => ({
      name: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema as { type: "object"; [key: string]: unknown },
      ...(entry.outputSchema ? { outputSchema: entry.outputSchema as { type: "object"; [key: string]: unknown } } : {}),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const entry = table.tools.get(request.params.name);
    if (!entry) {
      throw new McpError(ErrorCode.MethodNotFound, `Tool '${request.params.name}' not found`);
    }
    const { params } = freshContext();
    try {
      const { result, note } = await entry.run((request.params.arguments ?? {}) as Record<string, unknown>, params);
      const structured =
        entry.outputSchema !== undefined && result !== null && typeof result === "object" && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : undefined;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result) },
          ...(note !== undefined ? [{ type: "text" as const, text: note }] : []),
        ],
        ...(structured !== undefined ? { structuredContent: structured } : {}),
      };
    } catch (error) {
      // Service/hook failures are tool errors, not protocol errors — the caller can read
      // the typed MantleError shape (code, data, hint) and adjust.
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify(toErrorJson(error)) }],
      };
    }
  });

  if (hasResources) {
    const subscribed = new Set<string>();

    server.setRequestHandler(ListResourcesRequestSchema, () => ({
      resources: [
        ...[...customResources.values()].map((resource) => ({
          uri: resource.uri,
          name: resource.name,
          ...(resource.description !== undefined ? { description: resource.description } : {}),
          mimeType: resource.mimeType ?? "text/plain",
        })),
        ...(events
          ? table.exposedPaths.map((path) => ({
              uri: `${EVENTS_URI_PREFIX}${path}`,
              name: `${path} events`,
              description: `Recent service events for '${path}' ({ event, path, data, timestamp }, newest last).`,
              mimeType: "application/json",
            }))
          : []),
      ],
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      const custom = customResources.get(uri);
      if (custom) {
        try {
          return {
            contents: [{ uri, mimeType: custom.mimeType ?? "text/plain", text: await custom.read(freshContext()) }],
          };
        } catch (error) {
          // Resources have no in-band error channel — surface the MantleError shape as protocol error data.
          throw new McpError(ErrorCode.InternalError, toErrorMessage(error), toErrorJson(error));
        }
      }
      if (!events) throw new McpError(ErrorCode.InvalidParams, `Unknown resource '${uri}'`);
      const path = exposedPathForUri(table, uri);
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(eventLog?.read(path)) }],
      };
    });

    server.setRequestHandler(SubscribeRequestSchema, (request) => {
      // Custom resources have no update signal — subscribing is an accepted no-op.
      if (customResources.has(request.params.uri)) return {};
      if (!events) throw new McpError(ErrorCode.InvalidParams, `Unknown resource '${request.params.uri}'`);
      subscribed.add(`${EVENTS_URI_PREFIX}${exposedPathForUri(table, request.params.uri)}`);
      return {};
    });

    server.setRequestHandler(UnsubscribeRequestSchema, (request) => {
      subscribed.delete(request.params.uri);
      return {};
    });

    if (events && eventLog) {
      const unsubscribe = eventLog.onUpdate((path) => {
        const uri = `${EVENTS_URI_PREFIX}${path}`;
        if (subscribed.has(uri)) {
          void server.sendResourceUpdated({ uri }).catch(() => undefined);
        }
      });
      server.onclose = unsubscribe;
    }
  }

  if (prompts.size > 0) {
    server.setRequestHandler(ListPromptsRequestSchema, () => ({
      prompts: [...prompts.values()].map((prompt) => ({
        name: prompt.name,
        ...(prompt.description !== undefined ? { description: prompt.description } : {}),
        ...(prompt.arguments !== undefined ? { arguments: prompt.arguments } : {}),
      })),
    }));

    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const prompt = prompts.get(request.params.name);
      if (!prompt) {
        throw new McpError(ErrorCode.InvalidParams, `Unknown prompt '${request.params.name}'`);
      }
      try {
        const result = await prompt.get(request.params.arguments ?? {}, freshContext());
        if (typeof result === "string") {
          return { messages: [{ role: "user" as const, content: { type: "text" as const, text: result } }] };
        }
        return {
          ...(result.description !== undefined ? { description: result.description } : {}),
          messages: result.messages,
        };
      } catch (error) {
        throw new McpError(ErrorCode.InternalError, toErrorMessage(error), toErrorJson(error));
      }
    });
  }

  return server;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function exposedPathForUri(table: ToolTable, uri: string): string {
  const path = uri.startsWith(EVENTS_URI_PREFIX) ? uri.slice(EVENTS_URI_PREFIX.length) : undefined;
  if (path === undefined || !table.exposedPaths.includes(path)) {
    throw new McpError(ErrorCode.InvalidParams, `Unknown resource '${uri}'`);
  }
  return path;
}
