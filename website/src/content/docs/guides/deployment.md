---
title: Deployment
description: Running a Mantle app in production — Google Cloud Run as the reference target, and the settings that matter once there's more than one instance.
sidebar:
  order: 6
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

Cloud Run's filesystem is in-memory and per instance, so `diskStorage()` is for development only.

## Graceful shutdown

Call `app.teardown()` on `SIGTERM` so adapters close their connection pools before the instance is stopped —
Cloud Run sends `SIGTERM` and allows a grace period before killing the container:

```typescript
process.on("SIGTERM", () => {
  void app.teardown().finally(() => process.exit(0));
});
```
