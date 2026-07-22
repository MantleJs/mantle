# create-mantle

Project initializer for [Mantle JS](https://github.com/mantlejs/mantle) — scaffold a new Mantle application with a single `npm create` command.

---

## Installation

No installation needed. Run directly with your package manager:

```bash
npm create mantle@latest my-app
# or
npx create-mantle my-app
```

---

## Concepts

### npm create convention

`create-mantle` follows the npm initializer convention. Running `npm create mantle my-app` resolves to `create-mantle` on the npm registry and invokes the `create-mantle` bin. This means users never need to install the package globally.

`create-mantle` is a thin wrapper around `@mantlejs/cli`'s `newProject()` — see that package's
README for the full scaffold surface (database/auth/CORS/Redis options, what gets generated).

---

## Quick start

```bash
# Scaffold a new project (interactive prompts)
npm create mantle@latest my-app

# Scaffold non-interactively (flags go after `--`)
npm create mantle@latest my-app -- --database pg --auth local --package-manager npm

# Move into the project
cd my-app

# Install dependencies
npm install

# Start the dev server
npm run dev
```

---

## API

### `newProject(name, options)`

Re-exported from `@mantlejs/cli`; the bin's programmatic entry point. Returns a `Promise<void>`
that resolves once the project has been scaffolded (and installed, unless `skipInstall` is set).

```typescript
import { newProject } from "create-mantle";

await newProject("my-app", {
  database: "pg",
  auth: "local",
  packageManager: "npm",
});
```

#### CLI flags

| Flag | Values | Default | Description |
|---|---|---|---|
| `--database <db>` | `pg`, `sqlite`, `mongodb`, `none` | prompted | Database adapter |
| `--auth <auth>` | `local`, `google`, `github`, `facebook`, `apple`, `microsoft`, `linkedin`, `none` | prompted | Auth strategy |
| `--cors` | — | `false` | Enable CORS on the transport |
| `--redis` | — | `false` | Wire `@mantlejs/auth-redis` state/refresh-token stores |
| `--package-manager <pm>` | `npm`, `yarn`, `pnpm` | prompted | Package manager |
| `--skip-install` | — | `false` | Skip running install after scaffold |

---

## Types

```typescript
import type { NewProjectOptions, Database, Auth, PackageManager } from "create-mantle";
```

| Type | Description |
|---|---|
| `NewProjectOptions` | Options accepted by `newProject()` |
| `Database` | `"pg" \| "sqlite" \| "mongodb" \| "none"` |
| `Auth` | `"local" \| "google" \| "github" \| "facebook" \| "apple" \| "microsoft" \| "linkedin" \| "none"` |
| `PackageManager` | `"npm" \| "yarn" \| "pnpm"` |

---

## Development

```bash
npx nx build create-mantle   # compile
npx nx test create-mantle    # run tests
npx nx lint create-mantle    # lint
npx nx run create-mantle:e2e-scaffold   # full scaffold → build → test → boot → CRUD → SIGTERM smoke test
```

---

## Publishing

Build before publishing:

```bash
npx nx build create-mantle
```

First publish:

```bash
cd packages/create-mantle
npm publish --access public
```

Subsequent releases — bump `version` in `packages/create-mantle/package.json`, then:

```bash
cd packages/create-mantle
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/create-mantle
npm publish --registry http://localhost:4873

# Test the initializer
npm create mantle my-test-app --registry http://localhost:4873
```
