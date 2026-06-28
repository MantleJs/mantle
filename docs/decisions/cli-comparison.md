# CLI: Mantle vs FeathersJS

Comparison of `@mantlejs/cli` against `@feathersjs/cli` (v5 / Dove), covering workspace and project setup, project scaffolding, service generation, schema integration, test patterns, and generator breadth.

---

## Workspace & project setup

There are two distinct layers: the **framework development monorepo** (how each framework organizes its own packages), and the **generated application** (what the CLI writes for a new project).

### Framework monorepo

Both Mantle and FeathersJS v5 use **Nx + npm workspaces** for their own framework repos — they converged on the same internal tooling independently.

**Mantle's monorepo** was initialized with the `@nx/js` TypeScript preset. Key properties:

- Root `package.json` declares `"workspaces": ["packages/*"]`; all packages share a single `node_modules/` at the root
- Nx targets (`build`, `test`, `lint`) are **inferred** via plugins — `@nx/js/typescript`, `@nx/eslint/plugin`, `@nx/vitest` — so no `project.json` target entries are needed
- `tsconfig.base.json` at the root sets shared options (`strict`, `nodenext` module resolution, `es2022`) that every package extends
- A **custom export condition** `@mantle/source` is declared in each package's `exports` and in `tsconfig.base.json` `customConditions`. Inside the monorepo, imports between packages resolve to `src/index.ts` directly — the build step is only needed for publishing, not for development or testing within the repo
- `@nx/enforce-module-boundaries` enforces the package dependency matrix at lint time
- `nx release` coordinates versioning and publishing; `preVersionCommand` ensures all `dist/` outputs are fresh
- A **Verdaccio** local registry target (`nx run @mantle/source:local-registry`) tests `npm publish` flows without touching npmjs.com

**FeathersJS's framework repo** uses the same combination (Nx + npm workspaces, packages under `packages/`). The structural approach is similar; the internal tooling is not a meaningful differentiator between the two.

### Generated application — `mantle new` vs `npm create feathers@latest`

Neither CLI generates a monorepo or workspace. Both produce a **standalone single-package project** with no Nx, no workspace configuration, and no preset system in the Nx sense. Both embed file templates directly in their CLI source code.

| Aspect | `mantle new` | `npm create feathers@latest` |
|---|---|---|
| Workspace type | Standalone project | Standalone project |
| npm workspaces | ❌ | ❌ |
| Nx | ❌ | ❌ |
| Preset system | ❌ (embedded templates) | ❌ (embedded templates) |
| Module system | ESM (`"type": "module"`) | ESM (`"type": "module"`) |
| Module resolution | `Node16` | `Node16` |
| Compiler | `tsc` | `tsc` |
| Test runner | Vitest | Mocha + `ts-node` |
| Config files | `config/default.json`, `config/production.json` | `config/default.json`, `config/{NODE_ENV}.json` |
| Logger | Not generated (add `@mantlejs/logger` explicitly) | `src/logger.ts` pre-wired |
| Migration setup | Not generated | Knex migration directory (SQL adapters) |

The practical gap: Feathers generates more wired-up infrastructure on day one (logger, auth setup, migrations). Mantle generates a leaner `src/app.ts` and treats those concerns as deliberate add-on steps.

---

## Summary table

| Feature | Mantle | FeathersJS |
|---|---|---|
| Entry point | `npx @mantlejs/cli new` / `mantle new` | `npm create feathers@latest` / `feathers generate` |
| Project scaffold prompts | transport, database, auth, package manager | framework (Koa/Express), database, transport (REST+realtime or REST only), auth |
| Generators | `service`, `hook`, `repository` | `service`, `hook`, `middleware`, `authentication`, `connection` |
| Schema integration | TypeBox schema file per service | TypeBox schema baked into service generator (schema, resolvers, validators) |
| Generated service test repo | `@mantlejs/memory` | `@feathersjs/memory` |
| Generated test runner | Vitest | Mocha (v5) |
| Authentication generator | ❌ (configured in `app.ts` template) | ✅ `feathers generate authentication` |
| Migration generator | ❌ | ✅ Knex migrations (SQL adapters) |
| Middleware generator | ❌ | ✅ `feathers generate middleware` |
| Multiple frameworks | ❌ Express only (Phase 2) | ✅ Express or Koa |
| TypeScript / JavaScript | TypeScript only | TypeScript or JavaScript |
| Package manager detection | Prompted | Auto-detected from lockfile |
| Runtime imports from framework | ❌ (code generator only) | ❌ (code generator only) |

---

## Project scaffolding

### FeathersJS

```bash
npm create feathers@latest my-api
# Prompts:
#   - Framework: Express or Koa
#   - Database: MongoDB, PostgreSQL, MySQL, SQLite, MSSQL
#   - Transport: REST + real-time (Socket.io) or REST only
#   - Authentication strategy: none, local, OAuth
```

The generated project includes:
- `src/app.ts` — full application bootstrap
- `src/services/` — empty services directory
- `src/logger.ts` — preconfigured logger
- `src/configuration.ts` — config type definition
- Knex migrations directory (for SQL adapters)
- Database connection config files
- `mocha` + `ts-node` for testing

### Mantle

```bash
npx @mantlejs/cli new my-api
# Prompts (if flags omitted):
#   - Database: PostgreSQL, SQLite, none
#   - Auth: local, Google, GitHub, none
#   - Package manager: npm, yarn, pnpm
```

The generated project includes:
- `src/app.ts` — application bootstrap (adapts imports based on choices)
- `src/index.ts` — entry point calling `app.listen()`
- `src/services/` — empty services directory
- `config/default.json` + `config/production.json` — JSON config files
- `tsconfig.json`, `.env.example`, `.gitignore`, `README.md`
- `vitest` for testing

**Key differences:**

| Dimension | Mantle | FeathersJS |
|---|---|---|
| Framework choice | Express only (Phase 2) | Express or Koa |
| Realtime in scaffold | Not bundled — add `@mantlejs/socketio` separately | Offered as a scaffold prompt option |
| Logger in scaffold | Not bundled — add `@mantlejs/logger` separately | `src/logger.ts` generated automatically |
| Database migrations | Not included | Knex migration scaffolding included for SQL |
| Config system | `config/default.json` + `config/production.json` | `@feathersjs/configuration` wrapper |

FeathersJS makes more upfront decisions at scaffold time. Mantle generates a leaner bootstrap and leaves optional concerns (`@mantlejs/logger`, `@mantlejs/socketio`) as explicit add-on steps. The tradeoff: Feathers gets you further with one command; Mantle's output is smaller and easier to reason about.

---

## Service generation

### FeathersJS

```bash
feathers generate service users
```

Generates **five files** per service in `src/services/users/`:

```
users.ts           # service registration (app.use, hooks)
users.class.ts     # service implementation class (or adapter instantiation)
users.schema.ts    # TypeBox schema + resolvers + validators (all in one file)
users.shared.ts    # types and validators shared between client and server
```

`users.schema.ts` bundles schema definition, resolver configuration, and Ajv validator compilation together:

```typescript
// Generated users.schema.ts (FeathersJS v5)
export const userSchema = Type.Object({
  id: Type.Number(),
  email: Type.String(),
  password: Type.Optional(Type.String()),
}, { $id: 'User', additionalProperties: false });
export type User = Static<typeof userSchema>;
export const userValidator = getValidator(userSchema, dataValidator);
export const userResolver = resolve<User, HookContext>({
  password: virtual(async () => undefined), // strip password
});

export const userExternalResolver = resolve<User, HookContext>({
  password: virtual(async () => undefined),
});
```

The registration file wires the resolvers into hooks automatically:

```typescript
// Generated users.ts (FeathersJS v5)
app.use('users', new UserService(options), { ... });
app.service('users').hooks({
  around: { all: [schemaHooks.resolveExternal(userExternalResolver), ...] },
  before: { create: [schemaHooks.validateData(userDataValidator), ...] },
});
```

### Mantle

```bash
mantle g service users
# or: mantle g s users
```

Generates **four files** per service in `src/services/users/`:

```
users.service.ts        # service class implementing Service<Users>
users.repository.ts     # KnexRepository subclass with tableName
users.schema.ts         # TypeBox schema + Static type
users.service.spec.ts   # Vitest unit test using MemoryRepository
```

`users.schema.ts` is a plain schema — validation hooks and resolvers are added manually:

```typescript
// Generated users.schema.ts
import { Type, type Static } from "@mantlejs/schema";

export const UsersSchema = Type.Object({
  id:        Type.String({ format: "uuid" }),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" }),
});

export type Users = Static<typeof UsersSchema>;
```

The generated service depends on `Repository<T>` (the interface), not the concrete `KnexRepository`:

```typescript
// Generated users.service.ts
export class UsersService implements Service<Users> {
  constructor(private readonly repository: Repository<Users>) {}
  // ... all six methods implemented
}
```

**Key differences:**

| Dimension | Mantle | FeathersJS |
|---|---|---|
| Files per service | 4 | 4–5 (schema, class, service, shared, optionally migration) |
| Schema + resolvers | Separate files, wired manually | Bundled in `users.schema.ts`, auto-wired |
| Service class dependency | `Repository<T>` interface | Concrete adapter (e.g. `KnexService`) |
| Resolver pattern | `resolver<T>()` hook added manually | `resolve<T>()` from `@feathersjs/schema`, wired in generator |
| Database migration | Not generated | SQL adapters generate a Knex migration |

FeathersJS generates more complete, immediately runnable service code — resolvers, validators, and hooks are pre-wired. Mantle generates the structural skeleton and leaves validation/resolver configuration as deliberate, explicit additions. This makes Mantle's output easier to understand line-by-line, at the cost of more manual wiring.

The service-depends-on-interface design (`Repository<T>`) is a deliberate Mantle architectural choice: it enforces Clean Architecture from the first generated line and makes `MemoryRepository` swappable with no type casting.

---

## Schema integration

### FeathersJS

Schema is a first-class generator concern. `feathers generate service` always produces a schema file, and the generated resolver/validator wiring is idiomatic Feathers — `schemaHooks.resolveExternal()`, `schemaHooks.validateData()`, etc.

The `users.shared.ts` file lets the same schema and validators be imported by a client SDK, which is valuable for monorepos or Feathers client setups.

### Mantle

Schema is **generated but not wired**. `mantle g service` creates `users.schema.ts` with the TypeBox definition and type alias. Adding `validate()` or `resolver()` hooks is a separate, manual step:

```typescript
// Developer adds this after generation
import { validate, resolver } from "@mantlejs/schema";
import { UsersSchema } from "./users.schema.js";

app.service("users").hooks({
  before: {
    create: [validate(UsersSchema)],
  },
  after: {
    all: [resolver<Users>({ password: () => undefined })],
  },
});
```

**Tradeoff:** FeathersJS gives you working validation and field-stripping on day one. Mantle gives you a schema file that is easier to understand and extend without needing to know how `schemaHooks.*` works first. The manual wiring step is a learning opportunity, not just ceremony.

---

## Test generation

### FeathersJS

`feathers generate service` produces a test file using the `@feathersjs/memory` in-memory adapter:

```typescript
// Generated users.test.ts (FeathersJS v5)
import assert from 'assert';
import { app } from '../../src/app';

describe('users service', () => {
  it('registered the service', () => {
    const service = app.service('users');
    assert.ok(service, 'Registered the service');
  });
});
```

The test bootstraps the full application (`app`), so it runs through the real hook pipeline and service registration.

### Mantle

`mantle g service` produces a test using `@mantlejs/memory` directly, with no application bootstrap needed:

```typescript
// Generated users.service.spec.ts
import { MemoryRepository } from "@mantlejs/memory";
import { UsersService } from "./users.service.js";

describe("UsersService", () => {
  let repo: MemoryRepository<Users>;
  let service: UsersService;

  beforeEach(() => {
    repo = new MemoryRepository<Users>();
    service = new UsersService(repo);
  });

  it("creates a record", async () => {
    const record = await service.create({}, {});
    expect(record.id).toBeDefined();
  });
});
```

**Tradeoff:** FeathersJS's full-app bootstrap tests the service in the context of the running application — including hooks, middleware, and config. This catches integration bugs earlier. Mantle's generated test is a pure unit test — the service is exercised in complete isolation, which is faster and requires no app configuration. Integration-level testing (with a real app) is not generated but can be added by the developer.

---

## Generator breadth

### FeathersJS

| Generator | Command |
|---|---|
| Service | `feathers generate service` |
| Hook | `feathers generate hook` |
| Middleware | `feathers generate middleware` |
| Authentication | `feathers generate authentication` |
| Database connection | `feathers generate connection` |

### Mantle

| Generator | Command |
|---|---|
| Service | `mantle g service` |
| Hook | `mantle g hook` |
| Repository | `mantle g repository` |

**Notable gaps in Mantle (Phase 2):**

- **Authentication generator** — FeathersJS generates the full authentication setup (`src/authentication.ts`, service hooks, local strategy config). In Mantle, auth is wired directly in the scaffold template and in `app.ts`; there is no generator to add auth to an existing project.
- **Middleware generator** — Not applicable to Mantle's layer model (HTTP middleware lives in the transport layer, not in services or hooks).
- **Migration generator** — Mantle has no database migration scaffolding. This is expected to be addressed in Phase 3 (Knex migration integration).
- **Repository generator** is Mantle-specific — there is no equivalent in FeathersJS because Feathers ties data access directly to the service adapter rather than separating it.

---

## What FeathersJS does better

- **Richer generator set** — authentication, middleware, and database connection generators reduce manual wiring for common concerns.
- **Schema-to-hooks wiring in one step** — generated service code is immediately runnable with validation and field-stripping in place.
- **Framework choice at scaffold time** — Koa and Express are offered without any additional work.
- **Migration scaffolding** — SQL adapters generate the initial Knex migration file.
- **Package manager auto-detection** — Feathers reads the lockfile to infer npm/yarn/pnpm rather than prompting.

---

## What Mantle does better

- **Clean Architecture from line one** — generated services depend on `Repository<T>` (the interface), not a concrete adapter. `MemoryRepository` is a drop-in for testing with no type assertions.
- **Separation of concerns in schema** — schema, resolver, and validator are independent files/hooks rather than one dense generated file. Each piece is understandable on its own.
- **Isolated unit tests** — generated specs test the service class directly, with no application bootstrap, configuration files, or environment dependencies.
- **Simpler output** — generated code contains no framework-specific hooks or resolver classes; a developer can read and understand it without knowing the Mantle internals first.
- **`repository` generator** — generates a repository as a first-class artifact, reflecting the explicit Infrastructure layer in Mantle's architecture.
