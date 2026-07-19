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

| Field           | Type                                        | Default | Description                                                                       |
| --------------- | ------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `introspection` | `boolean \| { path?: string }`              | `false` | Mount the introspection endpoint; pass `{ path }` to customize it.                 |
| `batch`         | `boolean \| { path?: string; maxSize?: number }` | `true`  | Mount the `POST /batch` endpoint; `false` disables it, `{ path, maxSize }` configures it. |
| `cors`          | `boolean \| CorsOptions`                    | `false` | Enable CORS via the `cors` npm package; `true` uses permissive defaults, an object customizes origin/methods/headers/credentials. |

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

### Batch endpoint

`POST /batch` (mounted by default) dispatches an array of calls through `app.batch()` in one
round trip — useful for any caller that fires several related requests at once, especially AI
agents constructing raw HTTP:

```bash
curl -X POST http://localhost:3030/batch -H "content-type: application/json" -d '[
  { "service": "users", "method": "get", "id": 1 },
  { "service": "messages", "method": "find", "params": { "query": { "$limit": 5 } } }
]'
```

Each call runs the target service's **full hook pipeline** (including `authenticate("jwt")`) with
the batch request's headers — batch is not a way to bypass authentication or validation. The
response is a `BatchResult[]` in the same order as the request array; calls execute concurrently
and each entry independently reports `{ status: "success", result }` or `{ status: "error", error }`
(no cross-call atomicity). Batches over `maxSize` (default 25) are rejected with `400 BadRequest`
before any call executes.

```typescript
app.configure(express(undefined, { batch: false })); // disable
app.configure(express(undefined, { batch: { path: "/_batch", maxSize: 50 } }));
```

`@mantlejs/client` can coalesce same-tick service calls into this endpoint automatically — see its `batch` option.

---

### CORS

Disabled by default — consistent with Mantle's secure-by-default posture elsewhere. Enable it with `cors: true`
for permissive defaults, or pass a `CorsOptions` object to customize:

```typescript
app.configure(express(undefined, { cors: true })); // reflects Origin, allows GET/POST/PUT/PATCH/DELETE, no credentials
app.configure(
  express(undefined, {
    cors: { origin: ["https://app.example.com"], credentials: true },
  }),
);
```

`CorsOptions` (exported from `@mantlejs/mantle`) is shared across `@mantlejs/express`, `@mantlejs/koa`, and
`@mantlejs/http` so switching transports doesn't require relearning CORS configuration:

| Field            | Type                                                              | Default                                   | Description                                        |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------- |
| `origin`         | `boolean \| string \| string[] \| ((origin) => boolean \| string)` | `true` (reflect the request's `Origin`)    | Allowed origin(s) for `Access-Control-Allow-Origin`. |
| `methods`        | `string[]`                                                          | `["GET", "POST", "PUT", "PATCH", "DELETE"]` | Allowed methods for `Access-Control-Allow-Methods`.  |
| `allowedHeaders` | `string[]`                                                          | reflects `Access-Control-Request-Headers`  | Allowed request headers.                             |
| `exposedHeaders` | `string[]`                                                          | none                                       | Headers exposed to the browser.                      |
| `credentials`    | `boolean`                                                           | `false`                                    | Allow credentials (cookies, `Authorization`) cross-origin. |
| `maxAge`         | `number`                                                            | none                                       | Preflight cache duration in seconds.                 |

`@mantlejs/express` wraps the `cors` npm package internally — it's installed as a dependency of
`@mantlejs/express`, not something you need to add yourself.

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
