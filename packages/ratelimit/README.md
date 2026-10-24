# @mantlejs/ratelimit

Rate limiting for [Mantle JS](https://github.com/mantlejs/mantle): a `rateLimit()` hook with memory and Redis stores,
keyed by agent, user, tenant, or IP, that tells clients their remaining quota in the IETF `RateLimit` headers.

---

## Installation

```bash
npm install @mantlejs/ratelimit
```

---

## Quick start

```typescript
import { rateLimit } from "@mantlejs/ratelimit";

app.service("articles").hooks({
  before: {
    all: [rateLimit({ limit: 100, windowSeconds: 60 })],
  },
});
```

Each call adds one to a counter for the caller. While the count stays within `limit`, the call goes through and the
response says where the caller stands:

```http
HTTP/1.1 200 OK
RateLimit-Policy: "default";q=100;w=60
RateLimit: "default";r=99;t=60
```

`q` is the quota per window of `w` seconds, `r` how much of it remains, and `t` the seconds until it resets. Past the
limit the call is rejected with `TooManyRequests` (429) and a `Retry-After` header, without reaching the service:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 42
RateLimit: "default";r=0;t=42
Content-Type: application/problem+json

{ "type": "https://mantlejs.com/errors/too-many-requests", "status": 429,
  "detail": "Rate limit 'default' exceeded: 100 per 60s. Retry after 42s.", ... }
```

The browser can read these headers cross-origin: the HTTP transports expose them by default when CORS is on.

---

## Concepts

### Fixed windows

A caller's window starts with their first call and lasts `windowSeconds`; when it ends, the count resets. That maps
one-to-one onto the headers' `q`/`w` parameters. A client can spend a whole window's quota at its very end and the
next window's at its start, so allow for bursts of up to twice `limit` across a window boundary.

### Who a call counts against — `key`

| Key function    | Counts against                                                                      |
| --------------- | ----------------------------------------------------------------------------------- |
| `byPrincipal()` | The agent if there is one, else the user, else the IP. **The default.**             |
| `byUser()`      | The authenticated user — the user record's `id`, or the JWT payload's `sub`         |
| `byAgent()`     | The agent behind a capability-scoped token (`context.agent`, from `authorizeAgent()`) |
| `byTenant()`    | The tenant, `params.tenant.id` — one budget per customer                            |
| `byIp()`        | `params.ip`. Behind a proxy, set the transport's `trustProxy` option, or every client shares the proxy's address |
| `(context) => string \| undefined` | Anything else. Return `undefined` to skip the limit for that call |

An agent counts separately from the user who delegated to it, so a runaway agent exhausts its own budget, not its
user's. A key function that finds no identity (e.g. `byUser()` on an anonymous call) skips the limit for that call;
pair it with an IP-keyed policy if anonymous traffic needs a limit too.

**Internal calls** (`provider` undefined: one service calling another from a hook) aren't counted, since they aren't
the client's requests. Set `includeInternal: true` to count them.

### Several policies on one call

Register several hooks and every one applies. Each needs its own `policy` name; the response then carries one
`RateLimit-Policy` and one `RateLimit` header, with a member per policy:

```typescript
app.service("articles").hooks({
  before: {
    all: [rateLimit({ limit: 100, windowSeconds: 60 })],
    create: [rateLimit({ policy: "writes", limit: 10, windowSeconds: 60 })],
  },
});
```

```http
RateLimit-Policy: "default";q=100;w=60, "writes";q=10;w=60
RateLimit: "default";r=97;t=41, "writes";r=9;t=60
```

A counter is per policy and key, inside a store. Give several services the same policy name **and** the same store to
make them share one budget:

```typescript
const store = redisStore(redis);
const apiWide = () => rateLimit({ policy: "api", limit: 1000, windowSeconds: 3600, store });
app.service("articles").hooks({ before: { all: [apiWide()] } });
app.service("comments").hooks({ before: { all: [apiWide()] } });
```

### Cost

`cost` (default `1`) is what a call takes from the quota — a number, or a function of the context, for example to make
expensive searches count more:

```typescript
rateLimit({ limit: 1000, windowSeconds: 60, cost: (context) => (context.method === "find" ? 5 : 1) });
```

### Stores

| Store                 | Use it for                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `memoryStore()`       | One instance, tests, prototypes. **The default** — each hook gets its own.               |
| `redisStore(client)`  | Anything behind a load balancer: every instance shares the counters                      |

With `memoryStore()` and several instances, each instance counts separately, so the effective limit multiplies by the
instance count. Use `redisStore()` in production deployments that scale out (Cloud Run, Kubernetes).

`redisStore()` counts with one Lua script (`INCRBY` plus starting the window's expiry on the first hit), so concurrent
calls on different instances are counted exactly once each. It takes any client shaped like `ioredis`:

```typescript
import { Redis } from "ioredis";
import { rateLimit, redisStore } from "@mantlejs/ratelimit";

const store = redisStore(new Redis(process.env.REDIS_URL!), { prefix: "myapp:ratelimit:" });
```

For `redis` (node-redis), adapt its `eval` signature:

```typescript
const store = redisStore({
  eval: (script, numKeys, ...args) =>
    client.eval(script, { keys: args.slice(0, numKeys).map(String), arguments: args.slice(numKeys).map(String) }),
});
```

A custom store implements `RateLimitStore`: `hit(key, windowSeconds, cost)` must add `cost` and return the new count and
the seconds left in the window, atomically.

### Agents and other transports

Over MCP and socket.io the 429 arrives as a normal error. Its message says how long to wait (`"… Retry after 42s."`)
and `data.retryAfter` carries the seconds, so an agent can back off without parsing headers. `RateLimit` headers are
HTTP-only.

---

## Policy recipe: a public API with agents

```typescript
import { byIp, byPrincipal, rateLimit, redisStore } from "@mantlejs/ratelimit";

const store = redisStore(redis);

app.service("articles").hooks({
  before: {
    all: [
      // Anonymous traffic: per IP (with trustProxy set on the transport).
      rateLimit({ policy: "anon", limit: 60, windowSeconds: 60, store, key: (c) => (c.params.user ? undefined : byIp()(c)) }),
      // Signed-in users and their agents: per principal, so each agent has its own budget.
      rateLimit({ policy: "auth", limit: 600, windowSeconds: 60, store, key: byPrincipal() }),
    ],
    // Writes are scarcer.
    create: [rateLimit({ policy: "writes", limit: 30, windowSeconds: 60, store })],
  },
});
```

Register rate limits **before** authentication-heavy or expensive hooks where you can, so rejected calls cost little:
`byIp()` needs nothing from authentication, while `byUser()`/`byPrincipal()` need `authenticate()` (and, for agents,
`authorizeAgent()`) to have run first.

---

## API

### `rateLimit(options): HookFunction`

| Option            | Type                                        | Default            | Description                                               |
| ----------------- | ------------------------------------------- | ------------------ | --------------------------------------------------------- |
| `limit`           | `number`                                    | —                  | Quota per window (positive integer) **(required)**        |
| `windowSeconds`   | `number`                                    | —                  | Window length in whole seconds **(required)**             |
| `policy`          | `string`                                    | `"default"`        | Policy name in the headers; 1–64 of `A-Z a-z 0-9 . _ : -` |
| `key`             | `(context) => string \| undefined`          | `byPrincipal()`    | Who the call counts against                               |
| `store`           | `RateLimitStore`                            | `memoryStore()`    | Where counters live                                       |
| `cost`            | `number \| (context) => number`             | `1`                | What a call takes from the quota                          |
| `includeInternal` | `boolean`                                   | `false`            | Count internal (`provider` undefined) calls too           |

Invalid options throw `BadRequest` when the hook is created, not on the first call.

### Stores

- `memoryStore(options?: { now?: () => number }): RateLimitStore`
- `redisStore(client: RedisEvalClient, options?: { prefix?: string }): RateLimitStore` (default prefix
  `"mantle:ratelimit:"`)

### Header helpers

`policyItem(name, quota, windowSeconds)`, `limitItem(name, remaining, resetSeconds)`, and `mergeListItem(header, item)`
format the headers, for custom hooks that report their own limits. They follow
[draft-ietf-httpapi-ratelimit-headers-11](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/),
which isn't an RFC yet; if the draft changes, these change with it.

---

## Development

```bash
npx nx test ratelimit
MANTLE_REDIS_URL=redis://127.0.0.1:6379 npx nx test ratelimit   # also run the store specs against a real Redis
```
