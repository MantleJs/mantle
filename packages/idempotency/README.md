# @mantlejs/idempotency

`Idempotency-Key` support for [Mantle JS](https://github.com/mantlejs/mantle): a client — or an agent — that retries a
`create` or `patch` with the same key gets the first call's result back instead of a second write. Records live in any
`Repository<T>` you already run.

---

## Installation

```bash
npm install @mantlejs/idempotency
```

---

## Quick start

```typescript
import { idempotency, type IdempotencyRecord } from "@mantlejs/idempotency";
import { KnexRepository } from "@mantlejs/knex";

class IdempotencyRepository extends KnexRepository<IdempotencyRecord> {
  readonly tableName = "idempotency_keys";
  override readonly timestamps = false;
}

const guard = idempotency({ store: new IdempotencyRepository(app) });

app.service("payments").hooks({
  before: { create: [authenticate("jwt"), guard.before] }, // last in before
  after: { create: [guard.after] }, // last in after
  error: { create: [guard.error] },
});
```

```http
POST /payments
Idempotency-Key: 8e03978e-40d5-43e8-bc93-6894a57f9324

{ "amount": 500 }
```

The first request runs and its result is stored. A retry with the same key and body gets the stored result — same
status, same body — with `Idempotent-Replayed: true`, and the payment isn't created twice.

---

## Concepts

### Why

A client that sends a `POST` and loses the connection can't tell whether the server got it. Retrying risks a duplicate
(two payments); not retrying risks losing the write. With a key, retrying is always safe. This matters most for agents,
which retry aggressively, and for mobile clients on flaky networks.

`update` (a full replace) and `remove` are idempotent already, so only `create` and `patch` are guarded. On any other
method the hooks do nothing, so registering them on `all` is safe.

### What happens to a keyed call

| The key is…                               | Result                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| new                                       | The call runs; its result is stored                                                                                               |
| already used, call finished               | The stored result is returned with `Idempotent-Replayed: true`; the service isn't called and no second `service:event` is emitted |
| already used, call still running          | `Conflict` (409) — wait, then retry with the same key                                                                             |
| already used, for a **different** request | `Unprocessable` (422) — keys are for retrying the _same_ request                                                                  |
| used, but the call failed                 | Runs again: errors aren't stored, so a retry after a transient failure works                                                      |
| expired (`ttlSeconds`, default 24 h)      | Treated as new                                                                                                                    |

"The same request" means the same method, service path, id, and data (compared as canonical JSON, so key order doesn't
matter).

With `required: true`, a `create`/`patch` without a key is rejected with `BadRequest`.

### Where the key comes from

- the `Idempotency-Key` header, over HTTP;
- `params.idempotencyKey`, for internal calls and the client SDK.

Keys are 1–255 printable ASCII characters. Use a UUID per logical request, and reuse it only for retries of that request.

### Scope

A record's id is a SHA-256 of the caller's scope and the key, never the key itself. The scope is the principal (the
agent, else the user) plus the service path and method, so one caller's key can never replay another caller's
response, and the same key on `create` and on `patch` are separate. Unauthenticated callers share one scope, so their
keys must be unguessable — UUIDs are.

Register `guard.before` **after** authentication, so the scope includes the user.

### Concurrency

Reserving a key is the store's `save()` of an `in-progress` record. Every store this package supports rejects a
duplicate id atomically with `Conflict`, so of two concurrent calls with one key exactly one runs; the other gets 409.

### The store

Any `Repository<IdempotencyRecord>` whose `save()` throws `Conflict` atomically on a duplicate id:

| Adapter                        | Works | Notes                                                             |
| ------------------------------ | ----- | ----------------------------------------------------------------- |
| `@mantlejs/knex` (all clients) | ✅    | A table with the columns below                                    |
| `@mantlejs/supabase`           | ✅    | Same table, in Postgres                                           |
| `@mantlejs/dynamodb`           | ✅    | `save()` is a conditional put                                     |
| `@mantlejs/mongodb`            | ✅    | Set `idFormat: "objectid"` — MongoDB ids must be 24-hex ObjectIds |
| `@mantlejs/memory`             | ✅    | Single instance and tests only                                    |
| `@mantlejs/pinecone`, `qdrant` | ❌    | They upsert, so a duplicate id overwrites instead of failing      |

Every field is a string, so any table works:

```sql
CREATE TABLE idempotency_keys (
  id          VARCHAR(64) PRIMARY KEY,
  fingerprint VARCHAR(64) NOT NULL,
  status      VARCHAR(16) NOT NULL,   -- "in-progress" | "completed"
  response    TEXT,                   -- the result, as JSON
  "expiresAt" VARCHAR(32) NOT NULL    -- RFC 3339
);
```

Expired records are ignored when read, but not deleted for you. Clean them up periodically, e.g. a nightly
`DELETE FROM idempotency_keys WHERE "expiresAt" < now()` (RFC 3339 strings in UTC compare correctly as text), or a
DynamoDB TTL attribute.

### When storing the result fails

If the write succeeds but storing its result fails, the caller still gets the result, and the key is released rather
than left `in-progress`. A retry then runs again — exactly what happens without this package — instead of being
locked out with 409 until the record expires.

### From `@mantlejs/client`

```typescript
await client.service("payments").create({ amount: 500 }, { idempotencyKey: true }); // a UUID per call
await client.service("payments").create({ amount: 500 }, { idempotencyKey: orderId }); // your own key
```

`true` generates one key per call, reused by the client's own refresh-and-retry. To retry yourself after a network
error, pass the same string again.

---

## API

### `idempotency(options): { before, after, error }`

| Option       | Type                            | Default | Description                              |
| ------------ | ------------------------------- | ------- | ---------------------------------------- |
| `store`      | `Repository<IdempotencyRecord>` | —       | Where records live **(required)**        |
| `required`   | `boolean`                       | `false` | Reject `create`/`patch` without a key    |
| `ttlSeconds` | `number`                        | `86400` | How long a completed result is replayed  |
| `idFormat`   | `"hex" \| "objectid"`           | `"hex"` | 64-hex record ids, or 24-hex for MongoDB |

### `IdempotencyRecord`

`{ id: string; fingerprint: string; status: "in-progress" | "completed"; response?: string; expiresAt: string }`

The semantics follow [draft-ietf-httpapi-idempotency-key-header](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/),
which expired without becoming an RFC; the same behavior is the de-facto standard (Stripe and others).
