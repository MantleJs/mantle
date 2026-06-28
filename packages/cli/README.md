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

`@mantlejs/cli` has two top-level commands:

- **`mantle new`** — scaffold a complete runnable Mantle project from scratch. Prompts for transport, database, auth strategy, and package manager, then writes all boilerplate files and runs install.
- **`mantle generate` (alias `g`)** — add generated code into an existing project. Generates services, hooks, and repositories following Mantle's layer conventions.

Generated service tests use `@mantlejs/memory` so they run without a database.

---

## Quick start

```bash
# Scaffold a new project (interactive prompts)
mantle new my-api

# Scaffold with flags (non-interactive)
mantle new my-api --database pg --auth local --package-manager npm

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
| `--database` | `pg`, `sqlite`, `none` | prompted | Database adapter |
| `--auth` | `local`, `google`, `github`, `none` | prompted | Auth strategy |
| `--package-manager` | `npm`, `yarn`, `pnpm` | prompted | Package manager |
| `--skip-install` | — | `false` | Skip running install after scaffold |

When `--database`, `--auth`, or `--package-manager` are omitted, the CLI prompts interactively.

---

### `mantle generate <generator> <name>` (alias `g`)

Generates code in `src/services/<name>/` by default. Override with `--directory <path>`.

| Generator | Alias | Files generated |
|---|---|---|
| `service` | `s` | `<name>.service.ts`, `<name>.repository.ts`, `<name>.schema.ts`, `<name>.service.spec.ts` |
| `hook` | `h` | `<name>.hook.ts`, `<name>.hook.spec.ts` |
| `repository` | `r` | `<name>.repository.ts` |

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
| `GeneratorName` | `"service" \| "hook" \| "repository"` |
| `Transport` | `"express"` |
| `Database` | `"pg" \| "sqlite" \| "none"` |
| `Auth` | `"local" \| "google" \| "github" \| "none"` |
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
