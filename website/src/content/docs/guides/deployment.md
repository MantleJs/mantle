---
title: Deployment
description: Running a Mantle app in production — Google Cloud Run as the reference target, and the settings that matter once there's more than one instance.
sidebar:
  order: 7
---

A Mantle app is a plain Node.js (≥ 22) HTTP server: `app.listen(port)` on any host that runs a container or a
Node process. The reference target is **Google Cloud Run** — it scales to zero, and pairs naturally with Cloud SQL
for PostgreSQL. The guidance below is what changes between "works on my machine" and a horizontally scaled
deployment.

## Configuration per environment

[`@mantlejs/config`](/packages/config/) merges `config/default.json`, `config/<NODE_ENV>.json`, and environment
variables, optionally validated against a TypeBox schema, so a container can be configured without a rebuild:

```typescript
import { config } from "@mantlejs/config";

app.configure(config({ schema: AppConfigSchema }));
const port = app.get<number>("port");
app.listen(Number(process.env.PORT ?? port)); // Cloud Run injects PORT
```

Keep secrets — `JWT_SECRET`, database URLs, OAuth client secrets — in environment variables or a secret manager,
never in the config files.

## Logging

[`@mantlejs/logger`](/packages/logger/) writes structured JSON to stdout, which Cloud Run collects as-is. Pass
`gcp: true` so levels map to Cloud Logging severities and fields stay structured in the Logs Explorer:

```typescript
import { logger, createLogger } from "@mantlejs/logger";

app.configure(logger(await createLogger({ gcp: process.env.NODE_ENV === "production" })));
```

When a request carries a W3C `traceparent` header, each log line also gets `traceId` and `spanId`.

## Tracing

[`@mantlejs/otel`](/packages/otel/) records a span for every service call. Start an OpenTelemetry SDK with the
exporter for your backend before the app loads, then add the plugin:

```typescript
app.configure(otel());
```

Without an SDK, `otel()` does nothing and costs next to nothing, so it can stay configured in every environment.

## When there's more than one instance

Cloud Run adds instances under load, and any two requests may land on different ones. Everything that defaults to
in-process memory has to move to a shared store:

| Concern                       | Default            | Multi-instance setting                                                                                         |
| ----------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Refresh tokens                | in-memory          | `auth({ refreshTokenStore: redisRefreshTokenStore(redis) })` — [`@mantlejs/auth-redis`](/packages/auth-redis/) |
| OAuth `state` / PKCE verifier | in-memory          | each strategy's `stateStore: redisStateStore(redis)`                                                           |
| Agent-token revocation        | in-memory          | inject a shared `AgentTokenStore` into `auth({ agentTokenStore })`                                             |
| Realtime events               | local process only | `sync({ adapter: redisAdapter(…) })` — [`@mantlejs/sync`](/packages/sync/)                                     |
| Uploaded files                | local disk         | `s3Storage()` / `gcsStorage()` — instances have no shared, persistent disk                                     |
| Rate-limit counters           | in-memory per hook | `rateLimit({ store: redisStore(redis) })` — [`@mantlejs/ratelimit`](/packages/ratelimit/); otherwise each instance counts separately and the limit multiplies |
| Idempotency records           | the store you pass | a database-backed repository (knex, supabase, dynamodb, mongodb), not `MemoryRepository` — [`@mantlejs/idempotency`](/packages/idempotency/) |

Cloud Run's filesystem is in-memory and per instance, so `diskStorage()` is for development only.

## Behind a load balancer

Cloud Run, like most platforms, puts proxies in front of the app, so the socket's peer address is a proxy's, not the
client's. Set the transport's `trustProxy` option to the number of proxy hops that append to `X-Forwarded-For`, so
`params.ip` — and IP-keyed rate limits — see the real client:

```typescript
app.configure(express(undefined, { trustProxy: 2 })); // e.g. two hops: count yours first (below)
```

Platforms differ in how many entries they append — Google Cloud's external Application Load Balancer, for instance,
adds both the client's address and its own — so log `X-Forwarded-For` (and the peer address) for one request on your
deployment and count the entries your infrastructure added. `trustProxy: true` takes the *first* entry instead, which
the client controls; use it only behind a proxy that overwrites the header. Getting the number wrong in the other
direction (too high) lets clients spoof `params.ip`. Every response carries an `X-Request-Id`, and every log line carries the same
`requestId`, so a failing request can be found in Cloud Logging from the ID the client saw.

## Graceful shutdown

Call `app.teardown()` on `SIGTERM` so adapters close their connection pools before the instance is stopped —
Cloud Run sends `SIGTERM` and allows a grace period before killing the container:

```typescript
process.on("SIGTERM", () => {
  void app.teardown().finally(() => process.exit(0));
});
```
