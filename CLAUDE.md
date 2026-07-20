# CLAUDE.md — Mantle JS

This file provides context for Claude Code to assist development on Mantle JS.
Read it fully before generating any code, adding packages, or modifying architecture.

---

## What is Mantle JS?

Mantle JS is a full-stack, tech-agnostic JavaScript/TypeScript framework for building
real-time applications and scalable web APIs. It follows Clean Architecture / Onion
Architecture principles, separating the service layer from data access logic.

The key differentiator from FeathersJS: in FeathersJS, a service couples business
logic directly with data access. In Mantle, `Service<T>` is a contract only —
data access lives in `Repository<T>` implementations in the Infrastructure layer.

**Name origin:** The Application Layer is the geological "mantle" — between the
database core and the UI crust.

---

## Architecture

### Layer Model

```
CRUST (UI)            React, Vue, Angular, iOS, Android
Transport Layer       Express adapter — routes HTTP to services
Application Layer     Service<T> contracts, hook pipeline   <- THE MANTLE
Domain Layer (Core)   Entities, Repository<T> interfaces
Infrastructure        KnexRepository — implements Domain interfaces (outer layer)
```

### Dependency Rule (non-negotiable)

- Dependencies always point inward
- Infrastructure implements interfaces defined by Domain — never the reverse
- Nothing in Domain or Application layers knows about HTTP or databases
- Phase 1: Application and Domain layers are co-located — full separation is opt-in

---

## Monorepo Structure

```
mantle/
├── packages/
│   ├── mantle/          @mantlejs/mantle       Framework kernel, zero external deps
│   ├── express/         @mantlejs/express      Express HTTP transport adapter
│   ├── koa/             @mantlejs/koa          Koa HTTP transport adapter
│   ├── http/            @mantlejs/http         Zero-dependency HTTP transport adapter (Node + Fetch API)
│   ├── knex/            @mantlejs/knex         SQL adapter via Knex.js (pg, mysql2, sqlite3…)
│   ├── dynamodb/        @mantlejs/dynamodb     Amazon DynamoDB adapter
│   ├── supabase/        @mantlejs/supabase     Supabase adapter (Postgres + Realtime)
│   ├── pinecone/        @mantlejs/pinecone     Pinecone vector database adapter
│   ├── qdrant/          @mantlejs/qdrant       Qdrant vector database adapter
│   ├── neo4j/           @mantlejs/neo4j        Neo4j graph database adapter
│   ├── mongodb/         @mantlejs/mongodb      MongoDB adapter (official driver) + Atlas Vector Search
│   ├── auth/            @mantlejs/auth         JWT engine + strategy runner
│   ├── auth-local/      @mantlejs/auth-local   Local email+password strategy (Argon2id)
│   ├── auth-oauth/      @mantlejs/auth-oauth   Shared OAuth 2.0 base (state, PKCE, find-or-create)
│   ├── auth-google/     @mantlejs/auth-google  Google Sign-In strategy (PKCE, no Passport.js)
│   ├── auth-github/     @mantlejs/auth-github  GitHub Sign-In strategy (no Passport.js)
│   ├── auth-facebook/   @mantlejs/auth-facebook Facebook Sign-In strategy (no Passport.js)
│   ├── auth-redis/      @mantlejs/auth-redis   Redis-backed refresh-token + OAuth-state stores
│   ├── storage/         @mantlejs/storage      File upload/download via busboy, local disk storage
│   ├── storage-s3/      @mantlejs/storage-s3   AWS S3 storage adapter for @mantlejs/storage
│   ├── storage-gcs/     @mantlejs/storage-gcs  Google Cloud Storage adapter for @mantlejs/storage
│   ├── logger/          @mantlejs/logger       Structured logging (pino)
│   ├── schema/          @mantlejs/schema       TypeBox schema validation + field resolution
│   ├── memory/          @mantlejs/memory       In-memory Repository<T> for testing/prototyping
│   ├── config/          @mantlejs/config       Environment-aware configuration loading
│   ├── socketio/        @mantlejs/socketio     Socket.IO transport adapter
│   ├── openapi/         @mantlejs/openapi      OpenAPI 3.1 document generation + Swagger UI
│   ├── mcp/             @mantlejs/mcp          MCP server — expose services as MCP tools (stdio + HTTP)
│   ├── sync/            @mantlejs/sync         Cross-instance event sync (Redis/Supabase Realtime)
│   ├── client/          @mantlejs/client       Browser/Node.js/React Native client SDK (REST + Socket.IO)
│   ├── react/           @mantlejs/react        React hooks over the client SDK (TanStack Query v5)
│   ├── cli/             @mantlejs/cli          Command-line interface — scaffold projects/services/hooks
│   └── create-mantle/   create-mantle          `npm create mantle` project initializer
├── docs/               scaffold.sh, PRD, TDD
└── CLAUDE.md           This file
```

### Package Dependency Rules (enforced by @nx/enforce-module-boundaries)

| Package                 | May depend on                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| @mantlejs/mantle        | nothing                                                                                     |
| @mantlejs/express       | @mantlejs/mantle                                                                            |
| @mantlejs/koa           | @mantlejs/mantle                                                                            |
| @mantlejs/http          | @mantlejs/mantle                                                                            |
| @mantlejs/knex          | @mantlejs/mantle                                                                            |
| @mantlejs/dynamodb      | @mantlejs/mantle                                                                            |
| @mantlejs/supabase      | @mantlejs/mantle                                                                            |
| @mantlejs/pinecone      | @mantlejs/mantle                                                                            |
| @mantlejs/qdrant        | @mantlejs/mantle                                                                            |
| @mantlejs/neo4j         | @mantlejs/mantle                                                                            |
| @mantlejs/mongodb       | @mantlejs/mantle                                                                            |
| @mantlejs/auth          | @mantlejs/mantle                                                                            |
| @mantlejs/auth-local    | @mantlejs/mantle, @mantlejs/auth                                                            |
| @mantlejs/auth-oauth    | @mantlejs/mantle, @mantlejs/auth                                                            |
| @mantlejs/auth-google   | @mantlejs/mantle, @mantlejs/auth-oauth                                                      |
| @mantlejs/auth-github   | @mantlejs/mantle, @mantlejs/auth-oauth                                                      |
| @mantlejs/auth-facebook | @mantlejs/mantle, @mantlejs/auth-oauth                                                      |
| @mantlejs/auth-redis    | @mantlejs/mantle, @mantlejs/auth, @mantlejs/auth-oauth                                      |
| @mantlejs/storage       | @mantlejs/mantle                                                                            |
| @mantlejs/storage-s3    | @mantlejs/mantle, @mantlejs/storage                                                         |
| @mantlejs/storage-gcs   | @mantlejs/mantle, @mantlejs/storage                                                         |
| @mantlejs/logger        | @mantlejs/mantle                                                                            |
| @mantlejs/schema        | @mantlejs/mantle                                                                            |
| @mantlejs/memory        | @mantlejs/mantle                                                                            |
| @mantlejs/config        | @mantlejs/mantle                                                                            |
| @mantlejs/socketio      | @mantlejs/mantle                                                                            |
| @mantlejs/openapi       | @mantlejs/mantle                                                                            |
| @mantlejs/mcp           | @mantlejs/mantle (+ @modelcontextprotocol/sdk)                                              |
| @mantlejs/sync          | @mantlejs/mantle                                                                            |
| @mantlejs/client        | nothing (optional peer: socket.io-client; dev-only: @mantlejs/mantle for conformance specs) |
| @mantlejs/react         | @mantlejs/client (peers: react, @tanstack/react-query)                                      |
| @mantlejs/cli           | nothing (standalone code generator)                                                         |
| create-mantle           | @mantlejs/cli                                                                               |

---

## Key Interfaces (all in @mantlejs/mantle)

### Service<T>

```typescript
interface Service<T, D = Partial<T>> {
  find(params?: ServiceParams): Promise<T[] | Paginated<T>>;
  get(id: Id, params?: ServiceParams): Promise<T>;
  create(data: D, params?: ServiceParams): Promise<T>;
  update(id: Id, data: D, params?: ServiceParams): Promise<T>;
  patch(id: Id, data: D, params?: ServiceParams): Promise<T>;
  remove(id: Id, params?: ServiceParams): Promise<T>;
}
```

Custom methods beyond these six must be explicitly registered in app.use() options.

### Repository<T>

```typescript
interface Repository<T, D = Partial<T>> {
  findAll(params?: QueryParams): Promise<T[]>;
  findById(id: Id): Promise<T | null>;
  save(data: D): Promise<T>;
  saveAll(data: D[]): Promise<T[]>;
  updateById(id: Id, data: D): Promise<T>;
  patchById(id: Id, data: D): Promise<T>;
  deleteById(id: Id): Promise<T>;
  count(params?: QueryParams): Promise<number>;
}
```

### QueryParams — supported where operators

```typescript
interface QueryParams {
  where?: Record<string, unknown>; // see operators below
  limit?: number;
  skip?: number;
  sort?: Record<string, "asc" | "desc">;
  select?: string[];
}
```

Operators supported in `where`:

- Equality: `{ field: value }` → `field = value`
- Null: `{ field: null }` → `IS NULL`
- Comparison: `$lt`, `$lte`, `$gt`, `$gte`
- Not-equal: `{ field: { $ne: value } }` (value `null` → `IS NOT NULL`)
- Inclusion: `$in`, `$nin`
- Logical: `$or`, `$and` (accept arrays of where clauses)
- Pattern: `$like`, `$notlike`, `$ilike` (PostgreSQL only)
- Containment: `$contains` (jsonb `@>` semantics; memory, supabase, knex on pg, dynamodb, mongodb)
- Nested paths: dot-path keys like `"metadata.tags"` (memory, supabase, mongodb; supabase maps to PostgREST `->`/`->>`, mongodb is native)

Adapters reject unsupported operators via `assertOperators` (BadRequest naming the operator).
The shared conformance fixture for nested-path + `$contains` semantics is exported from
`@mantlejs/mantle` (`NESTED_QUERY_RECORDS` / `NESTED_QUERY_CASES`); `@mantlejs/memory` is the
executable reference.

### HookContext<T>

```typescript
interface HookContext<T = any> {
  app: MantleApplication;
  service: Service<T>;
  path: string; // e.g. "users"
  method: string; // e.g. "create"
  provider?: string; // "rest" | undefined (internal)
  params: ServiceParams;
  data?: Partial<T>;
  id?: Id;
  result?: T | T[] | Paginated<T>;
  error?: Error;
}
```

### HookFunction<T>

All hooks are pure functions — no class-based hooks.

```typescript
type HookFunction<T = any> = (context: HookContext<T>) => Promise<HookContext<T>> | HookContext<T>;
```

### Error Classes

Always throw a typed error — never a plain new Error().

```typescript
throw new BadRequest("Invalid input"); // 400
throw new NotAuthenticated("Login required"); // 401
throw new Forbidden("Access denied"); // 403
throw new NotFound("User not found"); // 404
throw new Conflict("Email already exists"); // 409
throw new Unprocessable("Validation failed"); // 422
throw new GeneralError("Something broke"); // 500
```

---

## Typical Usage Pattern

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { knex } from "@mantlejs/knex";
import { auth, authenticate, sanitizeUser } from "@mantlejs/auth";
import { localStrategy, hashPassword } from "@mantlejs/auth-local";

const app = mantle()
  .configure(express())
  .configure(knex({ client: "pg", connection: process.env.DATABASE_URL }))
  .configure(auth({ secret: process.env.JWT_SECRET! }))
  .configure(localStrategy());

app.use("/users", new UserService(new UserRepository(app)), {
  methods: ["find", "get", "create", "update", "patch", "remove"],
});

app.service("users").hooks({
  before: {
    create: [hashPassword()],
    all: [authenticate("jwt")],
  },
  after: { all: [sanitizeUser()] },
  error: { all: [logError()] },
});

app.listen(3030);
```

### KnexRepository usage

```typescript
import { KnexRepository } from "@mantlejs/knex";

class UserRepository extends KnexRepository<User> {
  readonly tableName = "users";

  // Custom query using the raw query builder
  async findByEmail(email: string): Promise<User | null> {
    return this.db.where({ email }).first() ?? null;
  }
}

// Transaction example
const repo = new UserRepository(app);
await repo.withTransaction(async (txRepo) => {
  const user = await txRepo.save({ name: "Alice", email: "alice@example.com" });
  await txRepo.save({ userId: user.id, role: "admin" }); // hypothetical
});
```

---

## Nx Commands

```bash
npx nx build core                   # build one package
npx nx run-many -t build            # build all packages
npx nx test core                    # test one package
npx nx run-many -t test             # test all packages
npx nx run-many -t lint             # lint all packages
npx nx graph                        # visualise dependency graph

# Generate a new package (always use NX_DAEMON=false in scripts)
NX_DAEMON=false npx nx g @nx/js:library   --name=<name> --directory=packages/<name>   --bundler=tsc --unitTestRunner=vitest   --linter=eslint --publishable --importPath=@mantlejs/<name>
```

---

## Coding Conventions

| Convention      | Rule                                        |
| --------------- | ------------------------------------------- |
| Quotes          | Double quotes — enforced by Prettier        |
| Semicolons      | Required                                    |
| Trailing commas | All                                         |
| Print width     | 120 characters                              |
| Hooks           | Function-based only — no classes            |
| Exports         | Each package exports only from src/index.ts |
| Error handling  | Always throw a typed MantleError subclass   |
| any             | Banned — use unknown and narrow             |
| Test files      | Co-located with source, \*.spec.ts suffix   |

---

## What Not to Do

- Do not add SSR, file-based routing, or frontend rendering — Mantle is API-only
- Do not couple a service to a concrete repository — depend on the interface
- Do not put HTTP-specific logic inside a service or hook
- Do not overwrite Nx-generated eslint.config.mjs — add rules additively
- Do not overwrite Nx-generated package.json fields (exports, files, nx, name)
- Do not use class-based hooks
- Do not throw plain Error — always use a typed MantleError subclass
- Do not import across packages in violation of the dependency matrix above

---

## Key Technology Decisions

| Decision                | Choice                                             | Reason                                                       |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Monorepo                | Nx (TS preset, npm)                                | Task pipeline, module boundary enforcement                   |
| DB adapter              | @mantlejs/knex via Knex.js                         | Single package for all SQL databases; query builder not ORM  |
| Supported SQL databases | PostgreSQL (primary), MySQL/MariaDB, SQLite, MSSQL | Knex abstracts differences; `RETURNING *` fallback for MySQL |
| Password hashing        | @node-rs/argon2 (Argon2id)                         | OWASP recommended; no 72-char bcrypt limit                   |
| Testing                 | Vitest                                             | Faster than Jest, native ESM, Jest-compatible API            |
| Transport (P1)          | Express                                            | Most familiar; AI-legible                                    |
| Auth                    | auth + auth-local (two packages)                   | Engine separate from strategy                                |
| Bundler                 | tsc                                                | Emits .d.ts natively — critical for TS-first libraries       |
| Deployment              | Google Cloud Run                                   | Scales to zero; pairs with Cloud SQL                         |

<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->
