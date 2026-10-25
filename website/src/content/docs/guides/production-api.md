---
title: Production APIs
description: The standards a production HTTP API is expected to follow — Problem Details errors, ETags and conditional writes, rate limits, idempotency keys, and request IDs — and the Mantle hook or option for each.
sidebar:
  order: 6
---

Every feature here is a hook or a transport option, so it works the same on Express, Koa, and `@mantlejs/http`, and
each one follows the IETF standard (or draft) clients and gateways already understand.

## Errors: Problem Details

Error responses are [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457) by default, served as
`application/problem+json`:

```json
{
  "type": "https://mantlejs.com/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "No record found with id = 42",
  "instance": "/articles/42",
  "requestId": "3f2c1d4a-8b2e-4f1a-9c3d-1e2f3a4b5c6d"
}
```

`type` links to the [error's page](/errors/). An error that isn't a `MantleError` becomes a 500 without its message, so
stack traces and SQL never reach the caller. `errors: "mantle"` on the transport switches to Mantle's older JSON
shape; [`@mantlejs/client`](/packages/client/) reads both.

## Request IDs

Every response carries `X-Request-Id` — the caller's, if it sent a valid one, otherwise a new UUID. The same ID is on
`params.requestId`, in Problem Details' `requestId`, and on every log line [`@mantlejs/logger`](/packages/logger/)
writes for the request, so a user's bug report leads straight to the server's logs.

## Caching and lost updates: ETags

```typescript
import { conditional } from "@mantlejs/mantle";

const etags = conditional({ versionField: "updatedAt" });
app.service("articles").hooks({ before: { all: [etags.before] }, after: { all: [etags.after] } });
```

- `get` sends an `ETag`. A client that sends it back in `If-None-Match` gets `304 Not Modified` with no body when
  nothing changed.
- A write with `If-Match` applies only if the record still has that ETag; otherwise it's
  [`412 Precondition Failed`](/errors/precondition-failed/), so two users editing at once can't silently overwrite each
  other. With `versionField`, the check happens inside the database write (memory and knex), so even a write that lands
  between the check and the update is caught.

## Rate limits

```typescript
import { rateLimit, redisStore } from "@mantlejs/ratelimit";

const store = redisStore(redis);
app.service("articles").hooks({
  before: {
    all: [rateLimit({ limit: 100, windowSeconds: 60, store })],
    create: [rateLimit({ policy: "writes", limit: 10, windowSeconds: 60, store })],
  },
});
```

Responses carry `RateLimit-Policy` and `RateLimit` headers
([draft-ietf-httpapi-ratelimit-headers](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/)); past
the limit, [`429`](/errors/too-many-requests/) with `Retry-After`. Limits are per agent, else per user, else per IP by
default — an agent has its own budget, separate from its user's. See [`@mantlejs/ratelimit`](/packages/ratelimit/).

## Safe retries: idempotency keys

```typescript
import { idempotency } from "@mantlejs/idempotency";

const guard = idempotency({ store: new IdempotencyRepository(app) });
app.service("payments").hooks({
  before: { create: [authenticate("jwt"), guard.before] },
  after: { create: [guard.after] },
  error: { create: [guard.error] },
});
```

A `create` or `patch` sent with an `Idempotency-Key` header runs once; a retry with the same key gets the first
result back (`Idempotent-Replayed: true`) instead of a second write. From the client SDK:
`service.create(data, { idempotencyKey: true })`. See [`@mantlejs/idempotency`](/packages/idempotency/).

## Browsers

With CORS enabled, the transports expose all of these headers to browser code by default — `X-Request-Id`,
`RateLimit`, `RateLimit-Policy`, `Retry-After`, `ETag`, and `Idempotent-Replayed` — so a web client can read them
cross-origin.
