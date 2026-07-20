import type {
  HttpRequestLike,
  HttpRouterLike,
  MantleApplication,
  MantlePlugin,
  ServiceOptions,
  ServiceParams,
} from "@mantlejs/mantle";
import { BadRequest, GeneralError } from "@mantlejs/mantle";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EventLog } from "./events.js";
import { createMcpServer } from "./server.js";
import { handleSingleShot } from "./single-shot.js";
import type { ToolTable } from "./tools.js";
import { buildToolTable } from "./tools.js";
import type { McpOptions } from "./types.js";

/** Stored under `app.get("mcp:server")` — builds a server bound to one session's params. */
export type McpServerFactory = (sessionParams?: ServiceParams) => Server;

/**
 * Expose registered services as MCP tools. Deny-by-default: only services (and methods)
 * named in `options.services` get tools, and every tool call routes through the service's
 * full hook pipeline with `params.provider = "mcp"` — authentication, validation, and
 * events apply exactly as they do for REST callers.
 *
 * Configure AFTER the HTTP transport (for `transport: "http"`) and BEFORE registering
 * services. The expose map is resolved when the server is first needed — at `listen()`
 * for HTTP, at `startMcp()` for stdio — and an unknown path or method fails the boot.
 */
export function mcp(options: McpOptions): MantlePlugin {
  validateOptions(options);

  return (app: MantleApplication): void => {
    const registeredPaths: string[] = [];
    if (options.services === "*") {
      const originalUse = (app.use as unknown as (...args: unknown[]) => MantleApplication).bind(app);
      (app as unknown as Record<string, unknown>)["use"] = function (
        path: unknown,
        service?: unknown,
        serviceOptions?: ServiceOptions,
      ): MantleApplication {
        const result = originalUse(path, service, serviceOptions);
        if (typeof path === "string") registeredPaths.push(path.replace(/^\//, ""));
        return result;
      };
    }

    // Attach now so the buffer captures events from the first registered service onward.
    const eventLog = options.events === true ? new EventLog(app) : undefined;

    let table: ToolTable | undefined;
    const resolveTable = (): ToolTable => {
      table ??= buildToolTable(app, options, registeredPaths);
      return table;
    };

    const factory: McpServerFactory = (sessionParams) =>
      createMcpServer({ app, options, table: resolveTable(), eventLog }, { provider: "mcp", ...sessionParams });
    app.set("mcp:server", factory);

    if (options.transport === "http") {
      const router = app.get<HttpRouterLike | undefined>("http:router");
      if (!router) {
        throw new GeneralError(
          'mcp({ transport: "http" }) requires an HTTP transport — configure express(), koa(), or http() first',
        );
      }
      const mountPath = options.path ?? "/mcp";

      router.post(mountPath, async (req, res) => {
        const body = (req as HttpRequestLike & { body?: unknown }).body;
        let response: unknown;
        try {
          const sessionParams = buildSessionParams(app, req.headers);
          response = await handleSingleShot(() => factory(sessionParams), body);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          res.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message } });
          return;
        }
        if (response === null) {
          res.status(202).json(null);
        } else {
          res.json(response);
        }
      });

      router.get(mountPath, (_req, res) => {
        res.status(405).json({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32000,
            message: "Method not allowed — POST JSON-RPC messages; SSE streaming is not supported",
          },
        });
      });

      // Resolve the expose map at listen() so a bad map fails the boot, not the first agent call.
      app.on("http:server", () => {
        resolveTable();
      });
    }
  };
}

export interface StartMcpOptions {
  /**
   * Extra `ServiceParams` merged into every tool call of this stdio session — e.g.
   * `{ headers: { authorization: "Bearer …" } }` so services' `authenticate("jwt")` hooks
   * pass. stdio carries no HTTP request, so without this the session is anonymous and
   * protected services reject exactly as they would an unauthenticated REST call.
   */
  params?: ServiceParams;
}

/**
 * Connect the configured MCP server to stdio. Intended usage is a separate entry point
 * (`mcp.ts`) that builds the app without `listen()` and ends with `await startMcp(app)`.
 */
export async function startMcp(app: MantleApplication, options: StartMcpOptions = {}): Promise<Server> {
  const factory = app.get<McpServerFactory | undefined>("mcp:server");
  if (!factory) {
    throw new GeneralError("MCP is not configured — call app.configure(mcp({ … })) first");
  }
  const server = factory(options.params);
  await server.connect(new StdioServerTransport());
  return server;
}

function validateOptions(options: McpOptions): void {
  if (options.transport !== "stdio" && options.transport !== "http") {
    throw new BadRequest(`mcp() transport must be "stdio" or "http", got '${String(options.transport)}'`);
  }

  const services = options.services as unknown;
  const isExposeMap = services !== null && typeof services === "object" && !Array.isArray(services);
  if (services !== "*" && !isExposeMap) {
    throw new BadRequest(
      "mcp() requires a 'services' expose map — MCP exposure is deny-by-default",
      undefined,
      undefined,
      'Pass services: { "<path>": true | ["find", …] }, or services: "*" to deliberately expose everything.',
    );
  }
  if (isExposeMap && Object.keys(services as object).length === 0) {
    throw new BadRequest(
      "mcp() services expose map is empty — the server would expose no tools",
      undefined,
      undefined,
      'Name at least one service, or pass services: "*" to deliberately expose everything.',
    );
  }

  for (const tool of options.tools ?? []) {
    if (typeof tool.name !== "string" || tool.name.length === 0) {
      throw new BadRequest("Every custom MCP tool needs a non-empty 'name'");
    }
    if (typeof tool.handler !== "function") {
      throw new BadRequest(`Custom MCP tool '${tool.name}' needs a handler function`);
    }
  }

  const resourceUris = new Set<string>();
  for (const resource of options.resources ?? []) {
    if (typeof resource.uri !== "string" || resource.uri.length === 0) {
      throw new BadRequest("Every custom MCP resource needs a non-empty 'uri'");
    }
    if (resource.uri.startsWith("mantle://events/")) {
      throw new BadRequest(
        `Custom MCP resource '${resource.uri}' uses the reserved mantle://events/ namespace`,
        undefined,
        undefined,
        "Event resources are generated from the expose map when events: true — pick a different URI scheme or path.",
      );
    }
    if (resourceUris.has(resource.uri)) {
      throw new BadRequest(`Duplicate custom MCP resource URI '${resource.uri}'`);
    }
    resourceUris.add(resource.uri);
    if (typeof resource.name !== "string" || resource.name.length === 0) {
      throw new BadRequest(`Custom MCP resource '${resource.uri}' needs a non-empty 'name'`);
    }
    if (typeof resource.read !== "function") {
      throw new BadRequest(`Custom MCP resource '${resource.uri}' needs a read function`);
    }
  }

  const promptNames = new Set<string>();
  for (const prompt of options.prompts ?? []) {
    if (typeof prompt.name !== "string" || prompt.name.length === 0) {
      throw new BadRequest("Every MCP prompt needs a non-empty 'name'");
    }
    if (promptNames.has(prompt.name)) {
      throw new BadRequest(`Duplicate MCP prompt name '${prompt.name}'`);
    }
    promptNames.add(prompt.name);
    if (typeof prompt.get !== "function") {
      throw new BadRequest(`MCP prompt '${prompt.name}' needs a get function`);
    }
  }

  const { defaultLimit, maxLimit } = options.query ?? {};
  for (const [key, value] of [
    ["defaultLimit", defaultLimit],
    ["maxLimit", maxLimit],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
      throw new BadRequest(`mcp() query.${key} must be a positive integer, got '${String(value)}'`);
    }
  }
  if (defaultLimit !== undefined && maxLimit !== undefined && defaultLimit > maxLimit) {
    throw new BadRequest(`mcp() query.defaultLimit (${defaultLimit}) must not exceed query.maxLimit (${maxLimit})`);
  }
}

function buildSessionParams(app: MantleApplication, headers: HttpRequestLike["headers"]): ServiceParams {
  const raw = headers["authorization"];
  const authorization = Array.isArray(raw) ? raw[0] : raw;
  const params: ServiceParams = {
    provider: "mcp",
    headers: authorization !== undefined ? { authorization } : {},
  };

  // Duck-typed AuthEngine (registered by @mantlejs/auth under "auth") — no dependency on
  // the auth package. A valid bearer token pre-resolves params.user for hooks and custom
  // tools; an invalid or missing one leaves the session anonymous and the services' own
  // authenticate hooks reject, exactly as for REST.
  const engine = app.get<{ verifyJwt?: (token: string) => unknown } | undefined>("auth");
  if (authorization !== undefined && typeof engine?.verifyJwt === "function") {
    const spaceIndex = authorization.indexOf(" ");
    const scheme = spaceIndex >= 0 ? authorization.slice(0, spaceIndex) : authorization;
    const token = spaceIndex >= 0 ? authorization.slice(spaceIndex + 1) : "";
    if (scheme.toLowerCase() === "bearer" && token) {
      try {
        params.user = engine.verifyJwt(token) as Record<string, unknown>;
        params.authenticated = true;
      } catch {
        // Invalid token: leave the session anonymous; per-service auth hooks decide.
      }
    }
  }
  return params;
}
