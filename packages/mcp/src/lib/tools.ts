import type { MantleApplication, Paginated, ServiceDescriptor, ServiceParams } from "@mantlejs/mantle";
import { BadRequest, NotFound } from "@mantlejs/mantle";
import { buildQuerySchema } from "./query-schema.js";
import type { McpOptions, McpToolDefinition } from "./types.js";
import { DEFAULT_FIND_LIMIT, DEFAULT_MAX_FIND_LIMIT } from "./types.js";

type JsonObject = Record<string, unknown>;

/** One callable tool: schema for listing, `run` for dispatch. `run` never bypasses the hook pipeline. */
export interface ToolEntry {
  name: string;
  description: string;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  run(args: JsonObject, params: ServiceParams): Promise<{ result: unknown; note?: string }>;
}

export interface ToolTable {
  tools: Map<string, ToolEntry>;
  /** Service paths in the expose map — the only services whose events may surface as resources. */
  exposedPaths: string[];
}

/** The structured query argument accepted by generated find/get/remove tools. */
interface QueryArg {
  where?: Record<string, unknown>;
  limit?: number;
  skip?: number;
  sort?: Record<string, unknown>;
  select?: unknown[];
}

interface FindLimits {
  defaultLimit: number;
  maxLimit: number;
}

/**
 * Resolve the expose map against the app's registered services and build the tool table.
 * Called when the server is first needed (boot for HTTP, `startMcp()` for stdio) — services
 * register after `configure(mcp())`, so this cannot run at configure time.
 */
export function buildToolTable(app: MantleApplication, options: McpOptions, registeredPaths: string[]): ToolTable {
  const limits: FindLimits = {
    defaultLimit: options.query?.defaultLimit ?? DEFAULT_FIND_LIMIT,
    maxLimit: options.query?.maxLimit ?? DEFAULT_MAX_FIND_LIMIT,
  };

  const exposeMap: Array<[string, string[] | true]> =
    options.services === "*"
      ? registeredPaths.map((path) => [path, true])
      : Object.entries(options.services).map(([path, methods]) => [path.replace(/^\//, ""), methods]);

  const tools = new Map<string, ToolEntry>();
  const exposedPaths: string[] = [];

  for (const [path, methodsSpec] of exposeMap) {
    const descriptor = describeService(app, path);
    const methods = resolveMethods(descriptor, methodsSpec);
    exposedPaths.push(path);
    for (const method of methods) {
      const entry = buildServiceTool(app, descriptor, method, limits);
      tools.set(entry.name, entry);
    }
  }

  for (const definition of options.tools ?? []) {
    if (tools.has(definition.name)) {
      throw new BadRequest(
        `Custom MCP tool '${definition.name}' collides with an existing tool name`,
        undefined,
        undefined,
        "Rename the custom tool, or exclude the conflicting service method from the expose map.",
      );
    }
    tools.set(definition.name, buildCustomTool(app, definition));
  }

  return { tools, exposedPaths };
}

function describeService(app: MantleApplication, path: string): ServiceDescriptor {
  try {
    return app.service(path).describe();
  } catch (error) {
    if (error instanceof NotFound) {
      throw new BadRequest(
        `MCP expose map names service '${path}', which is not registered`,
        undefined,
        undefined,
        "Register the service with app.use() before starting, or remove it from mcp({ services }).",
      );
    }
    throw error;
  }
}

function resolveMethods(descriptor: ServiceDescriptor, spec: string[] | true): string[] {
  if (spec === true) return descriptor.methods;
  for (const method of spec) {
    if (!descriptor.methods.includes(method)) {
      throw new BadRequest(
        `MCP expose map lists method '${method}' on service '${descriptor.path}', but the service does not register it`,
        undefined,
        undefined,
        `Registered methods: ${descriptor.methods.join(", ")}.`,
      );
    }
  }
  return spec;
}

/** "admin/blog-posts" + "find" → "admin_blog_posts_find" */
export function toolName(path: string, method: string): string {
  return `${path.replace(/[/-]/g, "_")}_${method}`;
}

function entitySchema(descriptor: ServiceDescriptor): JsonObject {
  const schema = descriptor.schema;
  // Never-skip rule (mirrors the OpenAPI generator): no attached schema still yields a tool.
  return schema !== null && typeof schema === "object" && !Array.isArray(schema)
    ? (schema as JsonObject)
    : { type: "object" };
}

/** All-optional variant for patch: same properties, no required list. */
function partialSchema(schema: JsonObject): JsonObject {
  const partial = { ...schema };
  delete partial["required"];
  return partial;
}

const ID_SCHEMA: JsonObject = { type: ["string", "integer"], description: "Record id." };

function buildServiceTool(
  app: MantleApplication,
  descriptor: ServiceDescriptor,
  method: string,
  limits: FindLimits,
): ToolEntry {
  const path = descriptor.path;
  const name = toolName(path, method);
  const operators = descriptor.capabilities?.operators;
  const entity = entitySchema(descriptor);
  const output = descriptor.schema !== undefined ? entity : undefined;
  const dispatch = (data: unknown, id: unknown, params: ServiceParams): Promise<unknown> =>
    app.service(path).dispatch(method, data as Partial<unknown> | undefined, id as string | number | undefined, params);

  switch (method) {
    case "find":
      return {
        name,
        description: `Find ${path} records matching a query. Results are paginated — check the returned total and page with query.skip/query.limit.`,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { query: buildQuerySchema(operators, limits) },
        },
        run: async (args, params) => {
          const query = (args["query"] ?? {}) as QueryArg;
          const requested = typeof query.limit === "number" ? query.limit : undefined;
          const limit = Math.min(requested ?? limits.defaultLimit, limits.maxLimit);
          const result = await dispatch(undefined, undefined, {
            ...params,
            query: toRestQuery(query, limit),
          });
          return { result, note: truncationNote(result) };
        },
      };
    case "get":
      return {
        name,
        description: `Get a single ${path} record by id.`,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: ID_SCHEMA, query: buildQuerySchema(operators) },
        },
        ...(output ? { outputSchema: output } : {}),
        run: async (args, params) => ({
          result: await dispatch(undefined, requireId(args, name), {
            ...params,
            query: toRestQuery((args["query"] ?? {}) as QueryArg),
          }),
        }),
      };
    case "create":
      return {
        name,
        description: `Create a new ${path} record.`,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["data"],
          properties: { data: entity },
        },
        ...(output ? { outputSchema: output } : {}),
        run: async (args, params) => ({ result: await dispatch(args["data"], undefined, params) }),
      };
    case "update":
      return {
        name,
        description: `Update a ${path} record by id. Replaces the entire record — omitted fields are lost; use ${toolName(path, "patch")} for partial changes.`,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["id", "data"],
          properties: { id: ID_SCHEMA, data: entity },
        },
        ...(output ? { outputSchema: output } : {}),
        run: async (args, params) => ({ result: await dispatch(args["data"], requireId(args, name), params) }),
      };
    case "patch":
      return {
        name,
        description: `Patch a ${path} record by id. Partial update — only the provided fields change.`,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["id", "data"],
          properties: { id: ID_SCHEMA, data: partialSchema(entity) },
        },
        ...(output ? { outputSchema: output } : {}),
        run: async (args, params) => ({ result: await dispatch(args["data"], requireId(args, name), params) }),
      };
    case "remove":
      return {
        name,
        description: `Remove a ${path} record by id. Permanently deletes the record.`,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: ID_SCHEMA, query: buildQuerySchema(operators) },
        },
        run: async (args, params) => ({
          result: await dispatch(undefined, requireId(args, name), {
            ...params,
            query: toRestQuery((args["query"] ?? {}) as QueryArg),
          }),
        }),
      };
    default:
      // Custom service method: dispatches as (data, params), like the HTTP transports' POST /path/:method.
      return {
        name,
        description: `Call the custom '${method}' method on the ${path} service.`,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { data: { type: "object", description: "Payload passed to the method." } },
        },
        run: async (args, params) => ({ result: await dispatch(args["data"] ?? {}, undefined, params) }),
      };
  }
}

function buildCustomTool(app: MantleApplication, definition: McpToolDefinition): ToolEntry {
  const inputSchema = definition.inputSchema;
  return {
    name: definition.name,
    description: definition.description,
    inputSchema:
      inputSchema !== null && typeof inputSchema === "object" && !Array.isArray(inputSchema)
        ? (inputSchema as JsonObject)
        : { type: "object" },
    run: async (args, params) => ({ result: await definition.handler(args, { app, params }) }),
  };
}

function requireId(args: JsonObject, tool: string): string | number {
  const id = args["id"];
  if (typeof id !== "string" && typeof id !== "number") {
    throw new BadRequest(`Tool ${tool} requires an 'id' argument (string or number)`);
  }
  return id;
}

/**
 * Translate the structured query argument into the REST-convention `params.query`
 * (`$limit`/`$skip`/`$sort`/`$select` reserved keys, where-fields at the top level) —
 * the exact shape a parsed HTTP query string produces, so services and hooks see no
 * difference between MCP and REST callers. Values arrive typed from JSON; the
 * RepositoryService coercion path passes non-strings through untouched.
 */
function toRestQuery(query: QueryArg, limit?: number): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...(query.where ?? {}) };
  if (limit !== undefined) rest["$limit"] = limit;
  else if (query.limit !== undefined) rest["$limit"] = query.limit;
  if (query.skip !== undefined) rest["$skip"] = query.skip;
  if (query.sort !== undefined) rest["$sort"] = query.sort;
  if (query.select !== undefined) rest["$select"] = query.select;
  return rest;
}

function isPaginated(result: unknown): result is Paginated<unknown> {
  return (
    result !== null &&
    typeof result === "object" &&
    Array.isArray((result as Paginated<unknown>).data) &&
    typeof (result as Paginated<unknown>).total === "number"
  );
}

/** Tell the caller the page is partial so it pages instead of assuming it saw everything. */
function truncationNote(result: unknown): string | undefined {
  if (!isPaginated(result) || result.data.length >= result.total) return undefined;
  return `Returned ${result.data.length} of ${result.total} records. Page with query.skip and query.limit; use query.select to trim fields.`;
}
