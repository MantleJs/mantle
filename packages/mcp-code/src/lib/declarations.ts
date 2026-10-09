import type { CapabilityScope } from "@mantlejs/mantle";
import { matchesCapabilityScope } from "@mantlejs/mantle";
import type { McpExposedService, McpQueryOptions } from "@mantlejs/mcp";
import { describeServiceMethod, toolName } from "@mantlejs/mcp";
import { jsDoc, propertyKey, schemaToTs } from "./schema-to-ts.js";

type JsonObject = Record<string, unknown>;

/**
 * How a sandbox call's positional arguments map onto the tool-mode argument object — the one
 * table both the generated signatures and the bridge read, so they can't disagree. Custom
 * methods take `(data?)`, like the HTTP transports' `POST /path/:method`.
 */
export const METHOD_PARAMETERS: Record<string, readonly string[]> = {
  find: ["query"],
  get: ["id", "query"],
  remove: ["id", "query"],
  create: ["data"],
  update: ["id", "data"],
  patch: ["id", "data"],
};
const CUSTOM_PARAMETERS: readonly string[] = ["data"];

export function methodParameters(method: string): readonly string[] {
  return METHOD_PARAMETERS[method] ?? CUSTOM_PARAMETERS;
}

/** `mantle.users.find(q)` → the tool-mode arguments `{ query: q }`. */
export function toToolArguments(method: string, args: unknown[]): Record<string, unknown> {
  const named: Record<string, unknown> = {};
  methodParameters(method).forEach((name, index) => {
    const value = args[index];
    if (value !== undefined && value !== null) named[name] = value;
  });
  return named;
}

interface MethodModel {
  method: string;
  declaration: string;
}

interface TypeAlias {
  /** Methods whose signatures reference this alias. */
  usedBy: string[];
  declaration: string;
}

/** One exposed service, rendered once at build time; filtered per session for agent narrowing. */
export interface ServiceApiModel {
  path: string;
  /** Types the service's signatures reference (`type UsersRecord = …`). */
  typeAliases: TypeAlias[];
  methods: MethodModel[];
  /** Lower-cased text `search_api` matches against: path, method names, descriptions. */
  searchText: string;
}

const HEADER = `/**
 * Mantle API — your session's exposed services. Call as \`await mantle[path].method(...)\`
 * (e.g. \`mantle.users.find({ where: { active: true } })\`). Every call runs the service's full
 * hook pipeline (authentication, authorization, validation, audit) as the current session —
 * a rejected call throws an Error carrying the service error's name/message/code/data/hint.
 * Values cross as JSON. Return the result from your script; console.log output is captured.
 */
type Id = string | number;
interface Paginated<T> {
  total: number;
  limit: number;
  skip: number;
  data: T[];
}
`;

function pascalCase(path: string): string {
  const name = path
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return /^[A-Za-z]/.test(name) ? name : `Service${name}`;
}

/**
 * Build the per-service API model from the resolved expose map. Parameter and return types are
 * rendered from `describeServiceMethod()` — the exact JSON Schemas the tool-mode tools are listed
 * with — so code mode and tool mode can't drift (PRD Decision #7).
 */
export function buildApiModel(services: McpExposedService[], limits: Required<McpQueryOptions>): ServiceApiModel[] {
  const usedNames = new Set<string>();
  return services.map((service) => {
    let base = pascalCase(service.path);
    for (let suffix = 2; usedNames.has(base); suffix++) base = `${pascalCase(service.path)}${suffix}`;
    usedNames.add(base);

    const schemaOf = (method: string) => describeServiceMethod(service.descriptor, method, limits);
    const inputProperty = (method: string, property: string): unknown =>
      (schemaOf(method).inputSchema["properties"] as JsonObject | undefined)?.[property];

    const types = {
      record: `${base}Record`,
      query: `${base}Query`,
      idQuery: `${base}IdQuery`,
      data: `${base}Data`,
      patch: `${base}Patch`,
    };
    // Each alias lists the methods that reference it; rendering emits only those a visible method
    // uses — every declared line costs the agent tokens, and hidden methods leave no trace.
    const typeAliases: TypeAlias[] = [
      {
        usedBy: ["find", "get", "create", "update", "patch", "remove"],
        declaration: `/** A \`${service.path}\` record. */\ntype ${types.record} = ${schemaToTs(schemaOf("get").outputSchema ?? { type: "object" })};`,
      },
      {
        usedBy: ["find"],
        declaration: `/** Query for \`mantle${accessor(service.path)}.find()\`. */\ntype ${types.query} = ${schemaToTs(inputProperty("find", "query"))};`,
      },
      {
        usedBy: ["get", "remove"],
        declaration: `/** Query for \`get\`/\`remove\` (field selection). */\ntype ${types.idQuery} = ${schemaToTs(inputProperty("get", "query"))};`,
      },
      {
        usedBy: ["create", "update"],
        declaration: `/** Data for \`create\`/\`update\`. */\ntype ${types.data} = ${schemaToTs(inputProperty("create", "data"))};`,
      },
      {
        usedBy: ["patch"],
        declaration: `/** Data for \`patch\` (every field optional). */\ntype ${types.patch} = ${schemaToTs(inputProperty("patch", "data"))};`,
      },
    ];

    const methods = service.methods.map((method): MethodModel => {
      const schema = schemaOf(method);
      const description = schema.description.replace(
        toolName(service.path, "patch"),
        `mantle${accessor(service.path)}.patch()`,
      );
      return {
        method,
        declaration: `${jsDoc(description, "    ")}    ${propertyKey(method)}${signature(method, types)};`,
      };
    });

    return {
      path: service.path,
      typeAliases,
      methods,
      searchText: [service.path, ...service.methods, ...service.methods.map((m) => schemaOf(m).description)]
        .join(" ")
        .toLowerCase(),
    };
  });
}

function signature(
  method: string,
  types: { record: string; query: string; idQuery: string; data: string; patch: string },
): string {
  switch (method) {
    case "find":
      return `(query?: ${types.query}): Promise<${types.record}[] | Paginated<${types.record}>>`;
    case "get":
    case "remove":
      return `(id: Id, query?: ${types.idQuery}): Promise<${types.record}>`;
    case "create":
      return `(data: ${types.data}): Promise<${types.record}>`;
    case "update":
      return `(id: Id, data: ${types.data}): Promise<${types.record}>`;
    case "patch":
      return `(id: Id, data: ${types.patch}): Promise<${types.record}>`;
    default:
      return `(data?: Record<string, unknown>): Promise<unknown>`;
  }
}

/** `users` → `.users`; `blog-posts` → `["blog-posts"]`. Service paths are used verbatim as keys (Decision: no aliasing). */
export function accessor(path: string): string {
  const key = propertyKey(path);
  return key === path ? `.${path}` : `[${key}]`;
}

export interface RenderOptions {
  /** Agent capability scope: hide methods (and services left with none) outside it. Display only. */
  scope?: CapabilityScope;
  /** Only these service paths. */
  paths?: string[];
  /** Case-insensitive keyword filter over path, method names, and descriptions. */
  query?: string;
}

/** Visible methods per service after agent narrowing and the search filters. */
export function visibleServices(models: ServiceApiModel[], options: RenderOptions = {}): ServiceApiModel[] {
  const terms = (options.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return models
    .filter((model) => options.paths === undefined || options.paths.includes(model.path))
    .filter((model) => terms.length === 0 || terms.some((term) => model.searchText.includes(term)))
    .map((model) => ({
      ...model,
      methods:
        options.scope === undefined
          ? model.methods
          : model.methods.filter((entry) =>
              matchesCapabilityScope(options.scope as CapabilityScope, model.path, entry.method),
            ),
    }))
    .filter((model) => model.methods.length > 0);
}

/** Render a self-contained, compilable declaration module for the visible services. */
export function renderDeclarations(models: ServiceApiModel[], options: RenderOptions = {}): string {
  const visible = visibleServices(models, options);
  const blocks = visible
    .map((model) => {
      const methods = new Set(model.methods.map((entry) => entry.method));
      return model.typeAliases
        .filter((alias) => alias.usedBy.some((method) => methods.has(method)))
        .map((alias) => alias.declaration)
        .join("\n");
    })
    .filter((block) => block !== "");
  const members = visible.map(
    (model) => `  ${propertyKey(model.path)}: {\n${model.methods.map((entry) => entry.declaration).join("\n")}\n  };`,
  );
  return `${HEADER}\n${blocks.join("\n\n")}${blocks.length > 0 ? "\n\n" : ""}declare const mantle: {\n${members.join(
    "\n",
  )}${members.length > 0 ? "\n" : ""}};\n`;
}

/** One line per visible service: `users — find, get, create`. */
export function renderIndex(models: ServiceApiModel[], options: RenderOptions = {}): string {
  return visibleServices(models, options)
    .map((model) => `${model.path} — ${model.methods.map((entry) => entry.method).join(", ")}`)
    .join("\n");
}
