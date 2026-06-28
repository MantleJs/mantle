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

### Templates

| Template  | Description                                      |
| --------- | ------------------------------------------------ |
| `minimal` | Bare Mantle app — kernel only, no adapters       |
| `full`    | Mantle + Express + Knex + Auth + Logger wired up |

---

## Quick start

```bash
# Scaffold a new project
npm create mantle@latest my-app

# Move into the project
cd my-app

# Install dependencies
npm install

# Start the dev server
npm run dev
```

---

## API

### `createMantle(options)`

Programmatic entry point used by the CLI bin. Returns a `Promise<void>` that resolves when the project has been scaffolded.

```typescript
import { createMantle } from "create-mantle";

await createMantle({
  name: "my-app",
  directory: "./my-app",
  template: "full",
});
```

#### Options

| Option      | Type                  | Default     | Description                                              |
| ----------- | --------------------- | ----------- | -------------------------------------------------------- |
| `name`      | `string`              | —           | Project name (required). Written to `package.json`.      |
| `directory` | `string`              | —           | Target directory where files will be written (required). |
| `template`  | `"minimal" \| "full"` | `"minimal"` | Which starter template to use.                           |

---

## Types

```typescript
import type { CreateMantleOptions } from "create-mantle";
```

| Type                  | Description                          |
| --------------------- | ------------------------------------ |
| `CreateMantleOptions` | Options accepted by `createMantle()` |

---

## Development

```bash
npx nx build create-mantle   # compile
npx nx test create-mantle    # run tests
npx nx lint create-mantle    # lint
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
