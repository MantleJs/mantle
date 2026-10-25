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

### Request ID and client IP

Every response carries an `X-Request-Id` header. A valid incoming `X-Request-Id` (1–128 characters from
`A-Z a-z 0-9 . _ ~ : @ = + / -`) is echoed back; anything else is replaced with a generated UUID, so
client-supplied values can't inject into logs or headers. The ID is set as `params.requestId` and bound into
the request context (`getContext().requestId`), so `@mantlejs/logger` adds it to every log line.

`X-Correlation-Id` is deprecated: for one release it is still accepted when `X-Request-Id` is absent, and
echoed back under both names. `getContext().correlationId` likewise still works as an alias.

A valid W3C `traceparent` header (and `tracestate` beside it) is set as `params.traceparent` / `params.tracestate`
and bound into the request context; malformed values are dropped. [`@mantlejs/otel`](../otel/README.md) parents its
spans on it, and `@mantlejs/logger` adds `traceId`/`spanId` to log lines.

`params.ip` is the client address. By default it's the socket peer; set `trustProxy` to read
`X-Forwarded-For` behind a proxy: `true` takes the leftmost entry (client-controlled, so only safe when the
proxy overwrites the header), a number trusts that many hops (`1` behind one nginx that appends the client address). Load balancers differ —
some append more than one entry — so log `X-Forwarded-For` once on your platform before choosing the number.

### Error handling

`MantleError` subclasses (`NotFound`, `BadRequest`, etc.) are mapped to their correct HTTP status codes. Unknown errors produce a `500 General Error` response.
The exported `errorHandler` middleware uses the default format; `createErrorHandler({ errors: "mantle" })` builds one for Mantle's JSON.

Errors are [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457) served as `application/problem+json`:
`type` links to the error class's page on [mantlejs.com/errors](https://mantlejs.com/errors/), `title` is the class
name in words, `detail` the message, `instance` the request path (without the query string), and `className`,
`data`, `errors`, `hint`, and `requestId` are extension members. Set `errors: "mantle"` for `MantleError.toJSON()` as
`application/json` instead. In either format, an error that isn't a `MantleError` becomes a 500 that doesn't include
its message, so internals never reach the caller.

### `@mantlejs/socketio` compatibility

After `app.listen()` the underlying `http.Server` is stored at `app.get("http:server")`. Socket.IO adapters can attach to this server without needing access to the Koa instance.

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
- Stores a `@koa/router`-backed adapter under `app.get("http:router")` — the transport-neutral contract
  other Mantle packages (`@mantlejs/auth-oauth`, `@mantlejs/mcp`, `@mantlejs/openapi`) use to mount their
  own raw routes regardless of which HTTP transport is configured.
- Stores the Koa application at `app.get("koa")`
- Stores the `@koa/router` Router at `app.get("koa:router")`
- Stores the `http.Server` at `app.get("http:server")` after `app.listen()`

#### `KoaOptions`

| Field           | Type                                        | Default | Description                                                                       |
| --------------- | ------------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `app`           | `Koa` (Koa instance)                        | —       | Existing Koa application. A new one is created if omitted.                         |
| `introspection` | `boolean \| { path?: string }`              | `false` | Mount the introspection endpoint; pass `{ path }` to customize it.                 |
| `batch`         | `boolean \| { path?: string; maxSize?: number }` | `true`  | Mount the `POST /batch` endpoint; `false` disables it, `{ path, maxSize }` configures it. |
| `cors`          | `boolean \| CorsOptions`                    | `false` | Enable CORS via `@koa/cors`; `true` uses permissive defaults, an object customizes origin/methods/headers/credentials. |
| `trustProxy`    | `boolean \| number`                        | `false` | Which proxies to trust when resolving `params.ip` from `X-Forwarded-For` (see below).    |
| `errors`        | `"problem+json" \| "mantle"`              | `"problem+json"` | Error body format: RFC 9457 Problem Details as `application/problem+json`, or Mantle's JSON ([details](https://mantlejs.com/errors/)). |

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
| `exposedHeaders` | `string[]`                                                          | `CORS_DEFAULT_EXPOSED_HEADERS`             | Headers exposed to the browser (see below).          |
| `credentials`    | `boolean`                                                           | `false`                                    | Allow credentials (cookies, `Authorization`) cross-origin. |
| `maxAge`         | `number`                                                            | none                                       | Preflight cache duration in seconds.                 |

By default browsers can read `X-Request-Id`, `RateLimit`, `RateLimit-Policy`, `Retry-After`, `ETag`, and
`Idempotent-Replayed` (`CORS_DEFAULT_EXPOSED_HEADERS`). Setting `exposedHeaders` replaces that list; spread the
constant to extend it: `exposedHeaders: [...CORS_DEFAULT_EXPOSED_HEADERS, "X-Custom"]`.

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
