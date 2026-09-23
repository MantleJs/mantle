# @mantlejs/audit

Audit-trail hook for [Mantle JS](https://github.com/mantlejs/mantle). Records *who did what, as which identity, with what result* on every service call — a queryable audit trail, not a grep through logs.

---

## Installation

```bash
npm install @mantlejs/audit
```

---

## Concepts

### Not the same job as `@mantlejs/logger`

`@mantlejs/logger`'s `logRequest`/`logError` hooks are structured *observability* — request duration, status, correlation ids, meant for a log aggregator. `@mantlejs/audit`'s `auditLog()` is a *compliance/security* record scoped to identity and outcome — who (a user or an [agent](../auth/README.md#agent-tokens)), what (path + method), and what happened. Use both; they answer different questions.

### The sink is a `Repository<T>` you already have

`auditLog({ sink })` writes each entry via `sink.save(record)`. `sink` is any `Repository<T>` — `@mantlejs/memory` for prototyping, or a real adapter (`@mantlejs/knex`, `@mantlejs/mongodb`, `@mantlejs/supabase`, ...) backed by a table/collection the deployment already runs. No new storage concept, and audit records are themselves queryable through the same `find`/`get` a normal Mantle service would give you if you wrap the sink in one.

### One hook, two registrations

`auditLog()` returns a single hook function. Register the *same* returned value in both `after.all` and `error.all` — it records exactly once per call, whichever phase actually reaches it:

```typescript
const audit = auditLog({ sink: auditRepository });

app.service("documents").hooks({
  after: { all: [audit] },
  error: { all: [audit] },
});
```

A successful call never reaches `error.all`; a thrown call never reaches `after.all` — so there's no risk of double-recording, and no need for a `before.all` registration (unlike `logRequest`, which needs one to measure duration — `auditLog()` doesn't record duration, so it doesn't need one).

### What's in a record, and what's deliberately left out

```typescript
interface AuditRecord {
  principal?: unknown; // ctx.params.user — undefined for an unauthenticated/internal call
  agentId?: string; // set only when the call was authorized via an agent token
  agentScope?: CapabilityScope; // present only alongside agentId
  delegatingUserId?: string; // present only alongside agentId
  path: string;
  method: string;
  params?: Record<string, unknown>; // ctx.params.query — filters/pagination/sort/select
  status: "success" | "error";
  resultSummary: string; // short outcome description, never the full result payload
  timestamp: string; // ISO 8601
}
```

`params` is `ctx.params.query` only — **never** `ctx.params.headers` or the raw `ctx.params.user` object. Headers can carry bearer tokens; identity already has its own field (`principal`). `resultSummary` is deliberately a short description (record count, an id, or an error name+message), not the full result — avoids duplicating potentially large or sensitive payloads into the audit trail.

When the call was authorized via [`@mantlejs/auth`'s `authorizeAgent()`](../auth/README.md#agent-tokens) (`HookContext.agent` set), the entry additionally carries `agentId`, `agentScope`, and `delegatingUserId` — the "as which identity, delegated by whom" half of an agent-originated call.

### Sink failures never fail the primary operation

If `sink.save()` throws, `auditLog()` catches it — the service call that triggered the audit entry already succeeded (or already failed for its own reason) and that outcome is never changed by an audit-sink outage. By default the failure is logged via `app.get<Logger>("logger")` when `@mantlejs/logger` is configured; pass `onSinkError` for custom handling (e.g. a metric).

---

## Quick start

```typescript
import { mantle } from "@mantlejs/mantle";
import { http } from "@mantlejs/http";
import { auth, authorizeAgent } from "@mantlejs/auth";
import { auditLog } from "@mantlejs/audit";
import { MemoryRepository } from "@mantlejs/memory";
import type { AuditRecord } from "@mantlejs/audit";

const app = mantle()
  .configure(http())
  .configure(auth({ secret: process.env.JWT_SECRET! }));

const auditRepository = new MemoryRepository<AuditRecord>(); // swap for a real adapter in production
const audit = auditLog({ sink: auditRepository });

app.use("documents", new DocumentService(new DocumentRepository(app)));

app.service("documents").hooks({
  before: { all: [authorizeAgent()] }, // optional — only if agents may call this route
  after: { all: [audit] },
  error: { all: [audit] },
});

app.listen(3030);
```

---

## API

### `auditLog(options)`

Returns a `HookFunction`. Register it in both `after.all` and `error.all` on the service(s) to audit.

```typescript
auditLog({
  sink: auditRepository, // required — any Repository<AuditRecord>
  onSinkError: (error, record, ctx) => {
    // optional — called instead of the default app.get("logger") fallback
  },
});
```

#### `AuditLogOptions`

| Field         | Type                                                     | Default                              | Description                                                            |
| ------------- | --------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `sink`        | `Repository<AuditRecord>`                                  | —                                      | Where audit records are written (required)                              |
| `onSinkError` | `(error, record, ctx) => void`                             | logs via `app.get<Logger>("logger")` | Called when `sink.save()` throws. The primary operation is never failed. |

### `AuditRecord`

See [What's in a record](#whats-in-a-record-and-whats-deliberately-left-out) above for the full field-by-field breakdown.

---

## Types

```typescript
import type { AuditLogOptions, AuditRecord } from "@mantlejs/audit";
```

| Type              | Description                                        |
| ----------------- | --------------------------------------------------- |
| `AuditLogOptions` | Options passed to `auditLog()`                      |
| `AuditRecord`      | The shape of one recorded entry, and of the sink's `T` |

---

## Development

```bash
npx nx build audit   # compile
npx nx test audit    # run tests
npx nx lint audit    # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build audit
```

First publish (scoped packages require `--access public`):

```bash
cd packages/audit
npm publish --access public
```

Subsequent releases — bump `version` in `packages/audit/package.json`, then:

```bash
cd packages/audit
npm publish
```

### Testing locally with Verdaccio

```bash
# Terminal 1 — start the local registry
npx nx run @mantle/source:local-registry

# Terminal 2 — publish to it
cd packages/audit
npm publish --registry http://localhost:4873
```
