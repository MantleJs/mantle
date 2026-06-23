# @mantlejs/memory

In-memory `Repository<T>` implementation for [Mantle JS](https://github.com/mantlejs/mantle). Backed by a `Map`, it supports all `QueryParams` operators with the same semantics as `KnexRepository`. Designed for unit testing services without a database — swap it in for any `Repository<T>`.

---

## Installation

```bash
npm install @mantlejs/memory
```

---

## Concepts

### MemoryRepository

`MemoryRepository<T>` implements the `Repository<T>` interface from `@mantlejs/core`. It stores records in a `Map` keyed by ID, auto-generates UUIDs, and manages `createdAt`/`updatedAt` timestamps — the same behaviour your production `KnexRepository` provides.

### Test helpers

Three helpers make it easy to set up and inspect state in tests:

- `repo.seed(records)` — pre-populate the store with known records (bypasses auto-ID if `id` is provided)
- `repo.clear()` — empty the store between tests
- `repo.store` — read-only `Map<Id, T>` for assertions on internal state

Both `seed()` and `clear()` return `this` for chaining.

---

## Quick start

```typescript
import { MemoryRepository } from "@mantlejs/memory";

interface User {
  id: string;
  name: string;
  email: string;
}

// In your test
const repo = new MemoryRepository<User>();

// Seed known state
repo.seed([
  { id: "1", name: "Alice", email: "alice@example.com" },
  { id: "2", name: "Bob",   email: "bob@example.com"   },
]);

const user = await repo.findById("1");
// → { id: "1", name: "Alice", email: "alice@example.com", createdAt: "...", updatedAt: "..." }

const active = await repo.findAll({ where: { name: { $like: "A%" } } });
// → [{ id: "1", name: "Alice", ... }]
```

### Injecting into a service

```typescript
import { mantle } from "@mantlejs/core";
import { MemoryRepository } from "@mantlejs/memory";
import { UserService } from "../src/user.service.js";

const app = mantle();
const repo = new MemoryRepository<User>();
app.use("users", new UserService(repo));

repo.seed([{ id: "1", name: "Alice", email: "alice@example.com" }]);

const users = await app.service("users").find();
// → [{ id: "1", name: "Alice", ... }]
```

---

## API

### `new MemoryRepository<T>(options?)`

```typescript
const repo = new MemoryRepository<User>({
  idField:    "id",    // default — primary key field name
  autoId:     true,    // default — auto-generate UUID when id is absent on save
  timestamps: true,    // default — manage createdAt / updatedAt
});
```

#### `MemoryRepositoryOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `idField` | `string` | `"id"` | Primary key field name |
| `autoId` | `boolean` | `true` | Auto-generate `crypto.randomUUID()` when `id` is absent |
| `timestamps` | `boolean` | `true` | Set `createdAt` on save, update `updatedAt` on patch/update |

---

### Repository methods

All methods mirror the `Repository<T>` interface and return `Promise<T>` or `Promise<T[]>`.

| Method | Description |
| --- | --- |
| `findAll(params?)` | Return all records matching `QueryParams` |
| `findById(id)` | Return a single record or `null` |
| `save(data)` | Insert a new record; throws `BadRequest` if `id` already exists |
| `saveAll(data[])` | Insert multiple records |
| `updateById(id, data)` | Full replace (all fields); throws `NotFound` if absent |
| `patchById(id, data)` | Partial update (merge); throws `NotFound` if absent |
| `deleteById(id)` | Remove and return the record; throws `NotFound` if absent |
| `count(params?)` | Count records matching `QueryParams.where` |

---

### Test helpers

| Member | Description |
| --- | --- |
| `seed(records)` | Pre-populate the store; returns `this` |
| `clear()` | Empty the store; returns `this` |
| `store` | Read-only `Map<Id, T>` — direct access for assertions |

---

### QueryParams operators

`findAll()` and `count()` accept a `QueryParams` object. All operators match the behaviour of `KnexRepository`:

| Operator | Example | SQL equivalent |
| --- | --- | --- |
| Equality | `{ field: value }` | `field = value` |
| Null | `{ field: null }` | `IS NULL` |
| `$lt` / `$lte` / `$gt` / `$gte` | `{ age: { $gt: 18 } }` | `age > 18` |
| `$ne` | `{ status: { $ne: "inactive" } }` | `status != 'inactive'` |
| `$in` / `$nin` | `{ role: { $in: ["admin", "mod"] } }` | `role IN (...)` |
| `$or` / `$and` | `{ $or: [{ a: 1 }, { b: 2 }] }` | `(a = 1 OR b = 2)` |
| `$like` / `$notlike` | `{ name: { $like: "A%" } }` | `name LIKE 'A%'` |
| `$ilike` | `{ name: { $ilike: "alice" } }` | Case-insensitive match |

---

## Types

```typescript
import type { MemoryRepositoryOptions } from "@mantlejs/memory";
```

| Type | Description |
| --- | --- |
| `MemoryRepositoryOptions` | Constructor options for `MemoryRepository` |

---

## Development

```bash
npx nx build memory   # compile
npx nx test memory    # run tests
npx nx lint memory    # lint
```

---

## Publishing

Build before publishing:

```bash
npx nx build memory
```

First publish (scoped packages require `--access public`):

```bash
cd packages/memory
npm publish --access public
```

Subsequent releases — bump `version` in `packages/memory/package.json`, then:

```bash
cd packages/memory
npm publish
```
