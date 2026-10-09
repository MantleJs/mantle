import nx from "@nx/eslint-plugin";

/**
 * Package dependency matrix: which workspace packages each package may import. Mirrors CLAUDE.md's
 * "Package Dependency Rules" table row for row. `tools/check-dependency-matrix.mjs` fails CI if the
 * two diverge. Keys and values are Nx project names; every packages/* project is tagged
 * `pkg:<name>` + `type:lib`, the registry/ project `pkg:ui-registry` + `type:registry`, every
 * examples/* project `type:app`. An empty list means "nothing".
 */
export const dependencyMatrix = {
  mantle: [],
  express: ["mantle"],
  koa: ["mantle"],
  http: ["mantle"],
  knex: ["mantle"],
  dynamodb: ["mantle"],
  supabase: ["mantle"],
  pinecone: ["mantle"],
  qdrant: ["mantle"],
  neo4j: ["mantle"],
  mongodb: ["mantle"],
  auth: ["mantle"],
  "auth-local": ["mantle", "auth"],
  "auth-oauth": ["mantle", "auth"],
  "auth-google": ["mantle", "auth-oauth"],
  "auth-github": ["mantle", "auth-oauth"],
  "auth-facebook": ["mantle", "auth-oauth"],
  "auth-apple": ["mantle", "auth-oauth"],
  "auth-microsoft": ["mantle", "auth-oauth"],
  "auth-linkedin": ["mantle", "auth-oauth"],
  "auth-twitter": ["mantle", "auth-oauth"],
  "auth-redis": ["mantle", "auth", "auth-oauth"],
  storage: ["mantle"],
  "storage-s3": ["mantle", "storage"],
  "storage-gcs": ["mantle", "storage"],
  logger: ["mantle"],
  audit: ["mantle"],
  embeddings: ["mantle"],
  schema: ["mantle"],
  memory: ["mantle"],
  config: ["mantle"],
  socketio: ["mantle"],
  openapi: ["mantle"],
  mcp: ["mantle"],
  "mcp-code": ["mantle", "mcp"],
  sync: ["mantle"],
  client: [],
  react: ["client"],
  cli: [],
  "create-mantlejs": ["cli"],
  // registry/ — the unpublished Mantle UI shadcn registry (tagged pkg:ui-registry + type:registry)
  "ui-registry": ["client", "react"],
};

/**
 * Test-only exceptions: extra packages a project's spec files may import on top of its matrix row,
 * scoped to test files by the override below, so production sources stay strictly constrained.
 * Every entry is a spec that exercises the package against a real sibling (conformance fixtures,
 * end-to-end dispatch through a real transport or auth engine), never a production dependency.
 */
export const testOnlyDependencies = {
  // serialize-query.spec.ts: client query serialization round-trips through the server parser
  client: ["mantle"],
  // agent-authorization / hook-pipeline-equivalence / mcp-http / mcp specs: real HTTP transport,
  // in-memory repository, and auth engine behind the MCP server
  mcp: ["http", "memory", "auth"],
  // code-mode / equivalence / agent-scope / audit specs: real HTTP transport, in-memory repository,
  // auth engine (agent tokens + authorizeAgent), and audit sink behind the code-mode bridge
  "mcp-code": ["http", "memory", "auth", "audit"],
  // audit.spec.ts (memory sink) and audit-real-adapter.spec.ts (knex/sqlite sink)
  audit: ["memory", "knex"],
  // embed.spec.ts: in-memory source + vector repositories
  embeddings: ["memory"],
};

const testFiles = ["**/*.spec.ts", "**/*.spec.tsx"];

function boundaryRule(matrix) {
  return [
    "error",
    {
      enforceBuildableLibDependency: true,
      allow: ["^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$"],
      depConstraints: [
        ...Object.entries(matrix).map(([name, deps]) => ({
          sourceTag: `pkg:${name}`,
          onlyDependOnLibsWithTags: deps.map((dep) => `pkg:${dep}`),
        })),
        // Apps (examples/*) are exempt — they may use anything and are never depended on.
        { sourceTag: "type:app", onlyDependOnLibsWithTags: ["*"] },
      ],
    },
  ];
}

function withTestOnly(matrix, extras) {
  return Object.fromEntries(
    Object.entries(matrix).map(([name, deps]) => [name, [...new Set([...deps, ...(extras[name] ?? [])])]]),
  );
}

export default [
  ...nx.configs["flat/base"],
  ...nx.configs["flat/typescript"],
  ...nx.configs["flat/javascript"],
  {
    ignores: ["**/dist", "**/out-tsc", "**/vitest.config.*.timestamp*", "**/vite.config.*.timestamp*"],
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
    rules: {
      "@nx/enforce-module-boundaries": boundaryRule(dependencyMatrix),
    },
  },
  {
    files: testFiles,
    rules: {
      "@nx/enforce-module-boundaries": boundaryRule(withTestOnly(dependencyMatrix, testOnlyDependencies)),
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.cts", "**/*.mts", "**/*.js", "**/*.jsx", "**/*.cjs", "**/*.mjs"],
    // Override or add rules here
    rules: {},
  },
];
