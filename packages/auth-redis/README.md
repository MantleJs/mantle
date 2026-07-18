# @mantlejs/auth-redis

Redis-backed stores for [Mantle JS](https://github.com/mantlejs/mantle) authentication: a shared `RefreshTokenStore` for [`@mantlejs/auth`](../auth/README.md) and a shared `OAuthStateStore` for [`@mantlejs/auth-oauth`](../auth-oauth/README.md). Both defaults are in-memory and single-instance only — in multi-instance deployments (Cloud Run, horizontal scaling behind a load balancer) every instance must see the same outstanding refresh tokens and pending OAuth states. This package backs both with Redis.

---

## Installation

```bash
npm install @mantlejs/auth-redis ioredis
```

The package has no hard dependency on a Redis client — the stores accept any client matching the small `RedisClientLike` interface (a subset of Redis commands shaped to match [`ioredis`](https://github.com/redis/ioredis), which is the recommended client). Requires Redis ≥ 6.2 (`GETDEL`).

---

## Concepts

### Why a shared refresh-token store?

`@mantlejs/auth` issues access + refresh token pairs and records each refresh token's `jti` in a `RefreshTokenStore`. Rotation consumes the `jti` exactly once; a second consume of the same token is treated as theft and revokes the whole family. The in-memory default cannot see tokens issued by another instance, so rotation and revocation break fleet-wide. The Redis store keys each `jti` with a TTL matching the token's own `exp` (Redis evicts stale entries itself — no sweeper) and uses `GETDEL` so concurrent consumers of the same token resolve atomically: exactly one wins.

### Why a shared OAuth state store?

`@mantlejs/auth-oauth` stores the pending `state` (and PKCE code verifier) between the redirect to the provider and the callback. Behind a load balancer, the callback can land on a different instance than the one that started the flow. The Redis store writes each state with `SET … EX`, so entries expire server-side and `cleanup()` is a no-op.

---

## Quick start

```typescript
import { Redis } from "ioredis";
import { mantle } from "@mantlejs/mantle";
import { express } from "@mantlejs/express";
import { auth } from "@mantlejs/auth";
import { googleStrategy } from "@mantlejs/auth-google";
import { redisRefreshTokenStore, redisStateStore } from "@mantlejs/auth-redis";

const redis = new Redis(process.env.REDIS_URL!);

const app = mantle()
  .configure(express())
  .configure(
    auth({
      secret: process.env.JWT_SECRET!,
      refreshTokenStore: redisRefreshTokenStore(redis),
    }),
  )
  .configure(
    googleStrategy({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      stateStore: redisStateStore(redis),
    }),
  );

app.listen(3030);
```

---

## API

### `redisRefreshTokenStore(client, options?)`

Returns a `RefreshTokenStore` backed by Redis. Pass it as `refreshTokenStore` in the `auth()` config.

Layout: each `jti` is a string key holding its subject, expiring with the token (`SET … EX`); each subject keeps a set of its outstanding `jti`s so `revokeAll` can find them.

#### Options

| Option   | Type     | Default                  | Description                                     |
| -------- | -------- | ------------------------ | ----------------------------------------------- |
| `prefix` | `string` | `"mantle:auth:refresh:"` | Prefix applied to all keys written by the store |

### `redisStateStore(client, options?)`

Returns an `OAuthStateStore` backed by Redis. Pass it as `stateStore` in any auth-oauth strategy config.

#### Options

| Option   | Type     | Default                 | Description                                     |
| -------- | -------- | ----------------------- | ----------------------------------------------- |
| `ttlMs`  | `number` | `600000` (10 minutes)   | How long a pending authorization state is valid |
| `prefix` | `string` | `"mantle:oauth:state:"` | Prefix applied to all keys written by the store |

---

## Types

```typescript
import type { RedisClientLike, RedisRefreshTokenStoreOptions, RedisStateStoreOptions } from "@mantlejs/auth-redis";
```

| Type                            | Description                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `RedisClientLike`               | The Redis command subset the stores need (`set`/`get`/`getdel`/`del`/`sadd`/`srem`/`smembers`/`expire`) — satisfied by an `ioredis` instance |
| `RedisRefreshTokenStoreOptions` | Options passed to `redisRefreshTokenStore()`                                                                                                 |
| `RedisStateStoreOptions`        | Options passed to `redisStateStore()`                                                                                                        |

The stores implement `RefreshTokenStore` from `@mantlejs/auth` (`add(jti, sub, exp)` / `consume(jti)` / `revokeAll(sub)`) and `OAuthStateStore` from `@mantlejs/auth-oauth` (`set` / `get` / `delete` / `cleanup`).

---

## Development

```bash
npx nx build auth-redis     # compile
npx nx test auth-redis      # run tests (uses ioredis-mock — no Redis server needed)
npx nx lint auth-redis      # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build auth-redis
```

First publish (scoped packages require `--access public`):

```bash
cd packages/auth-redis
npm publish --access public
```

Subsequent releases — bump `version` in `packages/auth-redis/package.json`, then:

```bash
cd packages/auth-redis
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/auth-redis
npm publish --registry http://localhost:4873

# Install from it in another project
npm install @mantlejs/auth-redis --registry http://localhost:4873
```
