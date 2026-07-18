# @mantlejs/client

Official JavaScript/TypeScript client SDK for [Mantle JS](https://github.com/mantlejs/mantle) — call Mantle services from browsers, Node.js (18+), and React Native over REST, with optional real-time events over Socket.IO.

---

## Installation

```bash
npm install @mantlejs/client

# Optional — only needed for real-time service events
npm install socket.io-client
```

The client has zero required dependencies: REST calls use the native Fetch API. `socket.io-client` is an optional peer dependency loaded lazily on the first `.on()` call.

---

## Concepts

### The same `Service<T>` surface, on the wire

A `ServiceClient<T>` exposes the six method names the server-side `Service<T>` contract uses — `find`, `get`, `create`, `update`, `patch`, `remove` — dispatched as REST calls (`GET/POST/PUT/PATCH/DELETE /:service`). Switching between server and client code involves no context switching.

### Query serialization

`params.query` is serialized into the bracket-notation query string every Mantle HTTP transport parses back into the identical object (`parseQueryString` in `@mantlejs/mantle`):

```typescript
await api.service("users").find({ query: { age: { $gt: 21 }, $limit: 10, $sort: { name: "asc" } } });
// → GET /users?age[$gt]=21&$limit=10&$sort[name]=asc
```

Values arrive server-side as strings — pair services with `RepositoryService` and a schema for type coercion. `undefined` values are dropped; `null` serializes as an empty string, so `IS NULL` queries need server-side coercion.

### Authentication and token rotation

`client.authenticate({ strategy, ...credentials })` posts to `/authentication` and stores the returned `accessToken`/`refreshToken` in the configured `TokenStorage` (default: `localStorage` in the browser, in-memory elsewhere). Every REST request carries `Authorization: Bearer <accessToken>`.

On a 401, the client attempts **one** token rotation — `POST /authentication` with `{ strategy: "refresh", refreshToken }` — then retries the original request. Concurrent 401s share a single refresh (the server's rotation treats a reused refresh token as theft and revokes the whole family). If the refresh fails, tokens are cleared, `'logout'` is emitted, and the original 401 error is thrown.

### Real-time events

When the `socket` option is configured, `service.on("created" | "updated" | "patched" | "removed", handler)` subscribes to the server's Socket.IO broadcasts (`"<path> <event>"`). The socket connects lazily on the first `.on()` call, all services share one connection, and multiple handlers for the same event multiplex over a single underlying socket listener. Calling `.on()` without the `socket` option throws a `GeneralError`-shaped `MantleClientError`.

Event delivery is at-most-once (see the `@mantlejs/sync` README) — the client emits a `'reconnect'` event on every re-connect so callers (e.g. `@mantlejs/react`) can refetch and bound the staleness from any missed events.

### Batch coalescing

With the `batch` option enabled, service calls made within the same coalescing window (default:
the same microtask tick) are queued and sent as **one** `POST /batch` request instead of N
separate REST calls — the transports mount that endpoint by default. Each caller's promise still
resolves or rejects independently from its own entry in the batched response, so application code
is unchanged:

```typescript
const api = mantle({ url: "http://localhost:3030", batch: true });

// One HTTP round trip, three independent promises — the dominant AI-agent call pattern
const [user, posts, tags] = await Promise.all([
  api.service("users").get(1),
  api.service("posts").find({ query: { authorId: 1 } }),
  api.service("tags").find(),
]);
```

`windowMs` widens the window (`setTimeout`-based) beyond the same tick; queues longer than
`maxSize` (default 25 — match the server's max batch size) split into multiple requests. Calls
with per-request `headers` bypass coalescing and go out individually, as does `similar()`. If
every entry fails with a 401 (expired token), the client performs its usual single token refresh
and retries just those entries once.

### Errors

Non-2xx responses are deserialized into `MantleClientError` — `name` (`"BadRequest"`, `"NotFound"`, …), `code` (HTTP status), `data`, `errors`, and the server's actionable `hint` when present. Non-JSON bodies (gateway errors) fall back to the HTTP status. Network failures propagate as the native fetch `TypeError`, unwrapped.

---

## Quick start

```typescript
import { mantle } from "@mantlejs/client";

interface Message {
  id: number;
  text: string;
}

const api = mantle({ url: "http://localhost:3030", socket: {} });

// Authenticate (against @mantlejs/auth + a strategy such as auth-local)
await api.authenticate({ strategy: "local", email: "alice@example.com", password: "secret" });

// CRUD — same names as the server-side Service<T>
const messages = api.service<Message>("messages");
const page = await messages.find({ query: { $limit: 10, $sort: { id: "desc" } } });
const one = await messages.get(1);
const created = await messages.create({ text: "Hello" });

// Real-time
messages.on("created", (message) => console.log("new message", message.text));
api.on("reconnect", () => console.log("socket reconnected — refetch anything stale"));
```

Vector search, against a service that registers the `similar` custom method (`VectorRepositoryService`):

```typescript
const hits = await api.service<Doc>("docs").similar({ vector: [0.1, 0.2, 0.3], topK: 5 });
// hits: Array<Doc & { _score: number }>
```

---

## API

### `mantle(options)`

Creates a `MantleClient`. Throws `TypeError` if `url` is missing.

| Option    | Type                     | Default                            | Description                                                                                    |
| --------- | ------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `url`     | `string`                 | — (required)                       | Base URL of the Mantle server, e.g. `"http://localhost:3030"`                                  |
| `storage` | `TokenStorage`           | `localStorage` browser / in-memory | Token persistence. Any object with `getItem`/`setItem`/`removeItem` (sync or async) works      |
| `socket`  | `SocketOptions`          | `undefined`                        | Socket.IO connection options, passed to `io(url, options)`. Omit to disable real-time features |
| `headers` | `Record<string, string>` | `{}`                               | Default headers appended to every REST request (per-request `params.headers` win)              |
| `batch`   | `boolean \| BatchOptions` | `false`                            | Coalesce same-window service calls into one `POST /batch` request (see Batch coalescing)       |

`SocketOptions.io` optionally overrides the socket factory itself — inject a stub in tests, or supply a pre-bundled `io` when dynamic import of the optional peer is undesirable.

### `MantleClient`

| Member                      | Description                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `service<T>(path)`          | Returns the (cached) `ServiceClient<T>` for a service path                           |
| `authenticate(credentials)` | `POST /authentication`, stores tokens, emits `'authenticated'`, returns `AuthResult` |
| `logout()`                  | Clears tokens, emits `'logout'`, fires a best-effort `POST /authentication/logout`   |
| `getAccessToken()`          | Current access token (synchronous, from the in-memory copy)                          |
| `on(event, handler)`        | Client events: `'authenticated'`, `'logout'`, `'reconnect'`                          |
| `off(event, handler)`       | Remove a client event handler                                                        |

### `ServiceClient<T>`

| Member                      | HTTP                     | Description                                                                   |
| --------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `find(params?)`             | `GET /:service`          | `Promise<T[] \| Paginated<T>>`                                                |
| `get(id, params?)`          | `GET /:service/:id`      | `Promise<T>`                                                                  |
| `create(data, params?)`     | `POST /:service`         | `Promise<T>`                                                                  |
| `update(id, data, params?)` | `PUT /:service/:id`      | `Promise<T>`                                                                  |
| `patch(id, data, params?)`  | `PATCH /:service/:id`    | `Promise<T>`                                                                  |
| `remove(id, params?)`       | `DELETE /:service/:id`   | `Promise<T>`                                                                  |
| `similar(data, params?)`    | `POST /:service/similar` | Vector-search convention — `Promise<Array<T & { _score }>>`                   |
| `on(event, handler)`        | —                        | Subscribe to `'created' \| 'updated' \| 'patched' \| 'removed'`               |
| `off(event, handler)`       | —                        | Unsubscribe; the socket listener detaches with the last handler               |
| `realtime`                  | —                        | `true` when the client has the `socket` option — `on()`/`off()` are available |

---

## Types

```typescript
interface ClientParams {
  query?: Record<string, unknown>; // serialized into the URL
  headers?: Record<string, string>; // per-request header overrides
}

interface TokenStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

interface BatchOptions {
  windowMs?: number; // coalescing window; 0 (default) = same microtask tick
  maxSize?: number; // max calls per POST /batch; longer queues split. Default 25
}

interface AuthCredentials {
  strategy: string;
  [key: string]: unknown;
}

interface AuthResult {
  accessToken: string;
  refreshToken?: string;
  user?: unknown;
}

interface Paginated<T> {
  total: number;
  limit: number;
  skip: number;
  data: T[];
}

class MantleClientError extends Error {
  code: number; // HTTP status
  name: string; // server error class: "BadRequest", "NotFound", …
  className?: string; // kebab-case class name from the wire format
  data?: unknown;
  errors?: unknown[];
  hint?: string; // server's actionable guidance, when present
}
```

Tokens are stored under the keys `mantle-access-token` and `mantle-refresh-token`.

---

## Development

```bash
npx nx build client     # compile
npx nx test client      # run tests
npx nx lint client      # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build client
```

First publish (scoped packages require `--access public`):

```bash
cd packages/client
npm publish --access public
```

Subsequent releases — bump `version` in `packages/client/package.json`, then:

```bash
cd packages/client
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/client
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/client --registry http://localhost:4873
```
