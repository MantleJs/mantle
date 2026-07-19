# @mantlejs/koa

Koa HTTP transport adapter for [Mantle JS](https://github.com/mantlejs/mantle). Routes incoming Koa requests to registered Mantle services and sends back typed JSON responses.

---

## Installation

```bash
npm install @mantlejs/koa koa @koa/router @koa/bodyparser
```

---

## Concepts

### Transport adapter

`koa()` is a Mantle plugin. It wraps a Koa application, mounts a REST router for every service registered with `app.use()`, and serialises the Mantle hook pipeline result as a JSON response. All HTTP concerns stay inside this package — services and hooks remain transport-agnostic.

### Route mapping

Each Mantle service method maps to an HTTP verb and path:

| Method   | HTTP verb | Path                  |
| -------- | --------- | --------------------- |
| `find`   | `GET`     | `/path`               |
| `get`    | `GET`     | `/path/:id`           |
| `create` | `POST`    | `/path`               |
| `update` | `PUT`     | `/path/:id`           |
| `patch`  | `PATCH`   | `/path/:id`           |
| `remove` | `DELETE`  | `/path/:id`           |
| custom   | `POST`    | `/path/methodName`    |

Only methods explicitly listed in the `app.use()` options are mounted.

### Provider

When a request arrives from Koa, `params.provider` is set to `"koa"`. Hooks can inspect this to distinguish HTTP calls from internal service calls (where `provider` is `undefined`).

### Correlation ID

Every response includes an `x-correlation-id` header. If the request supplies the header, it is echoed back. Otherwise a random UUID is generated. The ID is available inside hooks via `getContext().correlationId`.

### Error handling

`MantleError` subclasses (`NotFound`, `BadRequest`, etc.) are mapped to their correct HTTP status codes. Unknown errors produce a `500 General Error` response.

### `@mantlejs/socketio` compatibility

After `app.listen()` the underlying `http.Server` is stored at `app.get('server')`. Socket.IO adapters can attach to this server without needing access to the Koa instance.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { koa } from "@mantlejs/koa";

const app = mantle().configure(koa());

app.use("/messages", new MessageService(new MessageRepository(app)), {
  methods: ["find", "get", "create", "patch", "remove"],
});

app.listen(3030);
```

```http
GET /messages
```

```json
[{ "id": 1, "text": "Hello, world!" }]
```

### Using an existing Koa instance

```typescript
import Koa from "koa";
import { mantle } from "@mantlejs/mantle";
import { koa } from "@mantlejs/koa";

const koaApp = new Koa();
koaApp.use(myCustomMiddleware());

const app = mantle().configure(koa({ app: koaApp }));
app.use("users", new UserService());
app.listen(3030);
```

---

## API

### `koa(options?)`

Returns a `MantlePlugin`. Call via `app.configure(koa(options))`.

```typescript
import Koa from "koa";

// Use a fresh Koa instance (default)
app.configure(koa());

// Bring your own Koa instance
app.configure(koa({ app: new Koa() }));
```

Side effects:
- Stores the Koa application at `app.get("koa")`
- Stores the `@koa/router` Router at `app.get("koa:router")`
- Stores the `http.Server` at `app.get("server")` after `app.listen()`

#### `KoaOptions`

| Field           | Type                                        | Default | Description                                                                       |
| --------------- | ------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `app`           | `Koa` (Koa instance)                        | —       | Existing Koa application. A new one is created if omitted.                         |
| `introspection` | `boolean \| { path?: string }`              | `false` | Mount the introspection endpoint; pass `{ path }` to customize it.                 |
| `batch`         | `boolean \| { path?: string; maxSize?: number }` | `true`  | Mount the `POST /batch` endpoint; `false` disables it, `{ path, maxSize }` configures it. |
| `cors`          | `boolean \| CorsOptions`                    | `false` | Enable CORS via `@koa/cors`; `true` uses permissive defaults, an object customizes origin/methods/headers/credentials. |

---

### Introspection endpoint

Opt in to a machine-readable service catalog:

```typescript
app.configure(koa({ introspection: true }));
// or with a custom path:
app.configure(koa({ introspection: { path: "/__meta" } }));
```

`GET /_services` (or the custom path) then returns a `ServiceDescriptor[]` — one entry per
registered service with `path`, `methods`, `events`, `schema`, the repository's `capabilities`
(when the service exposes them, e.g. `RepositoryService`), and `authRequired`. Off by default;
without the option the route 404s.

---

### Batch endpoint

`POST /batch` (mounted by default) dispatches an array of calls through `app.batch()` in one
round trip:

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
app.configure(koa({ batch: false })); // disable
app.configure(koa({ batch: { path: "/_batch", maxSize: 50 } }));
```

`@mantlejs/client` can coalesce same-tick service calls into this endpoint automatically — see its `batch` option.

---

### CORS

Disabled by default — consistent with Mantle's secure-by-default posture elsewhere. Enable it with `cors: true`
for permissive defaults, or pass a `CorsOptions` object to customize:

```typescript
app.configure(koa({ cors: true })); // reflects Origin, allows GET/POST/PUT/PATCH/DELETE, no credentials
app.configure(
  koa({
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

`@mantlejs/koa` wraps `@koa/cors` internally — it's installed as a dependency of `@mantlejs/koa`, not
something you need to add yourself.

---

### `errorHandler`

Koa middleware that catches `MantleError` subclasses and maps them to HTTP status codes. Installed automatically by `koa()` — you only need this export if you are assembling the middleware stack manually.

```typescript
import { errorHandler } from "@mantlejs/koa";

koaApp.use(errorHandler);
```

---

## Types

```typescript
import type { KoaOptions } from "@mantlejs/koa";
```

| Type         | Description                        |
| ------------ | ---------------------------------- |
| `KoaOptions` | Options object accepted by `koa()` |

---

## Development

```bash
npx nx build koa   # compile
npx nx test koa    # run tests
npx nx lint koa    # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build koa
```

First publish (scoped packages require `--access public`):

```bash
cd packages/koa
npm publish --access public
```

Subsequent releases — bump `version` in `packages/koa/package.json`, then:

```bash
cd packages/koa
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/koa
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/koa --registry http://localhost:4873
```
