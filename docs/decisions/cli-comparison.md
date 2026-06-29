# CLI: Mantle vs FeathersJS

Comparison of `@mantlejs/cli` against `@feathersjs/cli` (v5 / Dove), covering workspace and project setup, project scaffolding, service generation, schema integration, test patterns, generator breadth, the separate-generators-package question, and an assessment of `@featherscloud/pinion`.

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

The practical gap: Feathers generates more wired-up infrastructure on day one (logger, auth setup, migrations). Mantle generates a leaner `src/app.ts` and treats those concerns as deliberate add-on steps — addressed in Phase 3 by `mantle add` and the new generators.

---

## Summary table

| Feature | Mantle | FeathersJS |
|---|---|---|
| Entry point | `npx @mantlejs/cli new` / `mantle new` | `npm create feathers@latest` / `feathers generate` |
| Project scaffold prompts | transport, database, auth, package manager | framework (Koa/Express), database, transport (REST+realtime or REST only), auth |
| `add` command | ✅ `mantle add <package>` (Phase 3) | ❌ |
| Generators | `service`, `hook`, `repository`, `authentication`, `migration` | `service`, `hook`, `middleware`, `authentication`, `connection` |
| Schema integration | TypeBox schema file per service | TypeBox schema baked into service generator (schema, resolvers, validators) |
| Generated service test repo | `@mantlejs/memory` | `@feathersjs/memory` |
| Generated test runner | Vitest | Mocha (v5) |
| Authentication generator | ✅ `mantle g authentication` (Phase 3) | ✅ `feathers generate authentication` |
| Migration generator | ✅ `mantle g migration <name>` (Phase 3) | ✅ Knex migrations (SQL adapters) |
| Middleware generator | ❌ | ✅ `feathers generate middleware` |
| Multiple frameworks | ✅ Express + Koa (Phase 3) | ✅ Express or Koa |
| TypeScript / JavaScript | TypeScript only | TypeScript or JavaScript |
| Package manager detection | Prompted at `new`; auto-detected via lockfile for `add` | Auto-detected from lockfile |
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
| Framework choice | Express only at `new`; Koa added via `mantle add @mantlejs/koa` | Express or Koa offered at scaffold time |
| Realtime in scaffold | Not bundled — add via `mantle add @mantlejs/socketio` | Offered as a scaffold prompt option |
| Logger in scaffold | Not bundled — add via `mantle add @mantlejs/logger` | `src/logger.ts` generated automatically |
| Database migrations | Not included at scaffold; add via `mantle g migration` | Knex migration scaffolding included for SQL |
| Config system | `config/default.json` + `config/production.json` | `@feathersjs/configuration` wrapper |

FeathersJS makes more upfront decisions at scaffold time. Mantle generates a leaner bootstrap and leaves optional concerns (`@mantlejs/logger`, `@mantlejs/socketio`) as explicit add-on steps via `mantle add`. The tradeoff: Feathers gets you further with one command; Mantle's output is smaller and easier to reason about, and `mantle add` bridges the gap for common additions.

---

## `mantle add` vs no equivalent in Feathers (Phase 3)

Mantle's `mantle add <package>` command has no direct equivalent in FeathersJS. It:

1. Detects the package manager from the lockfile (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, default → npm)
2. Runs the appropriate install command
3. Uses the **TypeScript compiler API** (AST walk via `ts.createSourceFile`) to locate the outermost `mantle()` call chain in `src/app.ts`
4. Inserts the import declaration after the last existing import and appends `.configure(plugin())` to the chain — no regex, position-derived from the AST node's `getEnd()`
5. Prints `.env` additions for packages that need secrets

Wiring templates are shipped for: `@mantlejs/logger`, `@mantlejs/socketio`, `@mantlejs/koa`, `@mantlejs/auth`, `@mantlejs/auth-local`, `@mantlejs/auth-google`, `@mantlejs/auth-github`, `@mantlejs/auth-facebook`, `@mantlejs/sync`, `@mantlejs/config`. Unknown packages print manual instructions.

FeathersJS has no equivalent install-and-wire command. Users manually `npm install` and wire packages into `app.ts`. The closest analogy is `feathers generate connection`, which adds a database connection but does not install the adapter.

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

### Mantle (Phase 3)

| Generator | Command |
|---|---|
| Service | `mantle g service` |
| Hook | `mantle g hook` |
| Repository | `mantle g repository` |
| Authentication | `mantle g authentication` (alias: `g auth`) |
| Migration | `mantle g migration <name>` (alias: `g m`) |

**Notable gaps:**

- **Middleware generator** — Not applicable to Mantle's layer model (HTTP middleware lives in the transport layer, not in services or hooks).
- **Database connection generator** — `mantle add @mantlejs/knex` covers the install-and-wire step; there is no separate "connection" file generator.
- **Repository generator is Mantle-specific** — there is no equivalent in FeathersJS because Feathers ties data access directly to the service adapter.

**Mantle's authentication generator** reads installed `@mantlejs/auth-*` packages from the project's `package.json` and generates `src/authentication.ts` with the appropriate imports and `app.configure()` calls for each detected strategy. FeathersJS's auth generator prompts for the strategy choices, making it usable on a fresh project; Mantle's detects what's already installed.

**Mantle's migration generator** requires `@mantlejs/knex` to be present and writes `migrations/<timestamp>_<name>.ts` with `up`/`down` stubs following Knex conventions (timestamp format: `YYYYMMDDHHmmss`).

---

## Separate generators package: is there a benefit?

FeathersJS splits its CLI into two npm packages:

| Package | Version | Purpose | Key deps |
|---|---|---|---|
| `@feathersjs/cli` | 5.0.46 | Binary entry point | `@feathersjs/generators`, `chalk`, `commander` |
| `@feathersjs/generators` | 5.0.46 | Generator logic | `@featherscloud/pinion`, `chalk`, `lodash`, `prettier`, `typescript` |

The `cli` package is a thin binary that delegates everything to `generators`. The `generators` package can be imported programmatically — by IDE extensions, build tools, or other CLIs — without pulling in `commander` or a binary wrapper.

**Why FeathersJS made this split:**

1. **Programmatic API without a binary**: A VS Code extension or JetBrains plugin can `import { generateService } from "@feathersjs/generators"` without running a subprocess.
2. **Isolated heavy deps**: `typescript`, `prettier`, and `pinion` live in `generators`, keeping the binary thin.
3. **Separate versioning**: Generator logic and binary can be released independently (in practice, they stay in sync at 5.0.46).

**Mantle's current approach:**

`@mantlejs/cli` already exposes a programmatic API via `src/index.ts`:

```typescript
export { newProject } from "./lib/new.js";
export { addPackage } from "./lib/add.js";
export type { GeneratorName, GenerateOptions, AddOptions, ... } from "...";
```

`create-mantle` already consumes this API — it calls `newProject()` directly without running a subprocess. The same pattern would work for any IDE integration.

**Verdict: not worth splitting at this stage.**

The current structure already provides the programmatic surface. Splitting into `@mantlejs/generators` + `@mantlejs/cli` would:
- Add one more package to maintain, publish, and version
- Provide no new capability — the functions are already exported from `src/index.ts`
- Create an obligation to keep the split clean before there are real consumers that need it

The split makes sense when concrete consumers exist (VS Code extension, JetBrains plugin, MCP tool that calls generators directly). That is a Phase 4 concern. Re-evaluate when the first IDE integration is built.

---

## `@featherscloud/pinion`: worth adopting?

### What it is

Pinion (`@featherscloud/pinion`, v0.5.7) is a TypeScript code generation task runner built by the FeathersJS maintainers. Its key modules:

| Module | Purpose |
|---|---|
| `tasks/render.ts` | Write files from template strings |
| `tasks/inject.ts` | Inject content into existing files at marked positions |
| `tasks/prompt.ts` | Collect user input (wraps `inquirer`) |
| `tasks/fs.ts` | File system helpers |
| `tasks/exec.ts` | Run shell commands |
| `tasks/conditionals.ts` | Conditional task execution |

Dependencies: `inquirer`, `chalk`, `commander`, `tsx`, `@types/inquirer`.

Generators are functions that take a context object and return a modified context, composing Pinion tasks in a pipeline:

```typescript
// FeathersJS generators pattern with Pinion
export const generate = (ctx: Context) =>
  Promise.resolve(ctx)
    .then(prompt([{ type: 'input', name: 'name', message: 'Service name?' }]))
    .then(renderSource('service.ts.tpl', 'src/services/{{ name }}.ts'))
    .then(injectSource('src/app.ts', { marker: '// services', template: "app.use('/{{ name }}', ...);" }))
    .then(install(['@feathersjs/knex']));
```

### What Pinion offers vs Mantle's current approach

| Capability | Pinion | Mantle CLI today |
|---|---|---|
| Template rendering | `render()` task | Template literal functions |
| File injection | `inject()` with string markers | TypeScript compiler API (AST-based) |
| Prompt integration | `prompt()` wrapping `inquirer` | `prompts` library |
| Pipeline composition | `Promise.resolve(ctx).then(task1).then(task2)` | Sequential `await` calls |
| Prettier formatting | Built into `renderSource()` | Not yet (output is unformatted) |
| JS transpilation | `getJavaScript()` via TypeScript API | N/A (TypeScript only) |

### Why Mantle should not adopt it

**1. Pinion's file injection is marker-based; Mantle's is AST-based.**
Pinion's `inject()` finds a comment marker (e.g., `// services`) in the target file and inserts text near it. This requires that generated project files contain specific marker comments, creating a coupling between the generator and the template output. Mantle's `mantle add` uses the TypeScript compiler API to find the `mantle()` chain by walking the AST — it works on any valid `app.ts`, not only on files the CLI scaffolded.

**2. Pinion is pre-1.0 and Feathers-specific.**
At v0.5.7 with no semantic versioning guarantees before 1.0, and with essentially one consumer in the wild (FeathersJS itself), adopting it would introduce a volatile external dependency into a core tool. The weekly download count for `@featherscloud/pinion` is low relative to general-purpose alternatives.

**3. The pipeline model adds no value at Mantle's generator complexity.**
Mantle's generators are short, single-purpose functions: write a file, maybe read a `package.json`. A promise pipeline adds indirection without improving readability at this scale. Feathers generators are more complex (TypeScript/JavaScript dual output, multi-step context enrichment, multi-file injection) — the pipeline pays off there.

**4. Prettier integration is the one genuine gap.**
Pinion's generators run Prettier on output. Mantle's generated files are hand-formatted template strings — they're consistent but not Prettier-formatted. This is worth addressing independently: add `prettier` as a dev dependency and run `prettier.format(content, { parser: "typescript" })` in `writeGeneratedFile`. This gives the same benefit without taking the Pinion dependency.

**Verdict: do not adopt Pinion.** Address the Prettier formatting gap directly.

---

## What FeathersJS does better

- **Richer generator set** — authentication, middleware, and database connection generators reduce manual wiring for common concerns.
- **Schema-to-hooks wiring in one step** — generated service code is immediately runnable with validation and field-stripping in place.
- **Framework choice at scaffold time** — Koa and Express are offered without any additional work.
- **Migration scaffolding** — SQL adapters generate the initial Knex migration file.
- **Package manager auto-detection** — Feathers reads the lockfile to infer npm/yarn/pnpm rather than prompting.
- **Prettier-formatted output** — generator output is run through Prettier automatically.
- **JavaScript support** — Feathers can generate JS or TS projects; Mantle is TypeScript only.

---

## What Mantle does better

- **Clean Architecture from line one** — generated services depend on `Repository<T>` (the interface), not a concrete adapter. `MemoryRepository` is a drop-in for testing with no type assertions.
- **Separation of concerns in schema** — schema, resolver, and validator are independent files/hooks rather than one dense generated file. Each piece is understandable on its own.
- **Isolated unit tests** — generated specs test the service class directly, with no application bootstrap, configuration files, or environment dependencies.
- **Simpler output** — generated code contains no framework-specific hooks or resolver classes; a developer can read and understand it without knowing the Mantle internals first.
- **`repository` generator** — generates a repository as a first-class artifact, reflecting the explicit Infrastructure layer in Mantle's architecture.
- **`mantle add <package>`** — installs a package and wires it into `app.ts` automatically using AST manipulation; no FeathersJS equivalent exists.
- **AST-based file modification** — `mantle add` works on any valid `app.ts`, not only on files with specific comment markers.
