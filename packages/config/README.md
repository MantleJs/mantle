# @mantlejs/config

Environment-aware configuration management for [Mantle JS](https://github.com/mantlejs/mantle). Loads JSON config files from a `config/` directory, merges environment-specific overrides, applies `MANTLE_*` env var overrides, and optionally validates the result against a TypeBox schema at startup.

---

## Installation

```bash
npm install @mantlejs/config
```

For schema validation, also install the peer dependency:

```bash
npm install @sinclair/typebox
```

---

## Concepts

### File loading order

Config is assembled by merging three sources in order — later values override earlier ones:

1. `config/default.json` — base config present in all environments
2. `config/{NODE_ENV}.json` — environment-specific overrides (e.g. `config/production.json`)
3. `MANTLE_*` environment variables — highest priority, applied last

### Environment variable overrides

Any env var prefixed with `MANTLE_` (configurable via `envPrefix`) maps to a config key. Double underscore (`__`) navigates nested objects:

```
MANTLE_PORT=8080              → config.port = 8080
MANTLE_DB__POOL__MAX=25       → config.db.pool.max = 25
```

Use `envPrefix` to namespace overrides to your own app name:

```
MYAPP_PORT=8080               → config.port = 8080
MYAPP_DB__POOL__MAX=25        → config.db.pool.max = 25
```

Values are coerced to `number` or `boolean` when the base config value has that type.

### Schema validation

Pass a TypeBox schema via `options.schema` and the plugin validates the merged config at startup. A mismatch throws `GeneralError('Invalid configuration', { errors })` before the server accepts any requests — fail fast, fail loud.

---

## Quick start

```
config/
  default.json
  production.json
```

```json
// config/default.json
{
  "port": 3030,
  "db": { "client": "pg", "pool": { "min": 2, "max": 10 } }
}

// config/production.json
{
  "port": 8080,
  "db": { "pool": { "max": 25 } }
}
```

```typescript
import { mantle } from "@mantlejs/core";
import { express } from "@mantlejs/express";
import { config } from "@mantlejs/config";
import { Type } from "@sinclair/typebox";

const AppConfigSchema = Type.Object({
  port: Type.Number(),
  db: Type.Object({
    client: Type.String(),
    pool: Type.Object({ min: Type.Number(), max: Type.Number() }),
  }),
});

const app = mantle()
  .configure(express())
  .configure(config({ schema: AppConfigSchema }));

// Read the whole merged config
const cfg = app.get<{ port: number; db: { client: string } }>("config");

// Top-level keys are also set individually for convenience
const port = app.get<number>("port"); // 3030 (or 8080 in production)
```

---

## API

### `config(options?)`

Returns a `MantlePlugin`. Call via `app.configure(config(options))`.

```typescript
import { config } from "@mantlejs/config";

app.configure(config({
  directory: "config",          // optional — default: process.cwd() + '/config'
  schema: AppConfigSchema,      // optional — TypeBox schema for startup validation
  envVar: "NODE_ENV",           // optional — env var that selects the overlay file
  envPrefix: "MYAPP_",          // optional — default: 'MANTLE_'
}));
```

Side effects:
- Sets `app.set('config', mergedConfig)` — the full merged object
- Sets `app.set(key, value)` for each top-level key in the merged config

#### `ConfigOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `directory` | `string` | `process.cwd() + '/config'` | Directory containing config JSON files |
| `schema` | `TSchema` | — | TypeBox schema; throws `GeneralError` if merged config is invalid |
| `envVar` | `string` | `"NODE_ENV"` | Env var used to select the environment overlay file |
| `envPrefix` | `string` | `"MANTLE_"` | Prefix for env var overrides — use your app name to avoid collisions |

---

## Accessing configuration

```typescript
// Full merged config object
const cfg = app.get<AppConfig>("config");

// Individual top-level keys (set as a convenience by the plugin)
const port = app.get<number>("port");
const dbClient = app.get<string>("db");  // only top-level keys are set this way

// Nested values require reading the full config
const maxPool = app.get<AppConfig>("config").db.pool.max;
```

---

## Environment variable overrides

| Env var | Maps to |
| --- | --- |
| `MANTLE_PORT=8080` | `config.port = 8080` |
| `MANTLE_DB__CLIENT=mysql2` | `config.db.client = "mysql2"` |
| `MANTLE_DB__POOL__MAX=25` | `config.db.pool.max = 25` |

With `envPrefix: "MYAPP_"`:

| Env var | Maps to |
| --- | --- |
| `MYAPP_PORT=8080` | `config.port = 8080` |
| `MYAPP_DB__POOL__MAX=25` | `config.db.pool.max = 25` |

Key segments are lowercased. Values are coerced:
- If the existing value is a `number`, the env string is passed through `Number()`.
- If the existing value is a `boolean`, `"true"` and `"1"` become `true`; everything else becomes `false`.
- Otherwise the raw string is used.

---

## Types

```typescript
import type { ConfigOptions } from "@mantlejs/config";
```

| Type | Description |
| --- | --- |
| `ConfigOptions` | Options passed to `config()` |

---

## Development

```bash
npx nx build config   # compile
npx nx test config    # run tests
npx nx lint config    # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build config
```

First publish (scoped packages require `--access public`):

```bash
cd packages/config
npm publish --access public
```

Subsequent releases — bump `version` in `packages/config/package.json`, then:

```bash
cd packages/config
npm publish
```
