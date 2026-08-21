# @mantlejs/cli

Developer CLI for [Mantle JS](https://github.com/mantlejs/mantle). Scaffold new projects and generate services, repositories, and hooks from the terminal.

---

## Installation

```bash
npm install --global @mantlejs/cli
```

Or run without installing:

```bash
npx @mantlejs/cli new my-api
```

---

## Concepts

`@mantlejs/cli` has three top-level commands:

- **`mantle new`** — scaffold a complete runnable Mantle project from scratch. Prompts for transport, database, auth strategy, and package manager, then writes all boilerplate files and runs install.
- **`mantle generate` (alias `g`)** — add generated code into an existing project. Generates services, hooks, and repositories following Mantle's layer conventions.
- **`mantle add`** — install a Mantle package into an existing project and, for packages with known wiring, automatically add the import and `.configure()` call to `src/app.ts`.

Generated service tests use `@mantlejs/memory` so they run without a database.

---

## Quick start

```bash
# Scaffold a new project (interactive prompts)
mantle new my-api

# Scaffold with flags (non-interactive)
mantle new my-api --database pg --auth local --package-manager npm

# Scaffold with CORS and Redis-backed OAuth state/refresh-token storage
mantle new my-api --database mongodb --auth google --cors --redis --package-manager npm

# Generate a service, repository, schema, and spec
mantle g service users

# Generate a hook
mantle g hook authenticate

# Generate a repository only
mantle g repository users
```

---

## API

### `mantle new <project-name>`

Scaffolds a new Mantle project in `./<project-name>/`:

```
<project-name>/
├── src/
│   ├── app.ts               # Application bootstrap
│   ├── index.ts             # Entry point — app.listen()
│   └── services/
│       └── .gitkeep
├── config/
│   ├── default.json
│   └── production.json
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

**Options:**

| Option | Choices | Default | Description |
|---|---|---|---|
| `--transport` | `express` | `express` | HTTP transport |
| `--database` | `pg`, `sqlite`, `mongodb`, `none` | prompted | Database adapter |
| `--auth` | `local`, `google`, `github`, `facebook`, `apple`, `microsoft`, `linkedin`, `none` | prompted | Auth strategy |
| `--cors` | — | `false` | Enable CORS on the transport (`@mantlejs/express`'s `cors` option) |
| `--redis` | — | `false` | Wire `@mantlejs/auth-redis` state/refresh-token stores (ignored when `--auth none`) |
| `--package-manager` | `npm`, `yarn`, `pnpm` | prompted | Package manager |
| `--skip-install` | — | `false` | Skip running install after scaffold |

When `--database`, `--auth`, or `--package-manager` are omitted, the CLI prompts interactively.
`--cors` and `--redis` are flag-only (no prompt) — omit them to leave both off.

`sqlite` scaffolds use Knex's `better-sqlite3` client, matching the `better-sqlite3` driver
dependency it installs. Every `--auth` choice takes `clientId`/`clientSecret`; `apple` additionally
takes `teamId`/`keyId`/`privateKey` in place of `clientSecret` (Sign in with Apple has no static
client secret, but still uses `clientId` as the Services ID).

---

### `mantle add <package>`

Installs a Mantle package into an existing project and wires it up automatically where possible.

```bash
mantle add @mantlejs/auth-local
```

1. Detects the project's package manager from its lockfile (`pnpm-lock.yaml` → pnpm, `yarn.lock` →
   yarn, otherwise npm) and installs `<package>`.
2. If the package has known wiring (e.g. `@mantlejs/logger`, `@mantlejs/socketio`, `@mantlejs/koa`,
   `@mantlejs/auth` and its strategy packages, `@mantlejs/mongodb`, `@mantlejs/sync`,
   `@mantlejs/config`), rewrites `src/app.ts` to add the import and `.configure()` call, and prints
   any required `.env` additions.
3. For a package with no known wiring, or when `src/app.ts` can't be automatically modified, prints
   the import and `.configure()` line to add manually instead of failing.

---

### `mantle generate <generator> <name>` (alias `g`)

Generates code in `src/services/<name>/` by default. Override with `--directory <path>`.

| Generator | Alias | Files generated |
|---|---|---|
| `service` | `s` | `<name>.service.ts`, `<name>.repository.ts`, `<name>.schema.ts`, `<name>.service.spec.ts` |
| `hook` | `h` | `<name>.hook.ts`, `<name>.hook.spec.ts` |
| `repository` | `r` | `<name>.repository.ts` |
| `authentication` | `auth` | `src/authentication.ts` (detected auth strategy config) |
| `migration` | `m` | `migrations/<timestamp>_<name>.ts` (requires `@mantlejs/knex`) |

`service`/`repository` detect the project's database from `package.json` and generate a matching
repository base class: `KnexRepository` (`@mantlejs/knex` installed), `MongoRepository`
(`@mantlejs/mongodb` installed), or `MemoryRepository` as the fallback (`--database none`).

**Examples:**

```bash
mantle g service users
mantle g s user-profile
mantle g hook rate-limit --directory src/hooks
mantle g repository messages
```

**Generated service test pattern** (uses `@mantlejs/memory` — no database needed):

```typescript
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

---

## Types

```typescript
import type { NewProjectOptions, GeneratorName } from "@mantlejs/cli";
```

| Type | Description |
|---|---|
| `NewProjectOptions` | Options accepted by `newProject()` |
| `GeneratorName` | `"service" \| "hook" \| "repository" \| "authentication" \| "migration"` |
| `Transport` | `"express"` |
| `Database` | `"pg" \| "sqlite" \| "mongodb" \| "none"` |
| `Auth` | `"local" \| "google" \| "github" \| "facebook" \| "apple" \| "microsoft" \| "linkedin" \| "none"` |
| `PackageManager` | `"npm" \| "yarn" \| "pnpm"` |

---

## Development

```bash
npx nx build cli     # compile
npx nx test cli      # run tests
npx nx lint cli      # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build cli
```

First publish (scoped packages require `--access public`):

```bash
cd packages/cli
npm publish --access public
```

Subsequent releases — bump `version` in `packages/cli/package.json`, then:

```bash
cd packages/cli
npm publish
```
