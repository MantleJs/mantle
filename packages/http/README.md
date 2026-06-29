# @mantlejs/http

Zero-dependency HTTP transport adapter for [Mantle JS](https://github.com/mantlejs/mantle). Exposes two handlers from a single `http()` plugin: a Node.js `(req, res)` handler for use with `http.createServer`, and a Fetch API `(request: Request) => Promise<Response>` handler for Cloudflare Workers, Vercel Edge Functions, AWS Lambda@Edge, and other edge runtimes. No Express or Koa required — route matching and body parsing are implemented from scratch using only Node.js built-ins.

---

## Installation

```bash
npm install @mantlejs/http
```

---

## Concepts

### Two handlers, one plugin

`http()` registers two handlers on the Mantle application:

- **`httpHandler`** (`NodeHttpHandler`) — a `(req: IncomingMessage, res: ServerResponse) => void` callback compatible with Node.js `http.createServer`. Calling `app.listen(port)` automatically creates a server using this handler.
- **`fetchHandler`** (`FetchHandler`) — a `(request: Request) => Promise<Response>` callback for edge runtimes that accept standard Fetch API objects.

Both handlers run the full Mantle hook pipeline and set `params.provider = 'http'`.

### Zero dependencies

`@mantlejs/http` only depends on `@mantlejs/mantle` and Node.js built-ins. Route matching and JSON body parsing are implemented from scratch — no Express, Koa, or other HTTP framework is pulled in.

### Edge runtime compatibility

`fetchHandler` is compatible with any runtime that supports the [WinterCG](https://wintercg.org/) minimum common API — `Request`, `Response`, `URL`, and `crypto.randomUUID()`. Tested platforms:

| Platform | Runtime | Import style |
| -------- | ------- | ------------ |
| Cloudflare Workers | V8 isolate | npm (bundled) |
| Vercel Edge Functions | V8 isolate | npm (bundled) |
| Supabase Edge Functions | Deno | `npm:` specifier |
| Deno Deploy | Deno | `npm:` specifier |
| AWS Lambda@Edge | Node.js | npm |
| Bun | Bun | npm |

Edge runtimes are **stateless and ephemeral** — each isolate handles one request (or a small batch). This means `app.listen()` is irrelevant in these environments; retrieve the `fetchHandler` directly instead. Anything requiring a persistent connection (database pool, socket.io, Redis) must be re-established per request or routed through a connection proxy.

### Correlation IDs

Every request gets an `x-correlation-id` header in the response. If the incoming request supplies one, it is echoed back. The correlation ID is available inside hooks via `getContext().correlationId`.

---

## Quick start

### Node.js server

```typescript
import { mantle } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";

const app = mantle().configure(http());

app.use("users", new UserService(new UserRepository(app)));

app.listen(3030, () => console.log("Listening on :3030"));
```

### Cloudflare Workers

```typescript
import { mantle } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";
import type { FetchHandler } from "@mantlejs/http";

const app = mantle().configure(http());
app.use("users", new UserService(new UserRepository(app)));

const handler = app.get("fetchHandler") as FetchHandler;
export default { fetch: handler };
```

### Vercel Edge Functions

```typescript
// app/api/users/route.ts
import { mantle } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";
import type { FetchHandler } from "@mantlejs/http";

export const runtime = "edge";

const app = mantle().configure(http());
app.use("users", new UserService(new UserRepository(app)));

const handler = app.get("fetchHandler") as FetchHandler;

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
```

### Supabase Edge Functions

Supabase Edge Functions run on Deno. Import the packages using the `npm:` specifier:

```typescript
// supabase/functions/api/index.ts
import { mantle } from "npm:@mantlejs/mantle";
import { http } from "npm:@mantlejs/http";
import type { FetchHandler } from "npm:@mantlejs/http";

const app = mantle().configure(http());
app.use("users", new UserService(new UserRepository(app)));

const handler = app.get("fetchHandler") as FetchHandler;
Deno.serve(handler);
```

### Custom Node.js server

```typescript
import { createServer } from "node:http";
import { mantle } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";
import type { NodeHttpHandler } from "@mantlejs/http";

const app = mantle().configure(http());
app.use("users", new UserService(new UserRepository(app)));

const handler = app.get("httpHandler") as NodeHttpHandler;
createServer(handler).listen(3030);
```

---

## API

### `http()`

Returns a `MantlePlugin` that registers the HTTP transport on the application.

After calling `app.configure(http())`:

| `app.get(key)`    | Type              | Description                                                       |
| ----------------- | ----------------- | ----------------------------------------------------------------- |
| `'httpHandler'`   | `NodeHttpHandler` | Node.js `(req, res) => void` handler for `http.createServer`      |
| `'fetchHandler'`  | `FetchHandler`    | Fetch API `(request) => Promise<Response>` handler for edge runtimes |
| `'server'`        | `http.Server`     | Set after `app.listen()` is called                                |

### Route conventions

| HTTP method | Path              | Mantle method |
| ----------- | ----------------- | ------------- |
| GET         | `/service`        | `find`        |
| GET         | `/service/:id`    | `get`         |
| POST        | `/service`        | `create`      |
| PUT         | `/service/:id`    | `update`      |
| PATCH       | `/service/:id`    | `patch`       |
| DELETE      | `/service/:id`    | `remove`      |
| POST        | `/service/:method`| custom method |

### `toErrorResponse(err)`

Utility exported for use in other adapters or middleware. Maps a `MantleError` (or any error) to `{ status: number; body: Record<string, unknown> }`.

---

## Types

```typescript
import type { NodeHttpHandler, FetchHandler } from "@mantlejs/http";

// Node.js handler
type NodeHttpHandler = (req: IncomingMessage, res: ServerResponse) => void;

// Edge / Fetch API handler
type FetchHandler = (request: Request) => Promise<Response>;
```

---

## Development

```bash
npx nx build http     # compile
npx nx test http      # run tests (25 tests)
npx nx lint http      # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build http
```

First publish (scoped packages require `--access public`):

```bash
cd packages/http
npm publish --access public
```

Subsequent releases — bump `version` in `packages/http/package.json`, then:

```bash
cd packages/http
npm publish
```
