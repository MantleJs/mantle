import type { ServiceDescriptor } from "@mantlejs/mantle";

export interface OpenApiInfo {
  /** Document title. @default "Mantle API" */
  title?: string;
  /** API version string. @default "0.0.0" */
  version?: string;
  description?: string;
}

type JsonObject = Record<string, unknown>;

const ERROR_SCHEMA: JsonObject = {
  type: "object",
  properties: {
    name: { type: "string" },
    message: { type: "string" },
    code: { type: "integer" },
    className: { type: "string" },
  },
  required: ["name", "message", "code", "className"],
};

const ID_PARAMETER: JsonObject = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: ["string", "integer"] },
};

const FIND_PARAMETERS: JsonObject[] = [
  { name: "$limit", in: "query", schema: { type: "integer", minimum: 0 } },
  { name: "$skip", in: "query", schema: { type: "integer", minimum: 0 } },
  {
    name: "$sort",
    in: "query",
    style: "deepObject",
    explode: true,
    schema: { type: "object", additionalProperties: { enum: ["asc", "desc", "1", "-1"] } },
  },
  { name: "$select", in: "query", schema: { type: "array", items: { type: "string" } } },
];

/**
 * Assemble an OpenAPI 3.1 document from the descriptors returned by
 * `ServiceHandle.describe()`. Services without a schema get a generic
 * `object` schema — a missing schema never skips a service or errors.
 */
export function buildOpenApiDocument(descriptors: ServiceDescriptor[], info: OpenApiInfo = {}): JsonObject {
  const paths: JsonObject = {};
  const schemas: JsonObject = { MantleError: ERROR_SCHEMA };
  let anyAuthRequired = false;

  for (const descriptor of descriptors) {
    const name = schemaName(descriptor.path);
    schemas[name] = isObjectSchema(descriptor.schema) ? descriptor.schema : { type: "object" };
    if (descriptor.authRequired) anyAuthRequired = true;
    addServicePaths(paths, descriptor, name);
  }

  return {
    openapi: "3.1.0",
    info: {
      title: info.title ?? "Mantle API",
      version: info.version ?? "0.0.0",
      ...(info.description !== undefined ? { description: info.description } : {}),
    },
    paths,
    components: {
      schemas,
      ...(anyAuthRequired
        ? { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } }
        : {}),
    },
  };
}

/** "admin/blog-posts" → "AdminBlogPosts" */
function schemaName(path: string): string {
  return path
    .split(/[/\-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function isObjectSchema(schema: unknown): schema is JsonObject {
  return schema !== null && typeof schema === "object" && !Array.isArray(schema);
}

function addServicePaths(paths: JsonObject, descriptor: ServiceDescriptor, name: string): void {
  const ref: JsonObject = { $ref: `#/components/schemas/${name}` };
  const collectionPath = `/${descriptor.path}`;
  const itemPath = `${collectionPath}/{id}`;
  const tagAndSecurity: JsonObject = {
    tags: [descriptor.path],
    ...(descriptor.authRequired ? { security: [{ bearerAuth: [] }] } : {}),
  };

  const operation = (method: string, extra: JsonObject): JsonObject => ({
    operationId: `${descriptor.path.replace(/\//g, "_")}.${method}`,
    ...tagAndSecurity,
    ...extra,
    responses: { ...(extra["responses"] as JsonObject), default: errorResponse() },
  });

  const collection: JsonObject = {};
  const item: JsonObject = {};

  for (const method of descriptor.methods) {
    switch (method) {
      case "find":
        collection["get"] = operation("find", {
          ...(descriptor.capabilities
            ? {
                description: `Query the collection. Filterable via query parameters; supported operators: ${descriptor.capabilities.operators.join(", ")}.`,
              }
            : {}),
          parameters: FIND_PARAMETERS,
          responses: { "200": jsonResponse("OK", findResultSchema(descriptor, ref)) },
        });
        break;
      case "get":
        item["get"] = operation("get", {
          parameters: [ID_PARAMETER],
          responses: { "200": jsonResponse("OK", ref) },
        });
        break;
      case "create":
        collection["post"] = operation("create", {
          requestBody: jsonBody(ref),
          responses: { "201": jsonResponse("Created", ref) },
        });
        break;
      case "update":
        item["put"] = operation("update", {
          parameters: [ID_PARAMETER],
          requestBody: jsonBody(ref),
          responses: { "200": jsonResponse("OK", ref) },
        });
        break;
      case "patch":
        item["patch"] = operation("patch", {
          parameters: [ID_PARAMETER],
          requestBody: jsonBody(ref),
          responses: { "200": jsonResponse("OK", ref) },
        });
        break;
      case "remove":
        item["delete"] = operation("remove", {
          parameters: [ID_PARAMETER],
          responses: { "200": jsonResponse("OK", ref) },
        });
        break;
      default: {
        // Custom methods dispatch as POST /path/:method per the transport convention.
        paths[`${collectionPath}/${method}`] = {
          post: operation(method, {
            requestBody: jsonBody({ type: "object" }),
            responses: { "200": jsonResponse("OK", { type: "object" }) },
          }),
        };
      }
    }
  }

  if (Object.keys(collection).length > 0) paths[collectionPath] = collection;
  if (Object.keys(item).length > 0) paths[itemPath] = item;
}

/**
 * A service exposing repository capabilities is a `RepositoryService`, whose `find()`
 * always returns the `Paginated<T>` envelope; plain services default to a bare array.
 */
function findResultSchema(descriptor: ServiceDescriptor, ref: JsonObject): JsonObject {
  const arraySchema: JsonObject = { type: "array", items: ref };
  if (!descriptor.capabilities) return arraySchema;
  return {
    type: "object",
    properties: {
      total: { type: "integer" },
      limit: { type: "integer" },
      skip: { type: "integer" },
      data: arraySchema,
    },
    required: ["total", "limit", "skip", "data"],
  };
}

function jsonResponse(description: string, schema: JsonObject): JsonObject {
  return { description, content: { "application/json": { schema } } };
}

function jsonBody(schema: JsonObject): JsonObject {
  return { required: true, content: { "application/json": { schema } } };
}

function errorResponse(): JsonObject {
  return jsonResponse("Error", { $ref: "#/components/schemas/MantleError" });
}
