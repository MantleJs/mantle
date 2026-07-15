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

| Field           | Type                           | Default | Description                                                        |
| --------------- | ------------------------------ | ------- | ------------------------------------------------------------------ |
| `app`           | `Koa` (Koa instance)           | —       | Existing Koa application. A new one is created if omitted.         |
| `introspection` | `boolean \| { path?: string }` | `false` | Mount the introspection endpoint; pass `{ path }` to customize it. |

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
