import type { CapabilityScope, MantleApplication, ServiceDescriptor, ServiceParams } from "@mantlejs/mantle";

/**
 * Context handed to app-authored tool handlers. Dispatch inner service calls with
 * `ctx.app.service(path).dispatch(method, data, id, ctx.params)` — every call runs the
 * target service's full hook pipeline with the MCP session's identity; custom tools get
 * no privileged path.
 */
export interface McpToolContext {
  app: MantleApplication;
  /** `provider: "mcp"`; `user`/`authenticated` resolved from the session's bearer token (HTTP transport). */
  params: ServiceParams;
}

/**
 * App-authored read-only resource — reference content an agent loads as context rather
 * than queries as a tool (schema docs, enum values, usage guides). `read` runs with the
 * session's params, so inner `dispatch()` calls hit the full hook pipeline.
 */
export interface McpResourceDefinition {
  /** Unique resource URI. The `mantle://events/` namespace is reserved for event resources. */
  uri: string;
  name: string;
  description?: string;
  /** @default "text/plain" */
  mimeType?: string;
  read: (ctx: McpToolContext) => Promise<string>;
}

/** One message of a prompt template result. */
export interface McpPromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

/**
 * App-authored prompt template, surfaced by MCP clients as a user-invokable command.
 * `get` may return a plain string (shorthand for a single user message) or the full
 * `{ description?, messages }` shape.
 */
export interface McpPromptDefinition {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  get: (
    args: Record<string, string>,
    ctx: McpToolContext,
  ) => Promise<string | { description?: string; messages: McpPromptMessage[] }>;
}

/** App-authored (composite/task-level) tool, e.g. chaining two service calls. */
export interface McpToolDefinition {
  /** Tool name. Colliding with a generated tool name (or another custom tool) throws `BadRequest`. */
  name: string;
  description: string;
  /** JSON Schema for the tool arguments (a TypeBox object schema works as-is). */
  inputSchema: unknown;
  handler: (args: unknown, ctx: McpToolContext) => Promise<unknown>;
}

/** find() guardrails, applied to `params.query` before dispatch and advertised in generated schemas. */
export interface McpQueryOptions {
  /** Limit applied when the caller sends none. @default 25 */
  defaultLimit?: number;
  /** Hard clamp on the requested limit. @default 100 */
  maxLimit?: number;
}

/**
 * Which tool surface the server lists. `"tools"`: one generated tool per exposed method.
 * `"code"`: the generated per-method tools are suppressed and the `codeMode` provider's
 * tools/resources take their place. `"both"`: the union. App-authored `tools`, `resources`,
 * `prompts`, and event resources are registered in every mode.
 */
export type McpMode = "tools" | "code" | "both";

/** One expose-map entry after resolution — what a code-mode provider builds its API from. */
export interface McpExposedService {
  /** Service path, leading slash stripped. */
  path: string;
  /** Exposed methods only (the expose map's list, or every registered method for `true`), custom methods included. */
  methods: string[];
  /** `app.service(path).describe()` — the same metadata the generated tools are built from. */
  descriptor: ServiceDescriptor;
}

/** Input to `McpCodeModeProvider.build()`. */
export interface McpCodeModeInput {
  app: MantleApplication;
  /** The resolved expose map — `"*"` and `true` already expanded, unknown paths/methods already rejected. */
  services: McpExposedService[];
  /** Effective find() guardrails, defaults applied. */
  query: Required<McpQueryOptions>;
}

/** What a code-mode provider contributes to the server. */
export interface McpCodeModeSurface {
  /** Same collision rules as app-authored tools: a name clash with any registered tool throws `BadRequest`. */
  tools: McpToolDefinition[];
  /** Same rules as app-authored resources (unique URI, `mantle://events/` reserved). */
  resources?: McpResourceDefinition[];
}

/**
 * Extension point for code mode (implemented by `@mantlejs/mcp-code`; this package never
 * depends on an implementation). `build()` runs once, when the expose map is resolved — at
 * `listen()` for HTTP, at `startMcp()` for stdio. The surface is therefore shared by every
 * session: per-session behavior (e.g. narrowing the API shown to an agent token) belongs in
 * the returned handlers, which receive the session's `McpToolContext.params` on every call.
 */
export interface McpCodeModeProvider {
  build(input: McpCodeModeInput): McpCodeModeSurface;
}

export interface McpOptions {
  /**
   * Expose map — required, deny-by-default. Maps a registered service path to the methods
   * exposed as tools: an explicit method list, or `true` for every method the service
   * registered in `app.use()`. `"*"` exposes all methods of all services registered after
   * `mcp()` — a deliberate escape hatch for prototyping. An unknown path or method throws
   * `BadRequest` when the server is built (at `listen()`/`startMcp()`). Same `CapabilityScope`
   * shape `@mantlejs/auth`'s `authorizeAgent()` uses for agent-token scopes — one deny-by-default
   * grant shape shared across the framework rather than two independently-typed lookalikes.
   */
  services: CapabilityScope | "*";
  /** `"stdio"` runs a standalone MCP server via `startMcp(app)`; `"http"` mounts the endpoint on the app's HTTP transport. */
  transport: "stdio" | "http";
  /** HTTP transport only: mount path. @default "/mcp" */
  path?: string;
  /** Server identity reported during MCP initialization. Defaults: name `"mantle"`, version `"0.0.0"`. */
  serverInfo?: { name?: string; version?: string };
  /**
   * Expose service events (`created`/`updated`/`patched`/`removed` + custom) as MCP resources
   * (`mantle://events/{path}`) — for services in the expose map only. @default false
   */
  events?: boolean;
  /** App-authored tools registered alongside the generated ones. */
  tools?: McpToolDefinition[];
  /** App-authored read-only resources served alongside the event resources. */
  resources?: McpResourceDefinition[];
  /** App-authored prompt templates. The `prompts` capability is only declared when non-empty. */
  prompts?: McpPromptDefinition[];
  /** find() result guardrails. @default { defaultLimit: 25, maxLimit: 100 } */
  query?: McpQueryOptions;
  /**
   * Tool surface. `"code"`/`"both"` require `codeMode` (`BadRequest` otherwise).
   * @default "code" when `codeMode` is set, `"tools"` otherwise
   */
  mode?: McpMode;
  /** Code-mode provider, e.g. `codeMode()` from `@mantlejs/mcp-code`. */
  codeMode?: McpCodeModeProvider;
}

export const DEFAULT_FIND_LIMIT = 25;
export const DEFAULT_MAX_FIND_LIMIT = 100;
export const DEFAULT_EVENT_BUFFER_SIZE = 50;
