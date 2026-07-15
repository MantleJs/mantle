# @mantlejs/express

Express HTTP transport adapter for Mantle JS. Mounts each registered service as a set of REST routes and converts `MantleError` instances to the correct HTTP status codes.

## Installation

```bash
npm install @mantlejs/express express
npm install --save-dev @types/express
```

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";

const app = mantle().configure(express());

app.use("users", new UserService(), {
  methods: ["find", "get", "create", "patch", "remove"],
});

app.listen(3030, () => console.log("Listening on port 3030"));
```

## API

### `express(existingApp?, options?)`

Returns a `MantlePlugin`. When applied via `app.configure(express())`, it:

- Creates (or reuses) an Express application and stores it under `app.get("express")`.
- Patches `app.use()` so that every service registration automatically mounts REST routes.
- Attaches an error handler after all routes are registered.
- Adds `app.listen(port, callback?)` as a shorthand for `expressApp.listen(...)`.
- Optionally mounts a `GET /_services` introspection endpoint (see below).

#### `ExpressOptions`

| Field           | Type                             | Default | Description                                                        |
| --------------- | -------------------------------- | ------- | ------------------------------------------------------------------ |
| `introspection` | `boolean \| { path?: string }`   | `false` | Mount the introspection endpoint; pass `{ path }` to customize it. |

Pass an existing Express app if you need to share middleware or configure Express yourself:

```typescript
import expressLib from "express";
import { express } from "@mantlejs/express";

const expressApp = expressLib();
expressApp.use(cors());

const app = mantle().configure(express(expressApp));
```

Add raw Express middleware by passing a function to `app.use()`:

```typescript
app.use(morgan("dev"));
```

---

### Route mapping

Each method in `options.methods` is mapped to an HTTP route:

| Service method | HTTP route              | Status |
| -------------- | ----------------------- | ------ |
| `find`         | `GET /path`             | 200    |
| `get`          | `GET /path/:id`         | 200    |
| `create`       | `POST /path`            | 201    |
| `update`       | `PUT /path/:id`         | 200    |
| `patch`        | `PATCH /path/:id`       | 200    |
| `remove`       | `DELETE /path/:id`      | 200    |
| custom method  | `POST /path/:method`    | 200    |

Custom methods (any name beyond the six standard ones) are mounted as `POST /path/:method` and routed through `ServiceHandle.dispatch()`.

Query string parameters are passed to the service as `params.query`. Request headers are available as `params.headers`. `params.provider` is always `"rest"` for HTTP-originated calls.

---

### Introspection endpoint

Opt in to a machine-readable service catalog:

```typescript
app.configure(express(undefined, { introspection: true }));
// or with a custom path:
app.configure(express(undefined, { introspection: { path: "/__meta" } }));
```

`GET /_services` (or the custom path) then returns a `ServiceDescriptor[]` — one entry per
registered service with `path`, `methods`, `events`, `schema`, the repository's `capabilities`
(when the service exposes them, e.g. `RepositoryService`), and `authRequired`. Off by default;
without the option the route 404s.

---

### `errorHandler()`

Standalone Express error-handling middleware. It is attached automatically by `express()`, but can also be used directly if you manage your own Express app:

```typescript
import { errorHandler } from "@mantlejs/express";

expressApp.use(errorHandler());
```

`MantleError` subclasses are serialized to JSON with the correct HTTP status code. Any other error becomes a 500 response.

## Development

```bash
npx nx build express    # compile
npx nx test express     # run tests
npx nx lint express     # lint
```

## Publishing

Build before publishing:

```bash
npx nx build express
```

First publish (scoped packages require `--access public`):

```bash
cd packages/express
npm publish --access public
```

Subsequent releases — bump `version` in `packages/express/package.json`, then:

```bash
cd packages/express
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/express
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/express --registry http://localhost:4873
```
