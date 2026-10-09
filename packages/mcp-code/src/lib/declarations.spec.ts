import type { ServiceDescriptor } from "@mantlejs/mantle";
import type { McpExposedService } from "@mantlejs/mcp";
import { describeServiceMethod } from "@mantlejs/mcp";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { accessor, buildApiModel, renderDeclarations, renderIndex, toToolArguments } from "./declarations.js";
import { schemaToTs } from "./schema-to-ts.js";

/**
 * Phase 7 PRD spec 2 / checklist item 4: typed declaration generation. Descriptors are built by
 * hand so each case pins exactly the metadata it exercises (schema / no schema, custom method,
 * operator-narrowed `where`, awkward path names).
 */

const LIMITS = { defaultLimit: 25, maxLimit: 100 };

const USER_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string", description: "Display name." },
    email: { type: "string", format: "email" },
    role: { enum: ["admin", "member"] },
    age: { type: ["integer", "null"] },
    tags: { type: "array", items: { type: "string" } },
    profile: {
      type: "object",
      properties: { bio: { type: "string" }, "favorite-color": { type: "string" } },
      additionalProperties: false,
    },
  },
  required: ["name", "email"],
};

function descriptor(
  overrides: Partial<ServiceDescriptor> & Pick<ServiceDescriptor, "path" | "methods">,
): ServiceDescriptor {
  return { events: [], ...overrides };
}

const USERS: McpExposedService = {
  path: "users",
  methods: ["find", "get", "create", "update", "patch", "remove"],
  descriptor: descriptor({
    path: "users",
    methods: ["find", "get", "create", "update", "patch", "remove"],
    schema: USER_SCHEMA,
    capabilities: {
      adapter: "@mantlejs/knex",
      operators: ["$lt", "$gt", "$in", "$like", "$or"],
      pagination: "offset",
      fullTextSearch: false,
      nestedPaths: false,
    },
  }),
};

const BLOG_POSTS: McpExposedService = {
  path: "blog-posts",
  methods: ["find", "publish"],
  descriptor: descriptor({ path: "blog-posts", methods: ["find", "get", "publish"] }),
};

const ADMIN_REPORTS: McpExposedService = {
  path: "admin/reports",
  methods: ["get"],
  descriptor: descriptor({ path: "admin/reports", methods: ["get"] }),
};

const SERVICES = [USERS, BLOG_POSTS, ADMIN_REPORTS];

/** Type-check a declaration module with the TypeScript compiler API; returns the diagnostics' text. */
function compile(source: string, extra = ""): string[] {
  const fileName = "/virtual/api.ts";
  const text = `${source}\n${extra}\nexport {};\n`;
  // `types: []` — only the ES lib, no ambient @types from node_modules: the module must stand alone.
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2022.d.ts"],
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.readFile = (name) => (name === fileName ? text : readFile(name));
  host.fileExists = (name) => name === fileName || ts.sys.fileExists(name);
  host.getSourceFile = (name, languageVersion) =>
    name === fileName ? ts.createSourceFile(name, text, languageVersion, true) : getSourceFile(name, languageVersion);
  const program = ts.createProgram([fileName], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

describe("declaration generation", () => {
  const models = buildApiModel(SERVICES, LIMITS);

  it("matches the snapshot for a schema'd service, a schema-less custom-method service, and a nested path", () => {
    expect(renderDeclarations(models)).toMatchSnapshot();
  });

  it("compiles with zero diagnostics", () => {
    expect(compile(renderDeclarations(models))).toEqual([]);
  });

  it("types calls against the API — valid usage compiles, invalid usage is rejected", () => {
    const usage = `
async function valid() {
  const page = await mantle.users.find({ where: { name: { $like: "A%" }, $or: [{ role: "admin" }] }, limit: 10, sort: { name: "asc" } });
  const user = await mantle.users.get("u1", { select: ["name"] });
  const created = await mantle.users.create({ name: "Ada", email: "ada@example.com", role: "admin" });
  await mantle.users.patch(created.id ?? "x", { tags: ["a"] });
  await mantle["blog-posts"].publish({ id: 1 });
  await mantle["admin/reports"].get(7);
  return [page, user];
}`;
    expect(compile(renderDeclarations(models), usage)).toEqual([]);

    const invalid = `
async function invalid() {
  await mantle.users.create({ name: "No email" });
  await mantle.users.patch("u1", { role: "owner" });
  await mantle["blog-posts"].get(1);
  await mantle.users.find({ limit: "ten" });
}`;
    expect(compile(renderDeclarations(models), invalid)).toHaveLength(4);
  });

  it("narrows where-operators to the adapter's capabilities", () => {
    const declarations = renderDeclarations(models, { paths: ["users"] });
    expect(declarations).toContain("$like?: unknown;");
    expect(declarations).toContain("$or?:");
    expect(declarations).not.toContain("$ilike");
    expect(declarations).not.toContain("$and?:");
  });

  it("carries the destructive-operation and find-limit notes as doc comments", () => {
    const declarations = renderDeclarations(models, { paths: ["users"] });
    expect(declarations).toContain("Permanently deletes the record.");
    expect(declarations).toContain("use mantle.users.patch() for partial changes");
    expect(declarations).toContain("Default 25; requests above 100 are clamped.");
  });

  it("falls back to a generic record type for a schema-less service", () => {
    expect(renderDeclarations(models, { paths: ["blog-posts"] })).toContain(
      "type BlogPostsRecord = { [key: string]: unknown };",
    );
  });

  it("uses service paths verbatim as API keys", () => {
    expect(accessor("users")).toBe(".users");
    expect(accessor("blog-posts")).toBe('["blog-posts"]');
    expect(accessor("admin/reports")).toBe('["admin/reports"]');
    const declarations = renderDeclarations(models);
    expect(declarations).toContain('  "blog-posts": {');
    expect(declarations).toContain('  "admin/reports": {');
  });

  it("de-duplicates type names that collide after PascalCasing", () => {
    const colliding = buildApiModel(
      [
        { ...BLOG_POSTS, path: "blog-posts", descriptor: { ...BLOG_POSTS.descriptor, path: "blog-posts" } },
        { ...BLOG_POSTS, path: "blog_posts", descriptor: { ...BLOG_POSTS.descriptor, path: "blog_posts" } },
      ],
      LIMITS,
    );
    const declarations = renderDeclarations(colliding);
    expect(declarations).toContain("type BlogPostsRecord");
    expect(declarations).toContain("type BlogPosts2Record");
    expect(compile(declarations)).toEqual([]);
  });

  it("narrows to an agent's capability scope (display only)", () => {
    const declarations = renderDeclarations(models, { scope: { users: ["find", "get"], "blog-posts": true } });
    expect(declarations).toContain("    find(query?: UsersQuery)");
    expect(declarations).not.toContain("    remove(");
    expect(declarations).not.toContain("    create(");
    expect(declarations).toContain("    publish(");
    expect(declarations).not.toContain('"admin/reports"');
    // Hidden methods leave no trace — not even the type aliases only they reference.
    expect(declarations).not.toContain("UsersData");
    expect(declarations).not.toContain("UsersPatch");
    expect(declarations).toContain("type UsersIdQuery");
    expect(compile(declarations)).toEqual([]);
  });

  it("renders an empty-but-valid module when nothing is visible", () => {
    const declarations = renderDeclarations(models, { scope: {} });
    expect(declarations).toContain("declare const mantle: {\n};");
    expect(compile(declarations)).toEqual([]);
  });

  it("filters by keyword and path for search_api, and indexes services", () => {
    expect(renderDeclarations(models, { query: "publish" })).toContain('"blog-posts"');
    expect(renderDeclarations(models, { query: "publish" })).not.toContain("  users: {");
    expect(renderIndex(models)).toBe(
      "users — find, get, create, update, patch, remove\nblog-posts — find, publish\nadmin/reports — get",
    );
  });

  // Drift guard (PRD Decision #7): every parameter type is rendered from the exact JSON Schema
  // the tool-mode tool is listed with, via the shared describeServiceMethod() helper.
  it("derives every parameter type from the tool-mode input schema", () => {
    const declarations = renderDeclarations(models, { paths: ["users"] });
    const findQuery = describeServiceMethod(USERS.descriptor, "find", LIMITS).inputSchema["properties"] as Record<
      string,
      unknown
    >;
    expect(declarations).toContain(`type UsersQuery = ${schemaToTs(findQuery["query"])};`);
    const createData = (
      describeServiceMethod(USERS.descriptor, "create", LIMITS).inputSchema["properties"] as Record<string, unknown>
    )["data"];
    expect(declarations).toContain(`type UsersData = ${schemaToTs(createData)};`);
    const patchData = (
      describeServiceMethod(USERS.descriptor, "patch", LIMITS).inputSchema["properties"] as Record<string, unknown>
    )["data"];
    expect(declarations).toContain(`type UsersPatch = ${schemaToTs(patchData)};`);
    expect(declarations).toContain(
      `type UsersRecord = ${schemaToTs(describeServiceMethod(USERS.descriptor, "get", LIMITS).outputSchema)};`,
    );
  });

  it("maps positional call arguments onto the tool-mode argument object", () => {
    expect(toToolArguments("find", [{ limit: 1 }])).toEqual({ query: { limit: 1 } });
    expect(toToolArguments("get", ["u1"])).toEqual({ id: "u1" });
    expect(toToolArguments("patch", ["u1", { name: "x" }])).toEqual({ id: "u1", data: { name: "x" } });
    expect(toToolArguments("publish", [{ id: 1 }])).toEqual({ data: { id: 1 } });
    expect(toToolArguments("find", [null])).toEqual({});
  });
});

describe("schemaToTs", () => {
  it.each([
    [{ type: "string" }, "string"],
    [{ type: "integer" }, "number"],
    [{ type: ["string", "null"] }, "string | null"],
    [{ const: "x" }, '"x"'],
    [{ enum: [1, "a"] }, '1 | "a"'],
    [{ type: "array", items: { type: ["string", "number"] } }, "Array<string | number>"],
    [{ anyOf: [{ type: "string" }, { type: "array", items: { type: "number" } }] }, "string | number[]"],
    [
      {
        allOf: [
          { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
          { type: "object", additionalProperties: { type: "number" } },
        ],
      },
      "{\n  a: string;\n} & { [key: string]: number }",
    ],
    [{ type: "object", additionalProperties: false }, "Record<string, never>"],
    [{ description: "anything" }, "unknown"],
    [true, "unknown"],
    [false, "never"],
  ])("%j → %s", (schema, expected) => {
    expect(schemaToTs(schema)).toBe(expected);
  });
});
