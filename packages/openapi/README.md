# @mantlejs/openapi

OpenAPI 3.1 document generation for Mantle JS — walks your registered services and serves a live spec (and optional Swagger UI) with zero configuration.

## Installation

```bash
npm install @mantlejs/openapi
```

`@mantlejs/mantle` is a peer dependency, and an HTTP transport (`@mantlejs/express`, `@mantlejs/koa`, or `@mantlejs/http`) must be configured first.

---

## Concepts

### Introspection-driven

The plugin consumes `ServiceHandle.describe()` — the same machinery behind the transports' `/_services` endpoint. For every registered service it reads:

- **`methods`** → REST operations (`find` → `GET /path`, `get` → `GET /path/{id}`, `create` → `POST /path`, `update` → `PUT /path/{id}`, `patch` → `PATCH /path/{id}`, `remove` → `DELETE /path/{id}`, custom methods → `POST /path/{method}`).
- **`schema`** → the entity schema under `components.schemas` (a TypeBox schema stored via `ServiceOptions.schema` is JSON Schema and is embedded as-is). Services without a schema still appear with a generic `object` schema — missing coverage never skips a service or errors.
- **`authRequired`** → operations are marked with `bearerAuth` security when an auth hook (e.g. `authenticate("jwt")` from `@mantlejs/auth`) is registered in `before.all`. The `bearerAuth` security scheme is added to `components.securitySchemes` when at least one service requires it.
- **`capabilities`** → when the service exposes repository capabilities (e.g. `RepositoryService`), `find` responses are documented as the `Paginated<T>` envelope and the supported query operators are listed in the operation description.

### Live document

The document is rebuilt on every request to `specPath`, so hooks and services registered after startup are always reflected.

### Configure order

`openapi()` mounts its routes through the transport-neutral `"http:router"` contract, so configure it **after** the transport and **before** registering services:

```typescript
const app = mantle()
  .configure(express())
  .configure(openapi());
```

---

## Quick start

```typescript
import { mantle, RepositoryService } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { openapi } from "@mantlejs/openapi";

const app = mantle()
  .configure(express())
  .configure(
    openapi({
      docsPath: "/docs",
      info: { title: "My API", version: "1.0.0" },
    }),
  );

app.use("users", new RepositoryService(new UserRepository(app), { schema: userSchema }), {
  schema: userSchema,
});

app.listen(3030);
// GET /openapi.json → OpenAPI 3.1 document
// GET /docs         → Swagger UI
```

---

## API

### `openapi(options?)`

Returns a `MantlePlugin`. Mounts `GET <specPath>` serving the OpenAPI 3.1 JSON document, and optionally `GET <docsPath>` serving a Swagger UI page (loaded from the unpkg CDN — the package itself stays dependency-free).

#### `OpenApiOptions`

| Field      | Type                                                       | Default           | Description                                       |
| ---------- | ---------------------------------------------------------- | ----------------- | ------------------------------------------------- |
| `specPath` | `string`                                                   | `"/openapi.json"` | Route the JSON document is served from.           |
| `docsPath` | `string`                                                   | —                 | When set, serves Swagger UI at this route.        |
| `info`     | `{ title?: string; version?: string; description?: string }` | `{ title: "Mantle API", version: "0.0.0" }` | OpenAPI `info` object. |

Throws `GeneralError` at configure time when no HTTP transport has registered `"http:router"`.

### `buildOpenApiDocument(descriptors, info?)`

The pure document assembler, exported for tooling that wants the document without mounting routes:

```typescript
import { buildOpenApiDocument } from "@mantlejs/openapi";

const doc = buildOpenApiDocument(
  ["users", "orders"].map((path) => app.service(path).describe()),
  { title: "My API", version: "1.0.0" },
);
```

Every document also includes a `MantleError` schema referenced by each operation's `default` error response.

---

## Types

```typescript
import type { OpenApiOptions, OpenApiInfo } from "@mantlejs/openapi";
```

| Type             | Description                                    |
| ---------------- | ---------------------------------------------- |
| `OpenApiOptions` | Options object accepted by `openapi()`         |
| `OpenApiInfo`    | The document `info` metadata (title, version)  |

---

## Development

```bash
npx nx build openapi     # compile
npx nx test openapi      # run tests
npx nx lint openapi      # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build openapi
```

First publish (scoped packages require `--access public`):

```bash
cd packages/openapi
npm publish --access public
```

Subsequent releases — bump `version` in `packages/openapi/package.json`, then:

```bash
cd packages/openapi
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/openapi
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/openapi --registry http://localhost:4873
```
